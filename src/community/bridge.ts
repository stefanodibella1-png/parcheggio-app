// Ponte tra motore e community, tutto automatico:
// - chi torna all'auto pubblica "si libera tra N min", chi riparte pubblica "libero";
// - chi sta cercando parcheggio (rilevato dal motore) riceve i posti vicini.
// Il motore non sa nulla della community: qui si leggono solo i suoi eventi e lo snapshot.
import type { DetectionConfig } from '../../engine/config.ts';
import type { DetectionEvent, EngineSnapshot, LocationSample, ParkingSession, ReturnInfo } from '../../engine/types.ts';
import { notifyNearbySpot } from '../services/notifications.ts';
import { kvGet, kvSet } from '../storage/db.ts';
import { communityConfigured, fetchNearby, publishSpot, recordTaken, withdrawSpot, type NearbySpot, type SpotKind } from './community.ts';
import { distanceM } from '../../engine/geo.ts';

export interface CommunityState {
  configured: boolean;
  /** sto ascoltando i posti vicini (ricerca di parcheggio in corso o appena finita) */
  listening: boolean;
  nearby: NearbySpot[];
  lastSyncT: number | null;
  /** il mio posto condiviso in questo momento */
  shared: { id: string; kind: SpotKind; freeAt: number } | null;
  error: string | null;
}

export class CommunityBridge {
  state: CommunityState = { configured: communityConfigured(), listening: false, nearby: [], lastSyncT: null, shared: null, error: null };
  private deviceId = '';
  private lastPollT = 0;
  private polling = false;
  private listenUntil = 0;
  /** posti già notificati (id → tipo), per non ripetere l'avviso */
  private notified = new Map<string, SpotKind>();
  private lastSoonPush = 0;
  /** posti ricevuti di recente (per riconoscere quando chi cercava li ha davvero presi) */
  private received = new Map<string, { spot: NearbySpot; t: number }>();

  constructor(private cfg: () => DetectionConfig, private onChange: () => void) {}

  async init(): Promise<void> {
    let id = await kvGet('community:deviceId').catch(() => null);
    if (!id) {
      id = `d${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
      await kvSet('community:deviceId', id).catch(() => {});
    }
    this.deviceId = id;
  }

  // ---- chi libera ---------------------------------------------------------------

  async onEvent(e: DetectionEvent, session: ParkingSession | null, ri: ReturnInfo | null, now: number): Promise<void> {
    if (!this.state.configured || !session) return;
    const id = session.parkingId;
    // chi cercava ha parcheggiato proprio su un posto ricevuto: conferma automatica che il posto è vero
    if (e.type === 'PARKED') await this.checkTaken(session, now);
    // solo posti veri: l'utente è sceso dall'auto (non code o attese in doppia fila)
    if (!session.exitedOnFoot && !session.inferred) return;
    // sosta breve: probabile doppia fila o fermata veloce (a Catania frequentissime)
    if (!session.inferred && session.parkedT !== null) {
      const parkedS = ((e.type === 'PARKING_RELEASED' ? e.t : now) - session.parkedT) / 1000;
      if (parkedS < this.cfg().COMMUNITY_MIN_PARK_S) return;
    }
    // garage o parcheggio coperto: non è un posto su strada
    if (session.gpsLostAtPark) return;
    // rifornimento al distributore
    if (session.atFuelStation) return;
    switch (e.type) {
      case 'RETURN_PREDICTED':
        await this.share(session, 'SOON', now + (ri?.releaseEtaS ?? this.cfg().RETURN_DEPART_DELAY_S * 3) * 1000, now);
        break;
      case 'USER_RETURNING':
        if (e.from === 'PARKED_USER_AWAY' || e.from === 'RETURN_PREDICTED') {
          await this.share(session, 'SOON', now + this.cfg().RETURN_DEPART_DELAY_S * 1000, now);
        }
        break;
      case 'PARKING_RELEASED':
      case 'PARKING_RELEASED_INFERRED':
        await this.share(session, 'FREED', e.t, now);
        break;
      case 'PARKED_USER_AWAY':
        if (e.from === 'RETURN_PREDICTED' && this.state.shared?.id === id) await this.withdraw(id);
        break;
      case 'LOW_CONFIDENCE':
        if (e.from === 'VEHICLE_DEPARTED' && this.state.shared?.id === id) await this.withdraw(id);
        break;
      default:
        break;
    }
  }

  /** Aggiorna l'orario previsto mentre ci si avvicina all'auto. */
  async onReturnUpdate(session: ParkingSession | null, ri: ReturnInfo | null, now: number): Promise<void> {
    if (!this.state.configured || !session || !ri || ri.releaseEtaS === null) return;
    if (this.state.shared?.id !== session.parkingId || this.state.shared.kind !== 'SOON') return;
    if (now - this.lastSoonPush < 30_000) return;
    await this.share(session, 'SOON', now + ri.releaseEtaS * 1000, now);
  }

  private async checkTaken(session: ParkingSession, now: number): Promise<void> {
    const p = session.spot.pointFinal;
    for (const [id, r] of this.received) {
      if (now - r.t > 30 * 60_000) {
        this.received.delete(id);
        continue;
      }
      if (distanceM(p, r.spot) <= this.cfg().COMMUNITY_TAKEN_RADIUS_M) {
        await recordTaken({ spotId: id, latitude: r.spot.latitude, longitude: r.spot.longitude, t: now, deviceId: this.deviceId });
        this.received.delete(id);
        return;
      }
    }
  }

  private async share(session: ParkingSession, kind: SpotKind, freeAt: number, now: number): Promise<void> {
    const cfg = this.cfg();
    const p = session.spot.pointFinal;
    const a = session.spot.address;
    const address = a?.street ? `${a.street}${a.streetNumber ? ` ${a.streetNumber}` : ''}` : (a?.formatted ?? null);
    const ttl = kind === 'FREED' ? cfg.COMMUNITY_FREED_TTL_S : cfg.COMMUNITY_SOON_TTL_S;
    this.lastSoonPush = now;
    const ok = await publishSpot({
      id: session.parkingId,
      kind,
      latitude: p.latitude,
      longitude: p.longitude,
      address,
      quality: session.spot.pointQuality ?? null,
      confidence: kind === 'FREED' ? Math.round(session.releaseConfidence ?? 0) : 0,
      freeAt,
      createdAt: now,
      expiresAt: Math.max(freeAt, now) + ttl * 1000,
      deviceId: this.deviceId,
    });
    this.state.shared = ok ? { id: session.parkingId, kind, freeAt } : this.state.shared;
    this.state.error = ok ? null : 'Community: invio non riuscito (rete?)';
    this.onChange();
  }

  private async withdraw(id: string): Promise<void> {
    await withdrawSpot(id);
    if (this.state.shared?.id === id) this.state.shared = null;
    this.onChange();
  }

  // ---- chi cerca ------------------------------------------------------------------

  /** Chiamato a ogni tick del test: decide da solo se ascoltare e quando interrogare. */
  tick(snap: EngineSnapshot | null, last: LocationSample | null, now: number): void {
    if (!this.state.configured || !snap) return;
    const cfg = this.cfg();
    if (snap.searchingSinceT !== null) this.listenUntil = now + cfg.COMMUNITY_LINGER_S * 1000;
    // appena parcheggiato non serve più cercare
    if (snap.state === 'PARKED' || snap.state === 'PARKED_USER_AWAY') this.listenUntil = 0;
    const listening = now < this.listenUntil;
    if (listening !== this.state.listening) {
      this.state.listening = listening;
      if (!listening) this.state.nearby = [];
      this.onChange();
    }
    if (!listening || !last || this.polling || now - this.lastPollT < cfg.COMMUNITY_POLL_S * 1000) return;
    this.lastPollT = now;
    this.polling = true;
    void fetchNearby(last, cfg.COMMUNITY_RADIUS_M, this.deviceId, now)
      .then(async (list) => {
        if (list === null) {
          this.state.error = 'Community: server non raggiungibile';
          return;
        }
        this.state.error = null;
        this.state.nearby = list;
        this.state.lastSyncT = now;
        for (const s of list) this.received.set(s.id, { spot: s, t: now });
        // avvisa solo per i 2 posti più vicini, una volta (di nuovo se da "si libera" diventa "libero")
        const best = [...list].sort((a, b) => a.distanceM - b.distanceM).slice(0, 2);
        for (const s of best) {
          if (this.notified.get(s.id) === s.kind) continue;
          this.notified.set(s.id, s.kind);
          await notifyNearbySpot(s, now);
        }
      })
      .finally(() => {
        this.polling = false;
        this.onChange();
      });
  }
}

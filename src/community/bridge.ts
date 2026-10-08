// Ponte tra motore e community, tutto automatico:
// - chi torna all'auto pubblica "si libera tra N min", chi riparte pubblica "libero";
// - chi sta cercando parcheggio (rilevato dal motore) riceve i posti vicini.
// Il motore non sa nulla della community: qui si leggono solo i suoi eventi e lo snapshot.
import type { DetectionConfig } from '../../engine/config.ts';
import type { DetectionEvent, EngineSnapshot, LocationSample, ParkingSession, ReturnInfo } from '../../engine/types.ts';
import { notifyNearbySpot } from '../services/notifications.ts';
import { kvGet, kvSet } from '../storage/db.ts';
import { communityConfigured, fetchNearby, publishSpot, withdrawSpot, type NearbySpot, type SpotKind } from './community.ts';

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
    // solo posti veri: l'utente è sceso dall'auto (non code o attese in doppia fila)
    if (!session.exitedOnFoot && !session.inferred) return;
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

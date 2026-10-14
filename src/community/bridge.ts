// Ponte tra motore e community, tutto automatico:
// - chi torna all'auto pubblica "si libera tra N min", chi riparte pubblica "libero";
// - chi sta cercando parcheggio (rilevato dal motore) riceve i posti vicini.
// Il motore non sa nulla della community: qui si leggono solo i suoi eventi e lo snapshot.
import type { DetectionConfig } from '../../engine/config.ts';
import type { DetectionEvent, EngineSnapshot, LocationSample, ParkingSession, ReturnInfo } from '../../engine/types.ts';
import { notifyNearbySpot } from '../services/notifications.ts';
import { getPref } from '../services/prefs.ts';
import { speak } from '../services/voice.ts';
import { kvGet, kvSet } from '../storage/db.ts';
import { communityConfigured, fetchNearby, publishSpot, recordTaken, withdrawSpot, type NearbySpot, type SpotKind } from './community.ts';
import { distanceM } from '../../engine/geo.ts';
import { publicId } from '../parkingct/server.ts';
import { parkingRestriction } from '../services/osmRules.ts';

export interface CommunityState {
  configured: boolean;
  /** sto ascoltando i posti vicini (ricerca di parcheggio in corso o appena finita) */
  listening: boolean;
  nearby: NearbySpot[];
  lastSyncT: number | null;
  /** il mio posto condiviso in questo momento */
  shared: { id: string; kind: SpotKind; freeAt: number } | null;
  error: string | null;
  /** ultima nota sul posto (es. non condiviso per divieto di sosta) */
  note?: string | null;
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
  /** guida vocale: quante voci per posto (max 2: alla ricezione e a 300 m) e distanze recenti */
  private voiced = new Map<string, { n: number; spot: NearbySpot; dists: { t: number; d: number }[] }>();

  constructor(private cfg: () => DetectionConfig, private onChange: () => void) {}

  /** ParkingCT: prima del lancio la community resta spenta (si raccolgono solo i dati). */
  setAllowed(allowed: boolean): void {
    const configured = communityConfigured() && allowed;
    if (configured !== this.state.configured) {
      this.state = { ...this.state, configured };
      this.onChange();
    }
  }

  /** telefono di prova (control center): ascolta sempre i posti vicini, non solo mentre cerchi parcheggio */
  private testListen = false;

  setTestListen(on: boolean): void {
    this.testListen = on;
  }

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
        // anche da PARKED: sei arrivato all'auto da casa o dal negozio lì davanti
        if (e.from === 'PARKED_USER_AWAY' || e.from === 'RETURN_PREDICTED' || e.from === 'PARKED') {
          await this.share(session, 'SOON', now + this.cfg().RETURN_DEPART_DELAY_S * 1000, now);
        }
        break;
      case 'PARKING_RELEASED':
      case 'PARKING_RELEASED_INFERRED':
        await this.share(session, 'FREED', e.t, now);
        break;
      case 'PARKED_USER_AWAY':
        if ((e.from === 'RETURN_PREDICTED' || e.from === 'USER_RETURNING') && this.state.shared?.id === id) await this.withdraw(id);
        break;
      case 'PARKED':
        // eri all'auto ma non sei ripartito
        if (e.from === 'USER_RETURNING' && this.state.shared?.id === id && this.state.shared.kind === 'SOON') await this.withdraw(id);
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
        await recordTaken({ spotId: id, latitude: r.spot.latitude, longitude: r.spot.longitude, t: now, deviceId: publicId(this.deviceId, now) });
        this.received.delete(id);
        return;
      }
    }
  }

  private async share(session: ParkingSession, kind: SpotKind, freeAt: number, now: number): Promise<void> {
    const cfg = this.cfg();
    const p = session.spot.pointFinal;
    // divieto di sosta, isola pedonale o passo carrabile (OpenStreetMap): era una fermata, non un posto
    const rule = await parkingRestriction(p.latitude, p.longitude, now, cfg).catch(() => null);
    if (rule) {
      this.state.note = `Posto non condiviso: ${rule === 'driveway' ? 'passo carrabile' : rule === 'pedestrian' ? 'isola pedonale' : 'divieto di sosta'} (OpenStreetMap)`;
      this.onChange();
      return;
    }
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
      deviceId: publicId(this.deviceId, now),
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
    const listening = this.testListen || now < this.listenUntil;
    if (listening !== this.state.listening) {
      this.state.listening = listening;
      if (!listening) {
        this.state.nearby = [];
        this.voiced.clear();
      }
      this.onChange();
    }
    if (listening && last) this.secondVoice(snap, last, now);
    if (!listening || !last || this.polling || now - this.lastPollT < cfg.COMMUNITY_POLL_S * 1000) return;
    this.lastPollT = now;
    this.polling = true;
    const driving = ['IN_VEHICLE', 'VEHICLE_MOVING', 'VEHICLE_STOPPED', 'POSSIBLE_PARKING'].includes(snap.state);
    void fetchNearby(last, cfg.COMMUNITY_RADIUS_M, [publicId(this.deviceId, now), publicId(this.deviceId, now - 86_400_000)], now)
      .then(async (list) => {
        if (list === null) {
          this.state.error = 'Community: server non raggiungibile';
          return;
        }
        this.state.error = null;
        this.state.nearby = list;
        this.state.lastSyncT = now;
        for (const s of list) this.received.set(s.id, { spot: s, t: now });
        // posti annunciati a voce e poi spariti (ritirati, presi, scaduti) mentre ti avvicinavi
        const ids = new Set(list.map((x) => x.id));
        for (const [id, v] of this.voiced) {
          if (ids.has(id) || v.n >= 2) continue;
          const lastD = v.dists.length ? v.dists[v.dists.length - 1].d : v.spot.distanceM;
          v.n = 2;
          if (driving && lastD <= cfg.COMMUNITY_GONE_VOICE_M && (await getPref('voice'))) {
            speak(`Il posto ${v.spot.address ? `in ${v.spot.address}` : 'che ti avevo segnalato'} non è più disponibile.`);
          }
        }
        // avvisa solo per i 2 posti più vicini, una volta (di nuovo se da "si libera" diventa "libero")
        const best = [...list].sort((a, b) => a.distanceM - b.distanceM).slice(0, 2);
        for (const s of best) {
          if (this.notified.get(s.id) === s.kind) continue;
          this.notified.set(s.id, s.kind);
          await notifyNearbySpot(s, now);
          // voce: la prima volta che il posto arriva (il cambio di stato lo dice la seconda voce a 300 m)
          const prev = this.voiced.get(s.id);
          if (prev) {
            // modalità prova (telefono fermo che cerca): anche il passaggio a "libero" si dice a voce
            if (this.testListen && prev.spot.kind !== s.kind && (await getPref('voice'))) speak(this.spotPhrase(s, s.distanceM, now));
            continue;
          }
          const close = s.distanceM <= cfg.COMMUNITY_SECOND_VOICE_M;
          this.voiced.set(s.id, { n: close ? 2 : 1, spot: s, dists: [{ t: now, d: s.distanceM }] });
          if ((driving || this.testListen) && (await getPref('voice'))) speak(this.spotPhrase(s, s.distanceM, now));
        }
        // stato aggiornato dei posti già annunciati (per la seconda voce)
        for (const s of list) {
          const v = this.voiced.get(s.id);
          if (v) v.spot = s;
        }
      })
      .finally(() => {
        this.polling = false;
        this.onChange();
      });
  }

  private spotPhrase(s: NearbySpot, d: number, now: number): string {
    const where = s.address ? `in ${s.address}` : 'vicino a te';
    const m = Math.round(d / 10) * 10;
    if (s.kind === 'FREED') return `Posto appena liberato ${where}, a ${m} metri.`;
    const mins = Math.max(1, Math.round((s.freeAt - now) / 60000));
    return `Posto che si libera ${where} tra circa ${mins} minut${mins === 1 ? 'o' : 'i'}, a ${m} metri.`;
  }

  /** Seconda voce a 300 m, solo se ti stai avvicinando: dice com'è il posto adesso. */
  private secondVoice(snap: EngineSnapshot, last: LocationSample, now: number): void {
    const cfg = this.cfg();
    const driving = ['IN_VEHICLE', 'VEHICLE_MOVING', 'VEHICLE_STOPPED', 'POSSIBLE_PARKING'].includes(snap.state);
    for (const [, v] of this.voiced) {
      if (v.n !== 1) continue;
      const d = Math.round(distanceM(last, v.spot));
      v.dists.push({ t: now, d });
      while (v.dists.length > 0 && now - v.dists[0].t > 30_000) v.dists.shift();
      const approaching = v.dists.length > 1 && v.dists[0].d - d >= cfg.COMMUNITY_APPROACH_M;
      if (d > cfg.COMMUNITY_SECOND_VOICE_M || !approaching || !driving) continue;
      v.n = 2;
      const s = v.spot;
      void getPref('voice').then((on) => {
        if (!on) return;
        const where = s.address ? `in ${s.address}` : 'che ti avevo segnalato';
        const m = Math.round(d / 10) * 10;
        if (s.kind === 'FREED') speak(`Il posto ${where} è libero, a ${m} metri.`);
        else {
          const mins = Math.round((s.freeAt - now) / 60000);
          speak(mins <= 0 ? `Il posto ${where} si sta liberando ora, a ${m} metri.` : `Il posto ${where} si libera tra ${mins === 1 ? 'un minuto' : `${mins} minuti`}, a ${m} metri.`);
        }
      });
    }
  }
}

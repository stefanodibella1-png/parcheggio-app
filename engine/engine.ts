// PARCHEGGIO — motore di rilevamento.
//
// Deterministico: il tempo arriva SOLO dagli input (mai Date.now()).
// Riceve campioni normalizzati e restituisce eventi con `reason`.
// Nessun input manuale: le etichette di revisione non entrano mai qui.

import type { DetectionConfig } from './config.ts';
import { DEFAULT_CONFIG } from './config.ts';
import {
  angleDiff,
  bearingDeg,
  distanceM,
  meanAngle,
  mergePoints,
  round1,
  stabilizedPoint,
} from './geo.ts';
import type {
  ActivitySample,
  ActivityType,
  DetectionEvent,
  EngineInput,
  EngineSnapshot,
  EngineState,
  EventType,
  GeoPoint,
  LocationSample,
  MotionFeatures,
  ParkingSession,
  ParkingSpot,
  PointQuality,
  ReturnInfo,
  Scores,
  SpotAddress,
  GeocodeStatus,
} from './types.ts';

// ---------------------------------------------------------------------------
// Memoria interna (serializzabile in JSON per sopravvivere al riavvio dell'app)

interface SpeedPoint {
  t: number;
  kmh: number;
}

interface Phase {
  startT: number;
  lastT: number;
  fixes: LocationSample[];
  endedT: number | null;
}

interface Departure {
  startT: number;
  /** fix in cui il movimento è iniziato */
  startFix: LocationSample | null;
  startDistM: number | null;
  maxDistM: number;
  lastDistM: number;
  maxKmh: number;
  regressions: number;
  gpsGapS: number;
  lastFixT: number;
  vehicleScoreAtConfirm: number;
  sawVehicleActivity: boolean;
  departureHeadings: number[];
}

interface Memory {
  v: 1;
  idPrefix: string;
  eventSeq: number;
  parkingSeq: number;
  state: EngineState;
  stateSinceT: number;
  lastT: number;
  lastReason: string | null;

  lastFixAny: LocationSample | null;
  lastFixAnyKmh: number | null;
  fixes: LocationSample[]; // fix validi, ultimi 5 minuti
  speeds: SpeedPoint[]; // ultimi 60 s
  headings: { t: number; h: number }[]; // in movimento, ultimi 30 s
  lastValidActivity: ActivitySample | null;
  lastActivityAny: ActivitySample | null;
  steps: { t: number; steps: number }[]; // ultimi 20 s
  hasMotion: boolean;

  vehicleOkSince: number | null;
  vehicleFastSince: number | null;
  walkingOkSince: number | null;
  lastWalkT: number | null;
  stopSince: number | null;
  resumeSince: number | null;
  stillSinceT: number | null; // per WALKING → UNKNOWN

  stillPhase: Phase | null;
  lastStillPhase: Phase | null;
  motionStartFix: LocationSample | null;

  stopPhase: Phase | null;
  arrivalHeading: number | null;

  session: ParkingSession | null;
  sessions: ParkingSession[];
  departure: Departure | null;
  departureCandidateSince: number | null;
  awayVehicleLogged: boolean;
  farSince?: number | null;

  returnSeries: { t: number; d: number }[];
  /** fix scartato come salto, in attesa di conferma da un secondo fix coerente */
  returnJump: { t: number; d: number } | null;
  /** semafori noti (chiave = lat,lon arrotondati) */
  signals: Record<string, { latitude: number; longitude: number }>;
  /** distributori di carburante noti */
  fuel: Record<string, { latitude: number; longitude: number }>;

  drivePath?: { t: number; latitude: number; longitude: number }[];
  search?: { startT: number; distanceM: number; lastT: number; endedT: number | null } | null;

  scores: Scores;
  lastSnapshotT: number;
  pendingSnapshots: EngineSnapshot[];
}

const ZERO: Scores = { vehicle: 0, walking: 0, parking: 0, departure: 0, release: 0, return: 0, search: 0 };

const DRIVING: EngineState[] = ['IN_VEHICLE', 'VEHICLE_MOVING', 'VEHICLE_STOPPED', 'POSSIBLE_PARKING'];

const PARKED_FAMILY: EngineState[] = [
  'PARKED',
  'PARKED_USER_AWAY',
  'RETURN_PREDICTED',
  'USER_RETURNING',
  'DEPARTURE_CANDIDATE',
];

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}
function r1(x: number): number {
  return Math.round(x * 10) / 10;
}
function secs(ms: number): number {
  return Math.round(ms / 1000);
}
function fmtDur(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m${String(s % 60).padStart(2, '0')}s` : `${s}s`;
}

export function qualityOf(accuracyM: number, cfg: DetectionConfig): PointQuality {
  if (accuracyM <= cfg.SPOT_GOOD_ACCURACY) return 'A';
  if (accuracyM <= cfg.SPOT_FAIR_ACCURACY) return 'B';
  return 'C';
}

// ---------------------------------------------------------------------------

export class DetectionEngine {
  readonly cfg: DetectionConfig;
  private m: Memory;
  private out: DetectionEvent[] = [];

  constructor(cfg: DetectionConfig = DEFAULT_CONFIG, idPrefix = 'T') {
    this.cfg = cfg;
    this.m = {
      v: 1,
      idPrefix,
      eventSeq: 0,
      parkingSeq: 0,
      state: 'UNKNOWN',
      stateSinceT: 0,
      lastT: 0,
      lastReason: null,
      lastFixAny: null,
      lastFixAnyKmh: null,
      fixes: [],
      speeds: [],
      headings: [],
      lastValidActivity: null,
      lastActivityAny: null,
      steps: [],
      hasMotion: false,
      vehicleOkSince: null,
      vehicleFastSince: null,
      walkingOkSince: null,
      lastWalkT: null,
      stopSince: null,
      resumeSince: null,
      stillSinceT: null,
      stillPhase: null,
      lastStillPhase: null,
      motionStartFix: null,
      stopPhase: null,
      arrivalHeading: null,
      session: null,
      sessions: [],
      departure: null,
      departureCandidateSince: null,
      awayVehicleLogged: false,
      farSince: null,
      returnSeries: [],
      returnJump: null,
      signals: {},
      fuel: {},
      drivePath: [],
      search: null,
      scores: { ...ZERO },
      lastSnapshotT: 0,
      pendingSnapshots: [],
    };
  }

  // ----- persistenza -------------------------------------------------------

  serialize(): string {
    return JSON.stringify(this.m);
  }

  static restore(json: string, cfg: DetectionConfig = DEFAULT_CONFIG): DetectionEngine {
    const e = new DetectionEngine(cfg);
    const parsed = JSON.parse(json) as Memory;
    if (parsed.v !== 1) throw new Error('Versione stato motore non supportata');
    e.m = parsed;
    return e;
  }

  // ----- API pubblica -------------------------------------------------------

  get state(): EngineState {
    return this.m.state;
  }

  /** ora dell'input più recente elaborato (serve all'app per riconoscere input arrivati in ritardo) */
  get lastInputT(): number {
    return this.m.lastT;
  }

  getSessions(): ParkingSession[] {
    return this.m.sessions;
  }

  getOpenSession(): ParkingSession | null {
    return this.m.session;
  }

  drainSnapshots(): EngineSnapshot[] {
    const s = this.m.pendingSnapshots;
    this.m.pendingSnapshots = [];
    return s;
  }

  /** Dati esterni (reverse geocoding): non influenzano il rilevamento. */
  setSpotAddress(
    parkingId: string,
    patch: {
      address: SpotAddress | null;
      addressSource: string | null;
      addressDistanceM: number | null;
      geocodedAt: number | null;
      geocodeStatus: GeocodeStatus;
    },
  ): void {
    const s = this.m.sessions.find((x) => x.parkingId === parkingId);
    if (s) Object.assign(s.spot, patch);
  }

  setRecurring(parkingId: string, recurring: boolean): void {
    const s = this.m.sessions.find((x) => x.parkingId === parkingId);
    if (s) s.spot.recurringSpot = recurring;
  }

  /** Elabora un input e restituisce gli eventi generati. */
  process(input: EngineInput): DetectionEvent[] {
    this.out = [];
    const t = input.kind === 'location' || input.kind === 'activity' || input.kind === 'motion'
      ? input.sample.t
      : input.t;
    if (this.m.stateSinceT === 0) this.m.stateSinceT = t;
    if (t > this.m.lastT) this.m.lastT = t;
    const now = this.m.lastT;

    switch (input.kind) {
      case 'location':
        this.onLocation(input.sample);
        break;
      case 'activity':
        this.onActivity(input.sample);
        break;
      case 'motion':
        this.onMotion(input.sample);
        break;
      case 'carryOver':
        this.onCarryOver(input, now);
        break;
      case 'mapFeatures':
        if (!this.m.signals) this.m.signals = {};
        for (const g of input.signals) {
          const k = `${g.latitude.toFixed(5)},${g.longitude.toFixed(5)}`;
          this.m.signals[k] = { latitude: g.latitude, longitude: g.longitude };
        }
        if (!this.m.fuel) this.m.fuel = {};
        for (const g of input.fuel ?? []) {
          this.m.fuel[`${g.latitude.toFixed(5)},${g.longitude.toFixed(5)}`] = { latitude: g.latitude, longitude: g.longitude };
        }
        break;
      default:
        break;
    }
    this.prune(now);
    this.evaluate(now);
    if (now - this.m.lastSnapshotT >= this.cfg.SNAPSHOT_EVERY_S * 1000) {
      this.m.lastSnapshotT = now;
      this.m.pendingSnapshots.push(this.snapshot());
      if (this.m.pendingSnapshots.length > 2000) this.m.pendingSnapshots.shift();
    }
    return this.out;
  }

  /** ultimi 3 fix validi, ravvicinati, tutti in movimento (>= 5 km/h) e abbastanza precisi */
  private sustainedMove(now: number): boolean {
    const f = this.m.fixes.slice(-3);
    if (f.length < 3 || now - f[0].t > 8000) return false;
    return f.every((x) => x.accuracy <= 20 && x.speed !== null && x.speed >= 1.4);
  }

  /** distanza dal semaforo noto più vicino (m), null se nessuno entro 200 m */
  private nearestSignal(p: { latitude: number; longitude: number }): number | null {
    return this.nearestOf(this.m.signals ?? {}, p);
  }

  private nearestOf(set: Record<string, { latitude: number; longitude: number }>, p: { latitude: number; longitude: number }): number | null {
    let best: number | null = null;
    for (const g of Object.values(set)) {
      if (Math.abs(g.latitude - p.latitude) > 0.002 || Math.abs(g.longitude - p.longitude) > 0.003) continue;
      const d = distanceM(p, g);
      if (best === null || d < best) best = d;
    }
    return best;
  }

  /** Riprende l'auto parcheggiata rilevata nel test precedente (solo a inizio test, senza sessione aperta). */
  private onCarryOver(i: Extract<EngineInput, { kind: 'carryOver' }>, now: number): void {
    const m = this.m;
    if (m.session || !(m.state === 'UNKNOWN' || m.state === 'WALKING')) return;
    const parkingId = `${m.idPrefix}-P${++m.parkingSeq}`;
    const session: ParkingSession = {
      parkingId,
      startT: i.parkedT,
      parkedT: i.parkedT,
      endT: null,
      durationS: null,
      outcome: 'OPEN',
      inferred: false,
      spot: { ...i.spot },
      releaseConfidence: null,
      realDepartureT: null,
      exitedOnFoot: i.exitedOnFoot,
      gpsLostAtPark: i.gpsLostAtPark,
    };
    m.session = session;
    m.sessions.push(session);
    m.returnSeries = [];
    this.transition('PARKED', `auto parcheggiata ripresa dal test precedente (${i.fromTestId}, ${fmtDur(now - i.parkedT)} fa)`, now, {
      parkingId,
    });
  }

  snapshot(): EngineSnapshot {
    const m = this.m;
    const now = m.lastT;
    const fix = m.lastFixAny;
    const act = this.currentActivity(now);
    return {
      t: now,
      state: m.state,
      stateSinceT: m.stateSinceT,
      scores: { ...m.scores },
      speedKmh: m.lastFixAnyKmh === null ? null : r1(m.lastFixAnyKmh),
      gpsAccuracyM: fix ? r1(fix.accuracy) : null,
      lastFixAgeS: fix ? r1((now - fix.t) / 1000) : null,
      distanceFromParkingM: this.distanceFromSpot(now),
      activity: act ? act.activity : m.lastActivityAny ? m.lastActivityAny.activity : null,
      activityConfidence: act ? act.confidence : m.lastActivityAny ? m.lastActivityAny.confidence : null,
      lastReason: m.lastReason,
      parkingId: m.session ? m.session.parkingId : null,
      returnInfo: this.returnInfo(now),
      searchingSinceT: m.search && m.search.endedT === null ? m.search.startT : null,
    };
  }

  // ----- ingresso campioni ---------------------------------------------------

  private onLocation(raw: LocationSample): void {
    const cfg = this.cfg;
    const m = this.m;
    const s: LocationSample = {
      ...raw,
      speed: raw.speed === null || raw.speed === undefined || raw.speed < 0 ? null : raw.speed,
    };
    if (s.speed !== null && s.speed < cfg.HEADING_MIN_SPEED_MS) s.heading = null;
    if (s.heading !== undefined && s.heading !== null && s.heading < 0) s.heading = null;

    const valid = s.accuracy <= cfg.GPS_ACCURACY_LIMIT;
    let kmh: number | null = s.speed !== null ? s.speed * 3.6 : null;
    if (valid && kmh === null) {
      const prev = m.fixes[m.fixes.length - 1];
      if (prev && s.t > prev.t && (s.t - prev.t) / 1000 <= cfg.DERIVED_SPEED_MAX_GAP_S) {
        // prudente: lo spostamento entro l'incertezza dei due fix non conta come movimento
        const moved = Math.max(0, distanceM(prev, s) - (prev.accuracy + s.accuracy) / 2);
        kmh = (moved / ((s.t - prev.t) / 1000)) * 3.6;
      }
    }
    m.lastFixAny = s;
    m.lastFixAnyKmh = kmh;
    if (!valid) return; // scartato: registrato nell'export ma non usato

    m.fixes.push(s);
    if (DRIVING.includes(m.state)) {
      if (!m.drivePath) m.drivePath = [];
      const prev = m.drivePath[m.drivePath.length - 1];
      if (m.search && m.search.endedT === null && prev && s.t - prev.t <= 10_000) {
        m.search.distanceM += distanceM(prev, s);
        m.search.lastT = s.t;
      }
      m.drivePath.push({ t: s.t, latitude: s.latitude, longitude: s.longitude });
    } else if (m.drivePath && m.drivePath.length) {
      m.drivePath = [];
    }
    if (kmh !== null) m.speeds.push({ t: s.t, kmh });
    if (s.heading !== null && s.heading !== undefined && kmh !== null && kmh >= 5) {
      m.headings.push({ t: s.t, h: s.heading });
    }

    // inizio del movimento (per i controlli sul raggio di partenza)
    if (kmh !== null) {
      if (kmh <= 3) {
        m.motionStartFix = null;
      } else if (kmh > 5 && m.motionStartFix === null) {
        const still = m.stillPhase ?? m.lastStillPhase;
        const lastStill = still && still.fixes.length > 0 ? still.fixes[still.fixes.length - 1] : null;
        // la fase ferma vale solo se è appena finita e qui vicino
        m.motionStartFix = lastStill && s.t - lastStill.t <= 30_000 && distanceM(lastStill, s) <= 40 ? lastStill : s;
      }
    }

    // fase ferma (punto di parcheggio alla partenza e flusso E)
    const stationary = kmh !== null ? kmh <= cfg.MAX_PARKING_SPEED : false;
    if (stationary) {
      const ph = m.stillPhase;
      if (ph && distanceM(ph.fixes[0], s) <= 15) {
        ph.fixes.push(s);
        ph.lastT = s.t;
        if (ph.fixes.length > 300) ph.fixes.shift();
      } else {
        m.stillPhase = { startT: s.t, lastT: s.t, fixes: [s], endedT: null };
      }
    } else if (kmh !== null && kmh > cfg.MAX_PARKING_SPEED + 1 && m.stillPhase) {
      m.stillPhase.endedT = s.t;
      m.lastStillPhase = m.stillPhase;
      m.stillPhase = null;
    }

    // fase di sosta del veicolo
    if (m.stopPhase && (m.state === 'VEHICLE_STOPPED' || m.state === 'POSSIBLE_PARKING')) {
      if (stationary || distanceM(m.stopPhase.fixes[0] ?? s, s) <= 15) {
        m.stopPhase.fixes.push(s);
        m.stopPhase.lastT = s.t;
        if (m.stopPhase.fixes.length > 600) m.stopPhase.fixes.shift();
      }
    }

    // serie per la previsione del ritorno
    if (valid && m.session && (m.state === 'PARKED_USER_AWAY' || m.state === 'RETURN_PREDICTED')) {
      const d = distanceM(m.session.spot.pointFinal, s);
      const prev = m.returnSeries[m.returnSeries.length - 1];
      // salto GPS (es. fix di rete a centinaia di metri): non è un movimento a piedi
      const jump =
        prev && s.t > prev.t && Math.abs(d - prev.d) - s.accuracy > cfg.RETURN_MAX_WALK_SPEED_MS * ((s.t - prev.t) / 1000);
      if (!jump) {
        m.returnSeries.push({ t: s.t, d });
        m.returnJump = null;
      } else if (m.returnJump && Math.abs(m.returnJump.d - d) <= 30 && s.t - m.returnJump.t >= 30_000) {
        // due fix coerenti tra loro per almeno 30 s: la posizione è davvero cambiata, si riparte da qui
        m.returnSeries = [m.returnJump, { t: s.t, d }];
        m.returnJump = null;
      } else if (!m.returnJump || Math.abs(m.returnJump.d - d) > 30) {
        m.returnJump = { t: s.t, d };
      }
    }

    // partenza in corso
    const dep = m.departure;
    if (dep && m.session) {
      const d = distanceM(m.session.spot.pointFinal, s);
      if (dep.lastFixT && (s.t - dep.lastFixT) / 1000 > 20) dep.gpsGapS += (s.t - dep.lastFixT) / 1000;
      if (d < dep.maxDistM - 10) dep.regressions += 1;
      dep.maxDistM = Math.max(dep.maxDistM, d);
      dep.lastDistM = d;
      dep.lastFixT = s.t;
      if (kmh !== null) dep.maxKmh = Math.max(dep.maxKmh, kmh);
      if (s.heading !== null && s.heading !== undefined && dep.departureHeadings.length < 10 && kmh !== null && kmh >= 5) {
        dep.departureHeadings.push(s.heading);
      }
    }
  }

  private onActivity(a: ActivitySample): void {
    this.m.lastActivityAny = a;
    if (a.activity !== 'UNKNOWN' && a.confidence >= this.cfg.ACTIVITY_MIN_CONFIDENCE) {
      // non sostituire con un campione più vecchio arrivato in ritardo
      if (!this.m.lastValidActivity || a.t >= this.m.lastValidActivity.t) {
        this.m.lastValidActivity = a;
      }
    }
    if (this.m.departure && a.activity === 'IN_VEHICLE' && a.confidence >= this.cfg.ACTIVITY_MIN_CONFIDENCE) {
      this.m.departure.sawVehicleActivity = true;
    }
  }

  private onMotion(f: MotionFeatures): void {
    this.m.hasMotion = true;
    this.m.steps.push({ t: f.t, steps: f.stepCount });
  }

  private prune(now: number): void {
    const m = this.m;
    const cut = (arr: { t: number }[], keepMs: number) => {
      let i = 0;
      while (i < arr.length && now - arr[i].t > keepMs) i++;
      if (i > 0) arr.splice(0, i);
    };
    cut(m.fixes, 300_000);
    cut(m.speeds, 60_000);
    cut(m.headings, 30_000);
    cut(m.steps, 20_000);
    cut(m.returnSeries, 600_000);
    if (m.drivePath) cut(m.drivePath, this.cfg.SEARCH_WINDOW_S * 1000);
  }

  // ----- segnali --------------------------------------------------------------

  private currentActivity(now: number): ActivitySample | null {
    const a = this.m.lastValidActivity;
    if (!a) return null;
    return (now - a.t) / 1000 <= this.cfg.ACTIVITY_HOLD_S ? a : null;
  }

  /** velocità più recente (km/h) da fix validi negli ultimi 5 s */
  private currentKmh(now: number): number | null {
    const sp = this.m.speeds[this.m.speeds.length - 1];
    if (!sp || (now - sp.t) / 1000 > 5) return null;
    return sp.kmh;
  }

  private lastValidFix(now: number, maxAgeS = 15): LocationSample | null {
    const f = this.m.fixes[this.m.fixes.length - 1];
    if (!f || (now - f.t) / 1000 > maxAgeS) return null;
    return f;
  }

  private recentSteps(now: number, windowS = 15): number | null {
    if (!this.m.hasMotion) return null;
    const recent = this.m.steps.filter((x) => (now - x.t) / 1000 <= windowS);
    if (recent.length === 0) return null;
    return recent.reduce((s, x) => s + x.steps, 0);
  }

  private vehicleScore(now: number): number {
    const cfg = this.cfg;
    const w = cfg.W_VEHICLE;
    const win = this.m.speeds.filter((x) => (now - x.t) / 1000 <= cfg.VEHICLE_WINDOW_S);
    let speedComp: number | null = null;
    if (win.length > 0) {
      let s = 0;
      for (const x of win) {
        if (x.kmh >= cfg.VEHICLE_SPEED_MIN) s += 1;
        else if (x.kmh > cfg.WALKING_SPEED_MAX) s += 0.4;
      }
      speedComp = s / win.length;
    }
    const act = this.currentActivity(now);
    let actComp = 0.3; // nessuna informazione
    let penalty = 1;
    if (act) {
      if (act.activity === 'IN_VEHICLE') actComp = act.confidence / 100;
      else if (act.activity === 'STILL') actComp = 0.2;
      else {
        actComp = 0;
        penalty = 0.6; // WALKING / RUNNING / ON_BICYCLE
      }
    }
    const steps = this.recentSteps(now);
    let motionComp = 0.6;
    if (steps !== null) motionComp = steps === 0 ? 1 : steps <= 2 ? 0.5 : 0;

    let score: number;
    if (speedComp === null) {
      // senza velocità GPS il veicolo non si conferma: tetto a 60
      score = Math.min(60, 100 * ((w.activity * actComp + w.motion * motionComp) / (w.activity + w.motion)));
    } else {
      score = 100 * (w.speed * speedComp + w.activity * actComp + w.motion * motionComp);
    }
    return r1(score * penalty);
  }

  private walkingScore(now: number): number {
    const cfg = this.cfg;
    const w = cfg.W_WALKING;
    const win = this.m.speeds.filter((x) => (now - x.t) / 1000 <= 10);
    let speedComp: number | null = null;
    if (win.length > 0) {
      const ok = win.filter((x) => x.kmh >= 1.5 && x.kmh <= cfg.WALKING_SPEED_MAX).length;
      const fast = win.filter((x) => x.kmh > cfg.WALKING_SPEED_MAX + 3).length;
      speedComp = fast > win.length / 3 ? 0 : ok / win.length;
    }
    const act = this.currentActivity(now);
    let actComp: number | null = null;
    if (act) {
      if (act.activity === 'WALKING' || act.activity === 'RUNNING') actComp = act.confidence / 100;
      else if (act.activity === 'IN_VEHICLE') actComp = 0;
      else if (act.activity === 'ON_BICYCLE') actComp = 0;
      else actComp = 0.1;
    }
    const steps = this.recentSteps(now);
    let stepComp: number | null = null;
    if (steps !== null) stepComp = steps >= 4 ? 1 : steps >= 2 ? 0.6 : steps === 1 ? 0.3 : 0;

    // media pesata sulle sole componenti disponibili
    let num = 0;
    let den = 0;
    if (speedComp !== null) {
      num += w.speed * speedComp;
      den += w.speed;
    }
    if (actComp !== null) {
      num += w.activity * actComp;
      den += w.activity;
    }
    if (stepComp !== null) {
      num += w.steps * stepComp;
      den += w.steps;
    }
    if (den < 0.4) return 0; // troppo poche informazioni
    return r1((100 * num) / den);
  }

  private distanceFromSpot(now: number): number | null {
    const s = this.m.session;
    if (!s) return null;
    const f = this.lastValidFix(now, 60);
    if (!f) return null;
    return Math.round(distanceM(s.spot.pointFinal, f));
  }

  // ----- macchina a stati -----------------------------------------------------

  private evaluate(now: number): void {
    const cfg = this.cfg;
    const m = this.m;
    const vScore = this.vehicleScore(now);
    const wScore = this.walkingScore(now);
    m.scores.vehicle = vScore;
    m.scores.walking = wScore;

    // conferme con isteresi
    m.vehicleOkSince = vScore >= cfg.MIN_VEHICLE_CONFIDENCE ? (m.vehicleOkSince ?? now) : null;
    m.walkingOkSince = wScore >= cfg.MIN_WALKING_CONFIDENCE ? (m.walkingOkSince ?? now) : null;
    if (wScore >= cfg.MIN_WALKING_CONFIDENCE) m.lastWalkT = now;

    const kmh = this.currentKmh(now);
    const act = this.currentActivity(now);
    const fastOk =
      act !== null &&
      act.activity === 'IN_VEHICLE' &&
      act.confidence >= cfg.ACTIVITY_FAST_CONFIDENCE &&
      kmh !== null &&
      kmh >= cfg.VEHICLE_SPEED_MIN;
    m.vehicleFastSince = fastOk ? (m.vehicleFastSince ?? now) : null;

    const vehicleConfirmed =
      (m.vehicleOkSince !== null && now - m.vehicleOkSince >= cfg.VEHICLE_CONFIRM_S * 1000) ||
      (m.vehicleFastSince !== null &&
        vScore >= cfg.MIN_VEHICLE_CONFIDENCE - 10 &&
        now - m.vehicleFastSince >= cfg.VEHICLE_FAST_CONFIRM_S * 1000);
    const walkingConfirmed =
      m.walkingOkSince !== null && now - m.walkingOkSince >= cfg.WALKING_CONFIRM_S * 1000;

    const stationary = kmh !== null && kmh <= cfg.MAX_PARKING_SPEED;
    m.stopSince = stationary ? (m.stopSince ?? now) : null;
    const resuming = kmh !== null && kmh >= cfg.RESUME_SPEED;
    m.resumeSince = resuming ? (m.resumeSince ?? now) : null;

    const ctx = { now, vScore, wScore, kmh, act, vehicleConfirmed, walkingConfirmed, stationary };

    switch (m.state) {
      case 'UNKNOWN':
      case 'WALKING':
      case 'LOW_CONFIDENCE':
      case 'ERROR':
        this.evalFree(ctx);
        break;
      case 'IN_VEHICLE':
      case 'VEHICLE_MOVING':
        this.evalMoving(ctx);
        break;
      case 'VEHICLE_STOPPED':
      case 'POSSIBLE_PARKING':
        this.evalStopped(ctx);
        break;
      case 'PARKED':
      case 'USER_RETURNING':
        this.evalParkedNear(ctx);
        break;
      case 'PARKED_USER_AWAY':
      case 'RETURN_PREDICTED':
        this.evalAway(ctx);
        break;
      case 'DEPARTURE_CANDIDATE':
        this.evalDepartureCandidate(ctx);
        break;
      case 'VEHICLE_DEPARTED':
        this.evalDeparted(ctx);
        break;
      case 'PARKING_RELEASED':
        this.transition('VEHICLE_MOVING', 'guida dopo il rilascio del parcheggio', now);
        break;
    }

    // score informativi
    m.scores.parking = this.parkingScore(now);
    m.scores.departure = m.state === 'DEPARTURE_CANDIDATE' || m.state === 'VEHICLE_DEPARTED' ? vScore : 0;
    m.scores.return = m.state === 'PARKED_USER_AWAY' || m.state === 'RETURN_PREDICTED' ? this.returnScore(now) : 0;
    this.evalSearch(now);
    if (m.state !== 'VEHICLE_DEPARTED') m.scores.release = 0;
  }

  // nessun parcheggio aperto, non in veicolo
  private evalFree(c: Ctx): void {
    const m = this.m;
    const cfg = this.cfg;
    if (c.vehicleConfirmed && c.kmh !== null && c.kmh > cfg.WALKING_SPEED_MAX) {
      if (this.tryColdStart(c)) return;
      this.transition('IN_VEHICLE', `probabile veicolo: score ${c.vScore}${this.fastNote(c.now)}`, c.now);
      this.transition('VEHICLE_MOVING', `velocità ${r1(c.kmh)} km/h, movimento continuo`, c.now);
      return;
    }
    if (m.state !== 'WALKING' && c.walkingConfirmed) {
      this.transition('WALKING', `possibile movimento a piedi: score ${c.wScore}`, c.now);
      m.stillSinceT = null;
      return;
    }
    if (m.state === 'WALKING') {
      const still = c.stationary || (c.act !== null && c.act.activity === 'STILL');
      m.stillSinceT = still && c.wScore < cfg.MIN_WALKING_CONFIDENCE ? (m.stillSinceT ?? c.now) : null;
      if (m.stillSinceT !== null && c.now - m.stillSinceT >= cfg.STILL_RESET_S * 1000) {
        this.transition('UNKNOWN', `fermo da ${fmtDur(c.now - m.stillSinceT)}: non più a piedi`, c.now);
        m.stillSinceT = null;
      }
    }
  }

  /** Flusso E: camminata → fermo → partenza in veicolo dallo stesso punto. */
  private tryColdStart(c: Ctx): boolean {
    const cfg = this.cfg;
    const m = this.m;
    const still = m.stillPhase ?? m.lastStillPhase;
    if (!still || still.fixes.length < 3) return false;
    const stillDur = (still.lastT - still.startT) / 1000;
    if (stillDur < cfg.COLD_START_MIN_STILL_S) return false;
    // la fase ferma deve essere terminata da poco (partenza appena avvenuta)
    const endT = still.endedT ?? still.lastT;
    if ((c.now - endT) / 1000 > 90) return false;
    if (m.lastWalkT === null) return false;
    if (m.lastWalkT < still.startT - cfg.COLD_START_WALK_LOOKBACK_S * 1000) return false;
    if (m.lastWalkT > endT) return false; // camminata dopo la sosta: non è la sequenza giusta

    const point = stabilizedPoint(still.fixes);
    if (!point) return false;
    const start = m.motionStartFix;
    const startDist = start ? distanceM(point, start) : null;
    if (startDist !== null && startDist > cfg.DEPARTURE_START_RADIUS) return false;

    const parkingId = `${m.idPrefix}-P${++m.parkingSeq}`;
    const spot = this.makeSpot(null, point);
    const session: ParkingSession = {
      parkingId,
      startT: still.startT,
      parkedT: null,
      endT: null,
      durationS: null,
      outcome: 'OPEN',
      inferred: true,
      spot,
      releaseConfidence: null,
      realDepartureT: null,
    };
    m.session = session;
    m.sessions.push(session);
    this.startDeparture(c.now, start, c.vScore);
    this.transition(
      'IN_VEHICLE',
      `probabile veicolo: score ${c.vScore}${this.fastNote(c.now)}`,
      c.now,
    );
    this.transition(
      'VEHICLE_DEPARTED',
      `partenza in veicolo dal punto dove eri fermo da ${fmtDur(stillDur * 1000)} dopo una camminata ` +
        `(auto già parcheggiata all'avvio del test)`,
      c.now,
      { parkingId, distanceM: startDist },
    );
    this.evalDeparted(c);
    return true;
  }

  private evalMoving(c: Ctx): void {
    const cfg = this.cfg;
    const m = this.m;
    if (m.state === 'IN_VEHICLE' && c.kmh !== null && c.kmh >= cfg.VEHICLE_SPEED_MIN) {
      this.transition('VEHICLE_MOVING', `velocità ${r1(c.kmh)} km/h`, c.now);
      return;
    }
    if (m.stopSince !== null && c.now - m.stopSince >= cfg.STOP_CONFIRM_S * 1000) {
      const fixes = m.fixes.filter((f) => f.t >= (m.stopSince as number));
      m.stopPhase = { startT: m.stopSince, lastT: c.now, fixes, endedT: null };
      const hs = m.headings.filter((h) => h.t >= (m.stopSince as number) - 15_000).map((h) => h.h);
      m.arrivalHeading = meanAngle(hs);
      this.transition(
        'VEHICLE_STOPPED',
        `velocità <= ${cfg.MAX_PARKING_SPEED} km/h per ${cfg.STOP_CONFIRM_S} s`,
        c.now,
      );
      return;
    }
    if (c.walkingConfirmed && c.vScore < 40) {
      // sceso dal veicolo senza una sosta rilevata: GPS perso entrando in un garage
      // o in una zona coperta. Il punto è l'ultima posizione certa in auto (qualità C).
      const last = m.fixes[m.fixes.length - 1];
      const gapS = last ? (c.now - last.t) / 1000 : Infinity;
      if (last && gapS <= cfg.NO_GPS_PARK_MAX_GAP_S && gapS >= 20) {
        const pt: GeoPoint = {
          latitude: last.latitude,
          longitude: last.longitude,
          accuracyM: Math.max(cfg.NO_GPS_PARK_ACCURACY_M, last.accuracy),
          fixes: 1,
          spreadM: 0,
        };
        m.stopPhase = null;
        this.openSession(
          c.now,
          `a piedi dopo il veicolo senza sosta visibile: GPS perso ${fmtDur(gapS * 1000)} prima ` +
            `(probabile garage o parcheggio coperto); punto stimato dall'ultima posizione in auto`,
          pt,
        );
        if (m.session) {
          m.session.exitedOnFoot = true;
          m.session.gpsLostAtPark = true;
        }
        return;
      }
      this.transition('WALKING', `movimento a piedi dopo il veicolo: score ${c.wScore}`, c.now);
    }
  }

  private evalStopped(c: Ctx): void {
    const cfg = this.cfg;
    const m = this.m;
    const ph = m.stopPhase;
    if (!ph) {
      this.transition('VEHICLE_MOVING', 'fase di sosta non disponibile', c.now);
      return;
    }
    const stopMs = c.now - ph.startT;
    const anchor = ph.fixes[0] ?? null;
    const f = this.lastValidFix(c.now);
    const moved = anchor && f ? distanceM(anchor, f) : 0;

    // a piedi lontano dal punto di sosta → parcheggio (segnale forte)
    if (c.walkingConfirmed && moved > 15) {
      this.openSession(c.now, `sceso dal veicolo e allontanato a piedi (${Math.round(moved)} m) dopo ${fmtDur(stopMs)} di sosta`);
      if (m.session) m.session.exitedOnFoot = true;
      return;
    }
    // ripartito: semaforo / coda / fermata breve
    const resumed =
      (m.resumeSince !== null && c.now - m.resumeSince >= cfg.RESUME_CONFIRM_S * 1000) ||
      (moved > cfg.RESUME_DISTANCE && c.kmh !== null && c.kmh > cfg.WALKING_SPEED_MAX);
    if (resumed) {
      const kind = stopMs / 1000 <= cfg.SHORT_STOP_MAX_S ? 'semaforo/coda/fermata breve' : 'sosta non diventata parcheggio';
      m.stopPhase = null;
      this.transition('VEHICLE_MOVING', `ripartito dopo ${fmtDur(stopMs)}: ${kind}`, c.now);
      return;
    }
    if (m.state === 'VEHICLE_STOPPED' && stopMs >= cfg.POSSIBLE_PARKING_MIN_STOP_S * 1000) {
      this.transition('POSSIBLE_PARKING', `fermo da ${fmtDur(stopMs)} nello stesso punto`, c.now);
      return;
    }
    if (m.state === 'POSSIBLE_PARKING' && stopMs >= cfg.MIN_PARKING_DURATION_S * 1000) {
      // vicino a un semaforo una lunga attesa in auto non basta: serve la discesa a piedi o una sosta molto lunga
      const sig = anchor ? this.nearestSignal(anchor) : null;
      if (sig !== null && sig <= cfg.SIGNAL_RADIUS_M && stopMs < cfg.SIGNAL_MIN_PARKING_S * 1000) {
        // probabile coda al semaforo: si aspetta (nessun evento)
        return;
      }
      this.openSession(
        c.now,
        `posizione stabile per ${fmtDur(stopMs)} dopo movimento in veicolo` +
          (sig !== null && sig <= cfg.SIGNAL_RADIUS_M ? ` (a ${Math.round(sig)} m da un semaforo)` : ''),
      );
    }
  }

  private openSession(now: number, reason: string, pointOverride: GeoPoint | null = null): void {
    const m = this.m;
    const ph = m.stopPhase;
    const fixes = ph ? ph.fixes : [];
    const point = pointOverride ?? stabilizedPoint(fixes.length > 0 ? fixes : m.fixes.slice(-5));
    if (!point) return;
    const parkingId = `${m.idPrefix}-P${++m.parkingSeq}`;
    const spot = this.makeSpot(point, null);
    spot.arrivalHeading = m.arrivalHeading === null ? null : Math.round(m.arrivalHeading);
    const session: ParkingSession = {
      parkingId,
      startT: ph ? ph.startT : now,
      parkedT: now,
      endT: null,
      durationS: null,
      outcome: 'OPEN',
      inferred: false,
      spot,
      releaseConfidence: null,
      realDepartureT: null,
    };
    const sr = m.search;
    if (sr && (sr.endedT === null || now - sr.endedT <= 120_000)) {
      session.searchStartT = sr.startT;
      session.searchDurationS = Math.max(0, Math.round((session.startT - sr.startT) / 1000));
      session.searchDistanceM = Math.round(sr.distanceM);
    }
    m.search = null;
    m.drivePath = [];
    const fuelD = this.nearestOf(m.fuel ?? {}, point);
    if (fuelD !== null && fuelD <= this.cfg.FUEL_RADIUS_M) session.atFuelStation = true;
    m.session = session;
    m.sessions.push(session);
    m.stopPhase = null;
    m.awayVehicleLogged = false;
    this.transition('PARKED', session.atFuelStation ? `${reason} (distributore di carburante: rifornimento, non condiviso)` : reason, now, { parkingId });
  }

  /**
   * Lontano dall'auto senza essere in un veicolo: si è scesi e si è entrati in un
   * edificio (camminata spesso non riconosciuta con il telefono in tasca e GPS indoor).
   */
  private farFromCar(c: Ctx, d: number | null): boolean {
    const cfg = this.cfg;
    const m = this.m;
    const ok = d !== null && d > cfg.AWAY_FAR_DISTANCE && !c.vehicleConfirmed && (c.kmh === null || c.kmh <= cfg.WALKING_SPEED_MAX);
    if (!ok) {
      m.farSince = null;
      return false;
    }
    m.farSince = m.farSince ?? c.now;
    return c.now - m.farSince >= cfg.AWAY_STILL_S * 1000;
  }

  private evalParkedNear(c: Ctx): void {
    const cfg = this.cfg;
    const m = this.m;
    const d = this.distanceFromSpot(c.now);
    if (c.walkingConfirmed && d !== null) {
      if (m.state === 'PARKED' && d > cfg.AWAY_DISTANCE) {
        m.returnSeries = [];
        this.transition('PARKED_USER_AWAY', `a piedi, ${d} m dall'auto: il parcheggio resta occupato`, c.now);
        return;
      }
      if (m.state === 'USER_RETURNING' && d > cfg.RETURN_RADIUS + 20) {
        m.returnSeries = [];
        this.transition('PARKED_USER_AWAY', `di nuovo lontano dall'auto (${d} m)`, c.now);
        return;
      }
      return; // cammina vicino all'auto
    }
    if (this.farFromCar(c, d)) {
      m.returnSeries = [];
      m.farSince = null;
      this.transition('PARKED_USER_AWAY', `a ${d} m dall'auto da ${this.cfg.AWAY_STILL_S} s senza veicolo: sei sceso, il parcheggio resta occupato`, c.now);
      return;
    }
    // GPS al chiuso: "velocità" fittizie a telefono fermo. Il movimento deve essere sostenuto
    // (3 fix di fila) e non contraddetto dal sistema che dice "fermo" con buona confidenza.
    const stillSaysSystem = c.act?.activity === 'STILL' && (c.act?.confidence ?? 0) >= 60;
    const startMoving =
      c.wScore < 50 &&
      !stillSaysSystem &&
      this.sustainedMove(c.now) &&
      ((c.kmh !== null && c.kmh >= 5 && m.motionStartFix !== null) ||
        (d !== null && d > cfg.RESUME_DISTANCE && c.kmh !== null && c.kmh > cfg.WALKING_SPEED_MAX));
    if (startMoving || c.vehicleConfirmed) {
      m.departureCandidateSince = c.now;
      this.transition('DEPARTURE_CANDIDATE', `movimento dal parcheggio: ${c.kmh === null ? '?' : r1(c.kmh)} km/h, activity ${c.act?.activity ?? 'n/d'}`, c.now);
      this.evalDepartureCandidate(c);
    }
  }

  private evalAway(c: Ctx): void {
    const cfg = this.cfg;
    const m = this.m;
    const d = this.distanceFromSpot(c.now);

    if (c.vehicleConfirmed && c.kmh !== null && c.kmh > cfg.WALKING_SPEED_MAX) {
      const start = m.motionStartFix;
      const startD = start && m.session ? distanceM(m.session.spot.pointFinal, start) : null;
      const radius = m.session?.gpsLostAtPark ? cfg.NO_GPS_DEPARTURE_RADIUS : cfg.DEPARTURE_START_RADIUS;
      if (startD !== null && startD <= radius) {
        // tornato all'auto senza che lo vedessimo vicino (es. GPS assente)
        m.departureCandidateSince = c.now;
        this.transition('DEPARTURE_CANDIDATE', `veicolo partito a ${Math.round(startD)} m dal punto di parcheggio`, c.now);
        this.evalDepartureCandidate(c);
        return;
      }
      if (!m.awayVehicleLogged) {
        m.awayVehicleLogged = true;
        this.emit(
          'LOW_CONFIDENCE',
          m.state,
          m.state,
          `partenza in veicolo lontano dal punto di parcheggio (${startD === null ? '?' : Math.round(startD)} m): ` +
            `probabile altro mezzo, il parcheggio resta aperto`,
          c.now,
        );
      }
      return;
    }
    if (!c.vehicleConfirmed && c.kmh !== null && c.kmh <= cfg.WALKING_SPEED_MAX) m.awayVehicleLogged = false;

    if (d !== null && d <= cfg.RETURN_RADIUS) {
      this.transition('USER_RETURNING', `di nuovo vicino all'auto (${d} m)`, c.now);
      return;
    }
    const rs = this.returnScore(c.now);
    if (m.state === 'PARKED_USER_AWAY' && rs >= cfg.RETURN_MIN_CONFIDENCE) {
      const ri = this.returnInfo(c.now);
      this.transition(
        'RETURN_PREDICTED',
        `si sta avvicinando all'auto: ${ri ? ri.distanceM : '?'} m, ETA ${ri && ri.etaS !== null ? fmtDur(ri.etaS * 1000) : 'n/d'}, score ${rs}`,
        c.now,
      );
      return;
    }
    if (m.state === 'RETURN_PREDICTED') {
      const series = m.returnSeries.filter((x) => (c.now - x.t) / 1000 <= cfg.RETURN_CANCEL_S);
      if (series.length >= 2 && series[series.length - 1].d - Math.min(...series.map((x) => x.d)) > 20) {
        this.transition('PARKED_USER_AWAY', 'previsione di ritorno annullata: si sta di nuovo allontanando', c.now);
      }
    }
  }

  private evalDepartureCandidate(c: Ctx): void {
    const cfg = this.cfg;
    const m = this.m;
    const since = m.departureCandidateSince ?? c.now;
    if (c.vehicleConfirmed && c.kmh !== null && c.kmh > cfg.WALKING_SPEED_MAX) {
      this.startDeparture(c.now, m.motionStartFix, c.vScore);
      this.transition('VEHICLE_DEPARTED', `movimento compatibile con veicolo: score ${c.vScore}${this.fastNote(c.now)}`, c.now);
      this.evalDeparted(c);
      return;
    }
    if (c.walkingConfirmed) {
      const d = this.distanceFromSpot(c.now);
      if (d !== null && d > cfg.AWAY_DISTANCE) {
        m.returnSeries = [];
        this.transition('PARKED_USER_AWAY', `era camminata, non partenza (${d} m dall'auto)`, c.now);
      } else {
        this.transition('PARKED', 'era camminata vicino all\'auto, non partenza', c.now);
      }
      return;
    }
    const d = this.distanceFromSpot(c.now);
    if (this.farFromCar(c, d)) {
      m.returnSeries = [];
      m.farSince = null;
      this.transition('PARKED_USER_AWAY', `nessun veicolo, a ${d} m dall'auto: era uno spostamento a piedi`, c.now);
      return;
    }
    if (c.now - since >= cfg.DEPARTURE_CANDIDATE_TIMEOUT_S * 1000) {
      if (d !== null && d > cfg.AWAY_DISTANCE) {
        m.returnSeries = [];
        this.transition('PARKED_USER_AWAY', `nessuna partenza confermata in ${cfg.DEPARTURE_CANDIDATE_TIMEOUT_S} s, a ${d} m dall'auto`, c.now);
      } else {
        this.transition('PARKED', `nessuna partenza confermata in ${cfg.DEPARTURE_CANDIDATE_TIMEOUT_S} s`, c.now);
      }
    }
  }

  private startDeparture(now: number, startFix: LocationSample | null, vScore: number): void {
    const m = this.m;
    const spot = m.session?.spot.pointFinal ?? null;
    const f = this.lastValidFix(now);
    const d = spot && f ? distanceM(spot, f) : 0;
    // Distanza dal punto all'inizio della partenza: la minima nei 2 minuti prima.
    // (Test del 07/10 sera: il "punto di inizio movimento" era rimasto quello di casa,
    // a 70-86 m, e due partenze vere erano finite LOW_CONFIDENCE.)
    let startDist: number | null = spot && startFix ? distanceM(spot, startFix) : null;
    let nearest: LocationSample | null = null;
    if (spot) {
      for (const fx of m.fixes) {
        if (now - fx.t > 120_000) continue;
        const dd = distanceM(spot, fx);
        if (startDist === null || dd < startDist) {
          startDist = dd;
          nearest = fx;
        }
      }
    }
    const begin = nearest && (!startFix || nearest.t > startFix.t) ? nearest : startFix;
    m.departure = {
      startT: begin ? begin.t : now,
      startFix: begin,
      startDistM: startDist,
      maxDistM: d,
      lastDistM: d,
      maxKmh: this.currentKmh(now) ?? 0,
      regressions: 0,
      gpsGapS: 0,
      lastFixT: f ? f.t : now,
      vehicleScoreAtConfirm: vScore,
      sawVehicleActivity: this.currentActivity(now)?.activity === 'IN_VEHICLE',
      departureHeadings: [],
    };
  }

  private evalDeparted(c: Ctx): void {
    const cfg = this.cfg;
    const m = this.m;
    const s = m.session;
    const dep = m.departure;
    if (!s || !dep) {
      this.transition('VEHICLE_MOVING', 'partenza senza parcheggio aperto', c.now);
      return;
    }
    const d = dep.lastDistM;
    const { score, checks } = s.inferred ? this.inferredReleaseScore(c, dep, s) : this.releaseScore(c, dep, s);
    m.scores.release = score;

    if (d >= cfg.MIN_DEPARTURE_DISTANCE) {
      const min = s.inferred ? cfg.MIN_INFERRED_RELEASE_CONFIDENCE : cfg.MIN_RELEASE_CONFIDENCE;
      if (score >= min) {
        this.closeSession(c.now, s.inferred ? 'RELEASED_INFERRED' : 'RELEASED', score);
        const durTxt = s.parkedT !== null ? `PARKED per ${fmtDur(dep.startT - (s.parkedT ?? dep.startT))}; ` : '';
        this.transition(
          'PARKING_RELEASED',
          `${durTxt}${checks.filter((x) => x.startsWith('✓')).map((x) => x.slice(2)).join('; ')}; ` +
            `${s.exitedOnFoot || s.inferred ? '' : 'nessuna discesa a piedi (possibile coda o attesa in auto, non condiviso); '}confidence ${score}`,
          c.now,
          { parkingId: s.parkingId, distanceM: Math.round(d), checks, eventType: s.inferred ? 'PARKING_RELEASED_INFERRED' : 'PARKING_RELEASED' },
        );
        this.transition('VEHICLE_MOVING', 'guida dopo il rilascio del parcheggio', c.now);
        return;
      }
      if (d >= cfg.RELEASE_GIVE_UP_DISTANCE) {
        this.closeSession(c.now, 'LOW_CONFIDENCE', score);
        this.transition(
          'LOW_CONFIDENCE',
          `partenza a ${Math.round(d)} m ma confidence insufficiente (${score} < ${min}): ${checks.filter((x) => x.startsWith('✗')).map((x) => x.slice(2)).join('; ')}`,
          c.now,
          { parkingId: s.parkingId, distanceM: Math.round(d), checks },
        );
        this.transition('VEHICLE_MOVING', 'guida (rilascio non confermato)', c.now);
        return;
      }
    }
    // falsa partenza: di nuovo fermo vicino al punto
    if (d < cfg.MIN_DEPARTURE_DISTANCE && m.stopSince !== null && c.now - m.stopSince >= cfg.POSSIBLE_PARKING_MIN_STOP_S * 1000) {
      m.departure = null;
      if (s.inferred) {
        // nel flusso E non c'era un parcheggio confermato: si annulla
        s.outcome = 'ABANDONED';
        s.endT = c.now;
        m.session = null;
        this.transition('UNKNOWN', 'partenza non proseguita: sessione dedotta annullata', c.now);
      } else {
        this.transition('PARKED', `falsa partenza: di nuovo fermo a ${Math.round(d)} m dal punto`, c.now);
      }
    }
  }

  private releaseScore(c: Ctx, dep: Departure, s: ParkingSession): { score: number; checks: string[] } {
    const cfg = this.cfg;
    const w = cfg.W_RELEASE;
    const checks: string[] = [];
    let score = 0;
    const parkedMs = dep.startT - (s.parkedT ?? s.startT);
    const stopMs = dep.startT - s.startT;
    if (stopMs >= cfg.MIN_PARKING_DURATION_S * 1000) {
      score += w.parkedLongEnough;
      checks.push(`✓ sosta di ${fmtDur(stopMs)}`);
    } else checks.push(`✗ sosta breve (${fmtDur(stopMs)})`);
    void parkedMs;
    if (dep.startDistM !== null && dep.startDistM <= cfg.DEPARTURE_START_RADIUS) {
      score += w.startNearSpot;
      checks.push(`✓ partenza a ${Math.round(dep.startDistM)} m dal punto di parcheggio`);
    } else if (dep.startDistM === null) {
      score += w.startNearSpot / 2;
      checks.push('✗ punto di inizio partenza non misurato (GPS)');
    } else checks.push(`✗ partenza lontana dal punto (${Math.round(dep.startDistM)} m)`);
    score += w.vehicleScore * clamp01(Math.max(dep.vehicleScoreAtConfirm, c.vScore) / 100);
    checks.push(`${c.vScore >= cfg.MIN_VEHICLE_CONFIDENCE ? '✓' : '✗'} movimento in veicolo (score ${Math.max(dep.vehicleScoreAtConfirm, c.vScore)})`);
    if (dep.sawVehicleActivity) checks.push('✓ activity recognition = IN_VEHICLE');
    const continuous = dep.regressions <= 1 && dep.gpsGapS < 30;
    if (dep.lastDistM >= cfg.MIN_DEPARTURE_DISTANCE) {
      score += continuous ? w.distance : w.distance / 2;
      checks.push(`${continuous ? '✓' : '✗'} distanza dal punto ${Math.round(dep.lastDistM)} m${continuous ? ', movimento continuo' : ', con interruzioni/GPS perso'}`);
    }
    if (dep.maxKmh >= 20) {
      score += w.maxSpeed;
      checks.push(`✓ velocità salita a ${r1(dep.maxKmh)} km/h`);
    } else {
      score += (w.maxSpeed * dep.maxKmh) / 20;
      checks.push(`✗ velocità massima ${r1(dep.maxKmh)} km/h`);
    }
    const q = s.spot.pointQuality;
    score += q === 'A' ? w.spotQuality : q === 'B' ? w.spotQuality * 0.6 : w.spotQuality * 0.2;
    checks.push(`${q === 'C' ? '✗' : '✓'} qualità punto ${q} (±${s.spot.pointFinal.accuracyM} m)`);
    return { score: r1(Math.min(100, score)), checks };
  }

  private inferredReleaseScore(c: Ctx, dep: Departure, s: ParkingSession): { score: number; checks: string[] } {
    const cfg = this.cfg;
    const w = cfg.W_INFERRED;
    const m = this.m;
    const checks: string[] = [];
    let score = 0;
    if (m.lastWalkT !== null) {
      score += w.priorWalk;
      checks.push('✓ camminata prima della sosta');
    }
    const stillS = (dep.startT - s.startT) / 1000;
    score += w.stillPhase * clamp01(stillS / 45);
    checks.push(`✓ fermo nello stesso punto per ${fmtDur(stillS * 1000)} prima di partire`);
    if (dep.sawVehicleActivity) {
      score += w.vehicleActivity;
      checks.push('✓ activity recognition = IN_VEHICLE');
    } else checks.push('✗ activity IN_VEHICLE non osservata');
    score += w.vehicleScore * clamp01(Math.max(dep.vehicleScoreAtConfirm, c.vScore) / 100);
    checks.push(`✓ movimento in veicolo (score ${Math.max(dep.vehicleScoreAtConfirm, c.vScore)})`);
    if (dep.startDistM === null || dep.startDistM <= cfg.DEPARTURE_START_RADIUS) {
      score += w.startNearSpot;
      checks.push(`✓ partenza dal punto (${dep.startDistM === null ? 'n/d' : Math.round(dep.startDistM) + ' m'})`);
    }
    const continuous = dep.regressions <= 1 && dep.gpsGapS < 30;
    if (dep.lastDistM >= cfg.MIN_DEPARTURE_DISTANCE) {
      score += continuous ? w.distance : w.distance / 2;
      checks.push(`${continuous ? '✓' : '✗'} distanza dal punto ${Math.round(dep.lastDistM)} m`);
    }
    checks.push('ℹ parcheggio dedotto: l\'arrivo dell\'auto non è stato osservato');
    return { score: r1(Math.min(100, score)), checks };
  }

  private closeSession(now: number, outcome: ParkingSession['outcome'], score: number): void {
    const m = this.m;
    const s = m.session;
    const dep = m.departure;
    if (!s) return;
    s.endT = dep ? dep.startT : now;
    s.durationS = Math.round((s.endT - s.startT) / 1000);
    s.outcome = outcome;
    s.releaseConfidence = score;
    // raffinamento del punto con la fase ferma prima della partenza (sezione 8.3)
    if (!s.inferred) {
      const still = m.lastStillPhase;
      if (still && still.fixes.length >= 3 && distanceM(s.spot.pointFinal, still.fixes[0]) <= this.cfg.SPOT_MERGE_MAX_M * 2) {
        const p = stabilizedPoint(still.fixes);
        if (p) {
          const fresh = this.makeSpot(s.spot.pointAtPark, p);
          s.spot.pointAtDeparture = fresh.pointAtDeparture;
          s.spot.pointFinal = fresh.pointFinal;
          s.spot.pointQuality = fresh.pointQuality;
          s.spot.pointsDisagreeM = fresh.pointsDisagreeM;
          // il punto è cambiato: l'indirizzo va ricalcolato
          s.spot.geocodeStatus = 'PENDING';
        }
      }
    }
    if (dep) {
      const hs =
        dep.departureHeadings.length > 0
          ? dep.departureHeadings
          : m.headings.filter((x) => x.t >= dep.startT).slice(0, 10).map((x) => x.h);
      const h = meanAngle(hs);
      s.spot.departureHeading = h === null ? null : Math.round(h);
    }
    m.session = null;
    m.departure = null;
  }

  private makeSpot(atPark: GeoPoint | null, atDeparture: GeoPoint | null): ParkingSpot {
    const cfg = this.cfg;
    let final: GeoPoint;
    let disagree: number | null = null;
    if (atPark && atDeparture) {
      const d = distanceM(atPark, atDeparture);
      if (d <= cfg.SPOT_MERGE_MAX_M) final = mergePoints(atPark, atDeparture);
      else {
        disagree = Math.round(d);
        final = atPark.accuracyM <= atDeparture.accuracyM ? atPark : atDeparture;
      }
    } else final = (atPark ?? atDeparture) as GeoPoint;
    return {
      pointAtPark: atPark,
      pointAtDeparture: atDeparture,
      pointFinal: final,
      pointQuality: qualityOf(final.accuracyM, cfg),
      pointsDisagreeM: disagree,
      arrivalHeading: null,
      departureHeading: null,
      address: null,
      addressSource: null,
      addressDistanceM: null,
      geocodedAt: null,
      geocodeStatus: 'PENDING',
      recurringSpot: false,
    };
  }

  // ----- ricerca del parcheggio (sperimentale) -----------------------------------------

  /**
   * Riconosce il "giro in cerca di posto": velocità bassa, percorso tortuoso
   * (molta strada, poco spostamento netto) e ripassaggi dagli stessi punti.
   * Solo informativo: non cambia lo stato e non genera rilasci.
   */
  private evalSearch(now: number): void {
    const cfg = this.cfg;
    const m = this.m;
    if (!DRIVING.includes(m.state)) {
      m.scores.search = 0;
      if (m.search && m.search.endedT === null) m.search.endedT = now;
      return;
    }
    const path = m.drivePath ?? [];
    const score = this.searchScore(path, now);
    m.scores.search = score;
    const sr = m.search;
    if ((!sr || sr.endedT !== null) && score >= cfg.SEARCH_MIN_CONFIDENCE) {
      const start = path[0];
      let len = 0;
      for (let i = 1; i < path.length; i++) if (path[i].t - path[i - 1].t <= 10_000) len += distanceM(path[i - 1], path[i]);
      m.search = { startT: start ? start.t : now, distanceM: len, lastT: now, endedT: null };
      const net = start ? Math.round(distanceM(start, path[path.length - 1])) : 0;
      this.emit(
        'PARKING_SEARCH',
        m.state,
        m.state,
        `probabile ricerca di parcheggio: ${Math.round(len)} m percorsi negli ultimi ${Math.round((now - (start ? start.t : now)) / 1000)} s con spostamento netto di ${net} m (score ${score})`,
        now,
      );
      return;
    }
    if (sr && sr.endedT === null) {
      // uscita dalla ricerca: si torna a guidare veloce
      const last60 = path.filter((x) => now - x.t <= 60_000);
      if (last60.length >= 2) {
        let l = 0;
        for (let i = 1; i < last60.length; i++) l += distanceM(last60[i - 1], last60[i]);
        const dt = (last60[last60.length - 1].t - last60[0].t) / 1000;
        if (dt > 30 && (l / dt) * 3.6 > cfg.SEARCH_EXIT_SPEED) sr.endedT = now;
      }
    }
  }

  private searchScore(path: { t: number; latitude: number; longitude: number }[], now: number): number {
    const cfg = this.cfg;
    if (path.length < 10) return 0;
    const dt = (path[path.length - 1].t - path[0].t) / 1000;
    if (dt < cfg.SEARCH_WINDOW_S * 0.66) return 0;
    let len = 0;
    for (let i = 1; i < path.length; i++) if (path[i].t - path[i - 1].t <= 10_000) len += distanceM(path[i - 1], path[i]);
    if (len < cfg.SEARCH_MIN_PATH_M) return 0;
    const avgKmh = (len / dt) * 3.6;
    let speedComp = 0;
    if (avgKmh >= cfg.SEARCH_MIN_SPEED && avgKmh <= cfg.SEARCH_MAX_SPEED) speedComp = 1;
    else if (avgKmh > cfg.SEARCH_MAX_SPEED && avgKmh <= cfg.SEARCH_MAX_SPEED + 10) speedComp = 0.5;
    const net = distanceM(path[0], path[path.length - 1]);
    const tortuosity = len / Math.max(net, 30);
    const tortComp = clamp01((tortuosity - 1.5) / 1.5);
    // ripassaggi: punti vicini a un punto di almeno 60 s prima
    let revisits = 0;
    let checked = 0;
    for (let i = 0; i < path.length; i += 3) {
      checked++;
      for (let j = 0; j < i; j += 2) {
        if (path[i].t - path[j].t < 60_000) break;
        if (distanceM(path[i], path[j]) <= cfg.SEARCH_REVISIT_M) {
          revisits++;
          break;
        }
      }
    }
    const revisitComp = clamp01(revisits / Math.max(1, checked) / 0.25);
    void now;
    return r1(100 * (0.3 * speedComp + 0.4 * tortComp + 0.3 * revisitComp));
  }

  // ----- score informativi ------------------------------------------------------

  private parkingScore(now: number): number {
    const m = this.m;
    if (PARKED_FAMILY.includes(m.state)) {
      const q = m.session?.spot.pointQuality;
      return q === 'A' ? 95 : q === 'B' ? 88 : 75;
    }
    if ((m.state === 'VEHICLE_STOPPED' || m.state === 'POSSIBLE_PARKING') && m.stopPhase) {
      const stopS = (now - m.stopPhase.startT) / 1000;
      return r1(Math.min(85, (stopS / this.cfg.MIN_PARKING_DURATION_S) * 85));
    }
    return 0;
  }

  private returnScore(now: number): number {
    // punto dell'auto troppo incerto (garage senza GPS): nessuna previsione
    if (this.m.session?.gpsLostAtPark) return 0;
    return Math.max(this.returnScoreShort(now), this.returnScoreLong(now));
  }

  /** avvicinamento continuo nell'ultimo minuto (GPS frequente) */
  private returnScoreShort(now: number): number {
    const cfg = this.cfg;
    const m = this.m;
    const series = m.returnSeries.filter((x) => (now - x.t) / 1000 <= cfg.RETURN_MIN_APPROACH_TIME_S);
    if (series.length < 4) return 0;
    const first = series[0];
    const last = series[series.length - 1];
    if ((last.t - first.t) / 1000 < cfg.RETURN_MIN_APPROACH_TIME_S * 0.75) return 0;
    const approach = first.d - last.d;
    if (approach <= 0) return 0;
    let dec = 0;
    for (let i = 1; i < series.length; i++) if (series[i].d <= series[i - 1].d + 2) dec++;
    const mono = dec / (series.length - 1);
    const score = 60 * clamp01(approach / cfg.RETURN_MIN_APPROACH_M) + 20 * clamp01((mono - 0.5) / 0.4) + 20 * this.headingToCar(now);
    return r1(score);
  }

  /** avvicinamento netto e marcato su qualche minuto (GPS rado, telefono in tasca) */
  private returnScoreLong(now: number): number {
    const cfg = this.cfg;
    const series = this.m.returnSeries.filter((x) => (now - x.t) / 1000 <= cfg.RETURN_LONG_WINDOW_S);
    if (series.length < 3) return 0;
    const first = series[0];
    const last = series[series.length - 1];
    if ((last.t - first.t) / 1000 < cfg.RETURN_MIN_APPROACH_TIME_S) return 0;
    const maxD = Math.max(...series.map((x) => x.d));
    const minD = Math.min(...series.map((x) => x.d));
    const approach = maxD - last.d;
    // l'ultimo punto deve essere (quasi) il più vicino: si sta ancora avvicinando
    if (approach < cfg.RETURN_LONG_APPROACH_M || last.d > minD + 15) return 0;
    const score = 50 + 30 * clamp01(approach / (cfg.RETURN_LONG_APPROACH_M * 2)) + 20 * this.headingToCar(now);
    return r1(score);
  }

  /** 1 = direzione verso l'auto, 0 = opposta, 0.5 = sconosciuta */
  private headingToCar(now: number): number {
    const m = this.m;
    const f = this.lastValidFix(now);
    if (f && f.heading !== null && f.heading !== undefined && m.session) {
      return angleDiff(f.heading, bearingDeg(f, m.session.spot.pointFinal)) <= 45 ? 1 : 0;
    }
    return 0.5;
  }

  private returnInfo(now: number): ReturnInfo | null {
    const m = this.m;
    const cfg = this.cfg;
    if (!m.session || !(m.state === 'PARKED_USER_AWAY' || m.state === 'RETURN_PREDICTED' || m.state === 'USER_RETURNING')) return null;
    const f = this.lastValidFix(now, 120);
    if (!f) return null;
    const d = distanceM(m.session.spot.pointFinal, f);
    // velocità di avvicinamento: finestra breve, poi lunga se il GPS è rado
    let approach: number | null = null;
    for (const win of [cfg.RETURN_MIN_APPROACH_TIME_S, cfg.RETURN_LONG_WINDOW_S]) {
      const series = m.returnSeries.filter((x) => (now - x.t) / 1000 <= win);
      if (series.length >= 2) {
        const dt = (series[series.length - 1].t - series[0].t) / 1000;
        if (dt >= 20) {
          approach = (series[0].d - series[series.length - 1].d) / dt;
          break;
        }
      }
    }
    let etaS: number | null = null;
    if (m.state === 'USER_RETURNING') etaS = 0;
    else if (approach !== null && approach > 0.2) etaS = Math.round(d / Math.min(approach, 2.5));
    else if (m.state === 'RETURN_PREDICTED') etaS = Math.round(d / cfg.RETURN_WALK_SPEED_MS);
    return {
      distanceM: Math.round(d),
      approachSpeedMs: approach === null ? null : r1(approach),
      etaS,
      headingToCarDeg: Math.round(bearingDeg(f, m.session.spot.pointFinal)),
      sinceParkS: Math.round((now - (m.session.parkedT ?? m.session.startT)) / 1000),
      releaseEtaS: etaS === null ? null : etaS + cfg.RETURN_DEPART_DELAY_S,
    };
  }

  private fastNote(now: number): string {
    const m = this.m;
    return m.vehicleFastSince !== null && now - m.vehicleFastSince >= this.cfg.VEHICLE_FAST_CONFIRM_S * 1000
      ? ` (conferma rapida: activity IN_VEHICLE + velocità per ${secs(now - m.vehicleFastSince)} s)`
      : ` per ${m.vehicleOkSince !== null ? secs(now - m.vehicleOkSince) : 0} s`;
  }

  // ----- eventi -------------------------------------------------------------------

  private transition(
    to: EngineState,
    reason: string,
    now: number,
    extra: { parkingId?: string; distanceM?: number | null; checks?: string[]; eventType?: EventType } = {},
  ): void {
    const from = this.m.state;
    if (to === 'PARKED_USER_AWAY' && this.m.session) this.m.session.exitedOnFoot = true;
    this.m.state = to;
    this.m.stateSinceT = now;
    this.emit(extra.eventType ?? to, from, to, reason, now, extra);
  }

  private emit(
    type: EventType,
    from: EngineState,
    to: EngineState,
    reason: string,
    now: number,
    extra: { parkingId?: string; distanceM?: number | null; checks?: string[] } = {},
  ): void {
    const m = this.m;
    const fix = m.lastFixAny;
    const valid = fix ? fix.accuracy <= this.cfg.GPS_ACCURACY_LIMIT : false;
    const act = this.currentActivity(now) ?? m.lastActivityAny;
    const dist = extra.distanceM !== undefined ? extra.distanceM : this.distanceFromSpot(now);
    const refs = m.fixes.filter((f) => now - f.t <= 20_000).map((f) => f.t);
    m.lastReason = reason;
    const ev: DetectionEvent = {
      id: `${m.idPrefix}-E${++m.eventSeq}`,
      t: now,
      type,
      from,
      to,
      scores: { ...m.scores },
      reason,
      data: {
        speedKmh: m.lastFixAnyKmh === null ? null : r1(m.lastFixAnyKmh),
        distanceM: dist === null ? null : Math.round(dist),
        gpsAccuracyM: fix ? round1(fix.accuracy) : null,
        gpsValid: valid,
        gpsAgeS: fix ? r1((now - fix.t) / 1000) : null,
        latitude: fix ? fix.latitude : null,
        longitude: fix ? fix.longitude : null,
        activity: act ? (act.activity as ActivityType) : null,
        checks: extra.checks,
      },
      sampleRefs: refs,
      parkingId: extra.parkingId ?? m.session?.parkingId ?? null,
    };
    this.out.push(ev);
  }
}

interface Ctx {
  now: number;
  vScore: number;
  wScore: number;
  kmh: number | null;
  act: ActivitySample | null;
  vehicleConfirmed: boolean;
  walkingConfirmed: boolean;
  stationary: boolean;
}

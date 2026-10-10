// EngineHost: collega sensori reali → motore → archivio, notifiche, geofence.
// Funziona sia con l'app aperta sia nei task in background (anche dopo un
// riavvio "headless" dell'app da parte del sistema).

import { AppState, Platform } from 'react-native';
import { DetectionEngine } from '../../engine/engine.ts';
import { distanceM } from '../../engine/geo.ts';
import { DEFAULT_CONFIG, makeConfig, type DetectionConfig } from '../../engine/config.ts';
import { ReorderBuffer, inputTime, normalizeInputs } from '../../engine/replay.ts';
import { analyzeTestQuality, realDepartureTime, recurringSpotIds } from '../../engine/analysis.ts';
import type {
  ActivitySample,
  DetectionEvent,
  EngineInput,
  EngineSnapshot,
  EngineState,
  LocationSample,
  MotionFeatures,
  ParkingSession,
  QualityWarning,
} from '../../engine/types.ts';
import * as db from '../storage/db.ts';
import {
  getLocationMode,
  locationRunning,
  restartLocation,
  startGeofences,
  startLocation,
  stopGeofences,
  stopLocation,
  type LocationMode,
} from '../sensors/location.ts';
import { activityHistory, bufferedActivities, startActivity, stopActivity } from '../sensors/activity.ts';
import { startMotion, stopMotion } from '../sensors/motion.ts';
import { inMinutes, notifyEvent, notifyWarning, setupNotifications, updateReturnNotification } from '../services/notifications.ts';
import { reverseGeocode } from '../services/geocode.ts';
import { signalsForTile, tileKey } from '../services/osm.ts';
import { deviceInfo } from '../services/deviceInfo.ts';
import { powerState, readiness, statusMap } from '../services/permissions.ts';
import { applyPendingUpdate } from '../services/updates.ts';
import { STATE_TEXT } from '../ui/theme.ts';
import { CommunityBridge, type CommunityState } from '../community/bridge.ts';

export interface SensorRates {
  location: number;
  activity: number;
  motion: number;
  lastLocationT: number | null;
  lastActivityT: number | null;
  lastMotionT: number | null;
}

export interface HostState {
  ready: boolean;
  active: boolean;
  testId: string | null;
  startedAt: number | null;
  snapshot: EngineSnapshot | null;
  events: DetectionEvent[];
  session: ParkingSession | null;
  sessions: ParkingSession[];
  track: LocationSample[];
  rates: SensorRates;
  locationMode: LocationMode | null;
  config: DetectionConfig;
  error: string | null;
  lastStopped: { testId: string; warnings: QualityWarning[] } | null;
  community: CommunityState;
}

type Listener = (s: HostState) => void;

const CONFIG_KEY = 'config:overrides';
const MAX_UI_EVENTS = 300;
const MAX_TRACK = 3000;

class Host {
  private engine: DetectionEngine | null = null;
  private buffer = new ReorderBuffer(2000);
  private pendingInputs: { t: number; input: EngineInput }[] = [];
  private pendingEvents: DetectionEvent[] = [];
  private dirtySessions = new Set<string>();
  private listeners = new Set<Listener>();
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private geocodeTimer: ReturnType<typeof setInterval> | null = null;
  private initPromise: Promise<void> | null = null;
  private lastPersistT = 0;
  /** ultimo testo/ora della notifica di ritorno (per aggiornarla senza spam) */
  private returnNote: { key: string; t: number } | null = null;
  /** ultimo controllo di batteria / risparmio energetico durante il test */
  private lastPowerT = 0;
  private lowPowerWarned = false;
  /** zone OpenStreetMap già caricate in questo test, e tentativi falliti (per riprovare più tardi) */
  private osmTiles = new Set<string>();
  private osmFailedT = new Map<string, number>();
  private osmBusy = false;
  /** ultima posizione ricevuta (ora del telefono) e ultimo avviso di app sospesa */
  private lastLocRecvT = 0;
  private suspendWarnT = 0;
  private gpsDeadWarnT = 0;
  private community = new CommunityBridge(
    () => this.engine?.cfg ?? this.state.config,
    () => {
      this.state.community = { ...this.community.state };
      this.emitChange();
    },
  );
  private notifyQueued = false;
  private counts = { location: [] as number[], activity: [] as number[], motion: [] as number[] };
  private geocodeAttempts = new Map<string, number>();
  private geocodeBusy = false;

  state: HostState = {
    ready: false,
    active: false,
    testId: null,
    startedAt: null,
    snapshot: null,
    events: [],
    session: null,
    sessions: [],
    track: [],
    rates: { location: 0, activity: 0, motion: 0, lastLocationT: null, lastActivityT: null, lastMotionT: null },
    locationMode: null,
    config: DEFAULT_CONFIG,
    error: null,
    lastStopped: null,
    community: { configured: false, listening: false, nearby: [], lastSyncT: null, shared: null, error: null },
  };

  // ---- ciclo di vita -------------------------------------------------------------

  ensureInit(): Promise<void> {
    if (!this.initPromise) this.initPromise = this.init();
    return this.initPromise;
  }

  private async init(): Promise<void> {
    try {
      await setupNotifications();
      await this.community.init().catch(() => {});
      this.state.community = { ...this.community.state };
      const overrides = await db.kvGet(CONFIG_KEY);
      this.state.config = makeConfig(overrides ? JSON.parse(overrides) : {});
      const active = await db.getActiveTest();
      if (active) await this.resume(active);
      this.state.ready = true;
      this.emitChange();
    } catch (e) {
      this.state.error = String(e);
      this.state.ready = true;
      this.emitChange();
    }
  }

  /** Riprende un test attivo (app riaperta o rilanciata dal sistema in background). */
  private async resume(test: db.TestRow): Promise<void> {
    const saved = await db.kvGet(`engine:${test.id}`);
    if (saved) {
      try {
        this.engine = DetectionEngine.restore(saved, test.config);
      } catch {
        this.engine = null;
      }
    }
    if (!this.engine) {
      // ricostruzione dal registro degli input
      this.engine = new DetectionEngine(test.config, test.id);
      for (const i of normalizeInputs(await db.getInputs(test.id)).inputs) this.engine.process(i);
      this.engine.drainSnapshots();
    }
    this.state.active = true;
    this.state.testId = test.id;
    this.state.startedAt = test.startedAt;
    this.state.events = (await db.getEvents(test.id)).slice(-MAX_UI_EVENTS);
    this.state.track = (await db.getLocationInputs(test.id))
      .map((i) => (i.kind === 'location' ? i.sample : null))
      .filter((x): x is LocationSample => x !== null)
      .slice(-MAX_TRACK);
    this.refreshFromEngine();
    this.startTimers();
    if (AppState.currentState === 'active') this.startForegroundSensors();
    startActivity((a) => this.ingestActivity(a));
    await this.applySideEffectsForState(this.engine.state);
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    l(this.state);
    return () => this.listeners.delete(l);
  }

  private emitChange(): void {
    if (this.notifyQueued) return;
    this.notifyQueued = true;
    setTimeout(() => {
      this.notifyQueued = false;
      this.state = { ...this.state };
      for (const l of this.listeners) l(this.state);
    }, 50);
  }

  // ---- avvio / stop -----------------------------------------------------------------

  async startTest(scenarios: string[] = []): Promise<string> {
    await this.ensureInit();
    if (this.state.active && this.state.testId) return this.state.testId;
    const now = Date.now();
    const d = new Date(now);
    const p = (n: number) => String(n).padStart(2, '0');
    const testId = `T${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
    const info = deviceInfo();
    const checks = await readiness();
    const cfg = this.state.config;
    await db.insertTest({
      id: testId,
      startedAt: now,
      stoppedAt: null,
      platform: Platform.OS,
      meta: {
        appVersion: info.appVersion,
        buildNumber: info.buildNumber,
        updateId: info.updateId,
        runtimeVersion: info.runtimeVersion,
        platform: info.platform,
        deviceModel: info.deviceModel,
        osVersion: info.osVersion,
        timezone: info.timezone,
        scenarios,
        permissions: [{ t: now, status: statusMap(checks) }],
        sensorAvailability: Object.fromEntries(checks.map((c) => [c.key, c.level])),
      },
      config: cfg,
      quality: [],
      finalState: null,
    });
    this.engine = new DetectionEngine(cfg, testId);
    this.buffer = new ReorderBuffer(2000);
    this.state = {
      ...this.state,
      active: true,
      testId,
      startedAt: now,
      events: [],
      session: null,
      sessions: [],
      track: [],
      snapshot: null,
      error: null,
      lastStopped: null,
    };
    this.counts = { location: [], activity: [], motion: [] };
    this.osmTiles = new Set();
    this.osmFailedT = new Map();
    this.pendingCarry = null;
    this.lastLocRecvT = 0;
    this.startTimers();
    this.startForegroundSensors();
    startActivity((a) => this.ingestActivity(a));
    try {
      await startLocation('high', 'Rilevamento automatico attivo');
    } catch (e) {
      this.state.error = `Posizione non avviata: ${String(e)}`;
    }
    await this.carryOverParking(testId, now);
    this.emitChange();
    return testId;
  }

  /** Se il test precedente è finito con l'auto parcheggiata, il nuovo test riparte da lì. */
  private async carryOverParking(testId: string, now: number): Promise<void> {
    try {
      const prev = (await db.listTests()).find((t) => t.id !== testId && t.stoppedAt !== null);
      if (!prev) return;
      const open = (await db.getSessions(prev.id))
        .filter((s) => s.outcome === 'OPEN' && s.parkedT !== null)
        .sort((a, b) => (b.parkedT ?? 0) - (a.parkedT ?? 0))[0];
      if (!open || now - (open.parkedT ?? 0) > 48 * 3600_000) return;
      // si decide alla prima posizione buona: se sei lontano, l'auto si è mossa senza che il test lo vedesse
      this.pendingCarry = {
        until: now + 120_000,
        input: {
          kind: 'carryOver',
          t: now,
          fromTestId: prev.id,
          parkedT: open.parkedT as number,
          spot: open.spot,
          exitedOnFoot: open.exitedOnFoot,
          gpsLostAtPark: open.gpsLostAtPark,
        },
      };
    } catch {
      // nessun parcheggio da riprendere
    }
  }

  async stopTest(): Promise<string | null> {
    await this.ensureInit();
    const testId = this.state.testId;
    if (!testId || !this.engine) return null;
    // rilascia tutto ciò che è nel buffer
    for (const i of this.buffer.flush()) this.process(i);
    await this.flush(true);
    this.stopTimers();
    stopMotion();
    stopActivity();
    await stopLocation().catch(() => {});
    await stopGeofences().catch(() => {});

    const stoppedAt = Date.now();
    const inputs = await db.getInputs(testId);
    const events = await db.getEvents(testId);
    const sessions = this.engine.getSessions();
    // partenza reale ricavata a posteriori dalla traccia
    for (const s of sessions) {
      if (s.endT !== null && s.realDepartureT === null) s.realDepartureT = realDepartureTime(inputs, s, this.engine.cfg);
    }
    // parcheggi ricorrenti (casa, lavoro): su tutti i test
    const all = [...(await db.getSessions()).filter((s) => s.testId !== testId), ...sessions];
    const rec = recurringSpotIds(all, this.engine.cfg);
    for (const s of sessions) s.spot.recurringSpot = rec.has(s.parkingId);
    // un parcheggio ancora aperto resta OPEN (il test è finito, non l'auto)
    await db.upsertSessions(testId, sessions, stoppedAt);
    const finalState = this.engine.state;
    const warnings = analyzeTestQuality({ inputs, events, sessions, finalState, stoppedAt, cfg: this.engine.cfg });
    await db.updateTest(testId, { stoppedAt, quality: warnings, finalState });
    await db.kvSet(`engine:${testId}`, this.engine.serialize());

    this.engine = null;
    this.state = {
      ...this.state,
      active: false,
      testId: null,
      startedAt: null,
      locationMode: null,
      lastStopped: { testId, warnings },
    };
    this.emitChange();
    return testId;
  }

  /** Da chiamare quando l'utente chiude il riepilogo: applica eventuali aggiornamenti. */
  async afterSummary(): Promise<void> {
    if (!this.state.active) await applyPendingUpdate();
  }

  // ---- ingresso dati ------------------------------------------------------------------

  ingestLocations(samples: LocationSample[]): void {
    if (!this.state.active) return;
    const now = Date.now();
    for (const s of samples) {
      this.counts.location.push(now);
      this.state.rates.lastLocationT = s.t;
      this.state.track.push(s);
      if (this.state.track.length > MAX_TRACK) this.state.track.shift();
      this.push({ kind: 'location', sample: s });
    }
    if (now - this.lastPowerT > 300_000) {
      this.lastPowerT = now;
      void this.logPower(now);
    }
    // app sospesa dal telefono: in modalità continua le posizioni arrivano ogni secondo
    const driving = ['IN_VEHICLE', 'VEHICLE_MOVING', 'VEHICLE_STOPPED', 'POSSIBLE_PARKING', 'VEHICLE_DEPARTED'].includes(this.engine?.state ?? '');
    if (driving && this.lastLocRecvT > 0 && now - this.lastLocRecvT > 180_000 && now - this.suspendWarnT > 1800_000) {
      this.suspendWarnT = now;
      const min = Math.round((now - this.lastLocRecvT) / 60000);
      void notifyWarning(
        '⚠️ Il telefono ha sospeso PARCHEGGIO',
        `Nessun dato per ${min} min. Apri l'app › Test e completa le impostazioni consigliate (avvio automatico, blocco nelle app recenti).`,
        'warning-suspended',
      );
    }
    this.lastLocRecvT = now;
    this.resolveCarry(samples, now);
    const last = samples[samples.length - 1];
    if (last) void this.loadSignals(last.latitude, last.longitude, now);
    this.pump(now);
  }

  ingestActivity(a: ActivitySample): void {
    if (!this.state.active) return;
    // in auto ma nessuna posizione da minuti: il telefono ha fermato il GPS
    const nowA = Date.now();
    if (a.activity === 'IN_VEHICLE' && a.confidence >= 70 && this.lastLocRecvT > 0 && nowA - this.lastLocRecvT > 120_000 && nowA - this.gpsDeadWarnT > 1800_000) {
      this.gpsDeadWarnT = nowA;
      void notifyWarning(
        '⚠️ Il telefono ha fermato il GPS di PARCHEGGIO',
        'Sei in auto ma non arrivano posizioni. Apri l\'app un attimo: il GPS riparte da solo.',
        'warning-gps',
      );
    }
    this.counts.activity.push(Date.now());
    this.state.rates.lastActivityT = a.t;
    this.push({ kind: 'activity', sample: a });
    this.pump(Date.now());
  }

  ingestMotion(f: MotionFeatures): void {
    if (!this.state.active) return;
    this.counts.motion.push(Date.now());
    this.state.rates.lastMotionT = f.t;
    this.push({ kind: 'motion', sample: f });
  }

  /** Scarica (una volta per zona) i semafori OpenStreetMap e li passa al motore come input registrato. */
  private async loadSignals(lat: number, lon: number, now: number): Promise<void> {
    const key = tileKey(lat, lon);
    if (this.osmBusy || this.osmTiles.has(key)) return;
    if (now - (this.osmFailedT.get(key) ?? 0) < 600_000) return;
    this.osmBusy = true;
    try {
      const list = await signalsForTile(key, now);
      if (list === null) {
        this.osmFailedT.set(key, now);
        return;
      }
      this.osmTiles.add(key);
      if (!this.state.active || (list.signals.length === 0 && list.fuel.length === 0)) return;
      const t = Date.now();
      this.push({ kind: 'mapFeatures', t, signals: list.signals, fuel: list.fuel });
      this.pump(t);
    } finally {
      this.osmBusy = false;
    }
  }

  /** Registra batteria e risparmio energetico nel test (ogni 5 min): spiega i buchi nei dati. */
  private async logPower(now: number): Promise<void> {
    const testId = this.state.testId;
    if (!testId) return;
    const p = await powerState();
    const label = `${p.lowPower ? 'ATTIVO' : 'spento'}${p.level !== null ? ` · batteria ${p.level}%` : ''}${p.charging ? ' (in carica)' : ''}`;
    try {
      const t = await db.getTest(testId);
      if (t) {
        const meta = { ...t.meta, permissions: [...(t.meta.permissions ?? []), { t: now, status: { power: label } }] };
        await db.updateTest(testId, { meta });
      }
    } catch {
      // non essenziale
    }
    if (p.lowPower && !this.lowPowerWarned) {
      this.lowPowerWarned = true;
      await notifyWarning(
        '⚠️ Risparmio energetico attivo',
        'Il telefono può bloccare GPS e sensori: il test rischia di fermarsi. Disattivalo o metti in carica.',
        'warning-power',
      );
    }
    if (p.lowPower === false) this.lowPowerWarned = false;
  }

  async onGeofence(region: string, event: 'enter' | 'exit'): Promise<void> {
    if (!this.state.active) return;
    const now = Date.now();
    this.push({ kind: 'geofence', t: now, region, event });
    // risveglio: posizione ad alta frequenza e storico delle attività (iOS)
    await this.setLocationMode('high');
    await this.catchUpActivities();
    this.pump(now);
    await this.flush(true);
  }

  /** Recupera le attività registrate dal sistema mentre l'app era sospesa. */
  async catchUpActivities(): Promise<void> {
    if (!this.state.active) return;
    const now = Date.now();
    const from = this.state.rates.lastActivityT ?? this.state.startedAt ?? now - 3600_000;
    const list = Platform.OS === 'ios' ? await activityHistory(from + 1, now) : await bufferedActivities();
    for (const a of list) this.push({ kind: 'activity', sample: a });
    if (list.length > 0) this.state.rates.lastActivityT = list[list.length - 1].t;
  }

  private push(input: EngineInput): void {
    this.pendingInputs.push({ t: inputTime(input), input });
    this.buffer.push(input);
  }

  /** Rilascia al motore gli input pronti (ordinati) */
  private pump(now: number): void {
    if (this.rebuilding) return; // gli input restano nel buffer fino alla fine della ricostruzione
    const ready = this.buffer.release(now);
    if (this.engine && ready.length > 0 && now - this.lastRebuildT > 60_000) {
      // il telefono ha consegnato in ritardo un blocco di dati (app congelata in background):
      // elaborarli "dopo" darebbe risultati sbagliati, quindi si ricostruisce tutto in ordine
      const limit = this.engine.lastInputT - this.engine.cfg.LATE_INPUT_REBUILD_S * 1000;
      const late = ready.filter((i) => (i.kind === 'location' || i.kind === 'activity') && inputTime(i) < limit);
      if (late.length >= 5) {
        void this.rebuild(late.length);
        return;
      }
    }
    for (const i of ready) this.process(i);
    this.refreshFromEngine();
    if (now - this.lastPersistT > 5000) void this.flush(false);
  }

  private rebuilding = false;
  private lastRebuildT = 0;
  private pendingCarry: { until: number; input: Extract<EngineInput, { kind: 'carryOver' }> } | null = null;

  private resolveCarry(samples: LocationSample[], now: number): void {
    const pc = this.pendingCarry;
    if (!pc || !this.engine) return;
    if (now > pc.until) {
      this.pendingCarry = null;
      return;
    }
    const good = samples.find((x) => x.accuracy <= 50);
    if (!good) return;
    this.pendingCarry = null;
    if (distanceM(pc.input.spot.pointFinal, good) <= this.engine.cfg.CARRYOVER_MAX_DIST_M) {
      this.push({ ...pc.input, t: Math.max(pc.input.t, good.t) });
    }
  }

  /** Rielabora l'intero test dal registro degli input, in ordine di tempo. */
  private async rebuild(lateCount: number): Promise<void> {
    const testId = this.state.testId;
    if (!testId || !this.engine || this.rebuilding) return;
    this.rebuilding = true;
    this.lastRebuildT = Date.now();
    try {
      await this.flush(true); // tutti gli input ricevuti finiscono nel registro
      const all = normalizeInputs(await db.getInputs(testId)).inputs;
      const before = this.engine.state;
      const fresh = new DetectionEngine(this.engine.cfg, testId);
      const events: DetectionEvent[] = [];
      for (const i of all) events.push(...fresh.process(i));
      fresh.drainSnapshots();
      const done = new Set(all.map((i) => JSON.stringify(i)));
      this.buffer.dropIf((i) => done.has(JSON.stringify(i)));
      const old = await db.getEvents(testId);
      const seen = new Set(old.map((e) => `${e.type}|${e.t}`));
      const added = events.filter((e) => !seen.has(`${e.type}|${e.t}`));
      this.engine = fresh;
      this.pendingEvents = [];
      await db.replaceEvents(testId, events);
      await db.deleteSessionsExcept(testId, fresh.getSessions().map((x) => x.parkingId));
      for (const x of fresh.getSessions()) this.dirtySessions.add(x.parkingId);
      this.state.events = events.slice(-MAX_UI_EVENTS);
      this.state.error = null;
      this.refreshFromEngine();
      if (added.length > 0) await this.handleEvents(added, before, Date.now() - 10 * 60_000);
      else await this.applySideEffectsForState(fresh.state);
      await this.flush(true);
      void this.retryGeocoding();
      console.log(`[rebuild] ${lateCount} input in ritardo, ${added.length} eventi nuovi`);
    } catch (e) {
      this.state.error = `Ricostruzione: ${String(e)}`;
    } finally {
      this.rebuilding = false;
    }
    this.pump(Date.now());
  }

  private tick(): void {
    if (!this.state.active) return;
    const now = Date.now();
    this.push({ kind: 'tick', t: now });
    this.pump(now);
    this.updateRates(now);
    const track = this.state.track;
    this.community.tick(this.state.snapshot, track.length ? track[track.length - 1] : null, now);
  }

  private process(input: EngineInput): void {
    if (!this.engine) return;
    const before = this.engine.state;
    const events = this.engine.process(input);
    if (events.length === 0) return;
    this.pendingEvents.push(...events);
    this.state.events = [...this.state.events, ...events].slice(-MAX_UI_EVENTS);
    for (const e of events) if (e.parkingId) this.dirtySessions.add(e.parkingId);
    void this.handleEvents(events, before);
  }

  private refreshFromEngine(): void {
    if (!this.engine) return;
    this.state.snapshot = this.engine.snapshot();
    this.state.session = this.engine.getOpenSession();
    this.state.sessions = this.engine.getSessions();
    this.state.locationMode = getLocationMode();
    this.maybeUpdateReturnNotification();
    this.emitChange();
  }

  /** Mentre torni all'auto, la notifica mostra minuti e distanza aggiornati. */
  private maybeUpdateReturnNotification(): void {
    const snap = this.state.snapshot;
    const testId = this.state.testId;
    if (!testId || !snap || snap.state !== 'RETURN_PREDICTED' || !snap.returnInfo) {
      if (snap && snap.state !== 'RETURN_PREDICTED') this.returnNote = null;
      return;
    }
    const ri = snap.returnInfo;
    const key = `${ri.releaseEtaS === null ? '-' : inMinutes(ri.releaseEtaS)}|${Math.round(ri.distanceM / 25)}`;
    const now = Date.now();
    if (!this.returnNote) {
      // la prima notifica la invia l'evento RETURN_PREDICTED
      this.returnNote = { key, t: now };
      return;
    }
    if (key === this.returnNote.key || now - this.returnNote.t < 15_000) return;
    this.returnNote = { key, t: now };
    void updateReturnNotification(testId, this.state.session, ri);
    void this.community.onReturnUpdate(this.state.session, ri, now);
  }

  // ---- effetti degli eventi --------------------------------------------------------------

  private async handleEvents(events: DetectionEvent[], _before: EngineState, minNotifyT = 0): Promise<void> {
    const testId = this.state.testId;
    if (!testId || !this.engine) return;
    for (const e of events) {
      const session =
        (e.parkingId && this.engine.getSessions().find((s) => s.parkingId === e.parkingId)) || this.engine.getOpenSession();
      if (e.type === 'PARKED' && session) {
        await this.geocode(session);
        const p = session.spot.pointFinal;
        await startGeofences(p.latitude, p.longitude, this.engine.cfg.RETURN_GEOFENCE_RADII).catch(() => {});
      }
      if ((e.type === 'PARKING_RELEASED' || e.type === 'PARKING_RELEASED_INFERRED' || (e.type === 'LOW_CONFIDENCE' && e.from === 'VEHICLE_DEPARTED')) && session) {
        await stopGeofences().catch(() => {});
        await this.geocode(session);
      }
      const ri = this.engine.snapshot().returnInfo;
      // dopo una ricostruzione non si notificano eventi vecchi (sarebbero solo rumore)
      if (e.t >= minNotifyT) {
        await notifyEvent(e, session ?? null, testId, ri);
        void this.community.onEvent(e, session ?? null, ri, Date.now());
      }
    }
    const last = events[events.length - 1];
    await this.applySideEffectsForState(last.to);
    await this.flush(true);
  }

  private async applySideEffectsForState(s: EngineState): Promise<void> {
    let mode: LocationMode = 'high';
    if (s === 'PARKED' || s === 'USER_RETURNING') mode = 'parked';
    if (s === 'PARKED_USER_AWAY') mode = 'away';
    await this.setLocationMode(mode);
  }

  private async setLocationMode(mode: LocationMode): Promise<void> {
    if (!this.state.active) return;
    // Android 12+: un foreground service non si può (ri)avviare dal background.
    // In background si resta nella modalità corrente (più consumo, ma sicuro).
    // Anche dopo un riavvio dell'app in background (getLocationMode() null) il servizio può essere
    // ancora attivo: toccarlo da qui lo fermerebbe senza poterlo riavviare (test 09/10 notte).
    if (Platform.OS === 'android' && AppState.currentState !== 'active') {
      if (getLocationMode() !== null || (await locationRunning())) return;
    }
    const st = this.engine?.state ?? 'UNKNOWN';
    try {
      await startLocation(mode, `${STATE_TEXT[st].icon} ${STATE_TEXT[st].label}`);
      this.state.locationMode = mode;
    } catch (e) {
      this.state.error = `Posizione: ${String(e)}`;
    }
  }

  private async geocode(session: ParkingSession): Promise<void> {
    if (!this.engine) return;
    const r = await reverseGeocode(session.spot);
    this.engine.setSpotAddress(session.parkingId, r);
    this.dirtySessions.add(session.parkingId);
    this.refreshFromEngine();
  }

  /** Riprova gli indirizzi mancanti (rete tornata, ecc.), anche per i test passati. */
  async retryGeocoding(): Promise<void> {
    if (this.geocodeBusy) return;
    this.geocodeBusy = true;
    try {
      const max = this.state.config.GEOCODE_MAX_RETRIES;
      const all = await db.getSessions();
      for (const s of all) {
        if (s.spot.geocodeStatus === 'OK' || s.spot.geocodeStatus === 'NOT_AVAILABLE') continue;
        const n = this.geocodeAttempts.get(s.parkingId) ?? 0;
        if (n >= max) continue;
        this.geocodeAttempts.set(s.parkingId, n + 1);
        const r = await reverseGeocode(s.spot);
        if (this.engine && this.engine.getSessions().some((x) => x.parkingId === s.parkingId)) {
          this.engine.setSpotAddress(s.parkingId, r);
          this.dirtySessions.add(s.parkingId);
        } else {
          const { testId, ...plain } = s;
          Object.assign(plain.spot, r);
          await db.upsertSessions(testId, [plain], Date.now());
        }
      }
    } finally {
      this.geocodeBusy = false;
    }
  }

  // ---- persistenza -----------------------------------------------------------------------

  private flushing: Promise<void> | null = null;
  private flushAgain = false;

  /** Salva su disco. Mai due salvataggi insieme: se uno è in corso, si accoda. */
  async flush(force: boolean): Promise<void> {
    if (this.flushing) {
      this.flushAgain = true;
      if (force) await this.flushing;
      return;
    }
    this.flushing = this.doFlush(force);
    try {
      await this.flushing;
    } finally {
      this.flushing = null;
    }
    if (this.flushAgain) {
      this.flushAgain = false;
      await this.flush(force);
    }
  }

  private async doFlush(force: boolean): Promise<void> {
    const testId = this.state.testId;
    if (!testId || !this.engine) return;
    const inputs = this.pendingInputs;
    const events = this.pendingEvents;
    this.pendingInputs = [];
    this.pendingEvents = [];
    const snaps = this.engine.drainSnapshots();
    try {
      await db.appendInputs(testId, inputs);
      await db.appendEvents(testId, events);
      await db.appendSnapshots(testId, snaps);
      if (this.dirtySessions.size > 0 || force) {
        const ids = this.dirtySessions;
        this.dirtySessions = new Set();
        const sessions = this.engine.getSessions().filter((s) => force || ids.has(s.parkingId));
        await db.upsertSessions(testId, sessions, Date.now());
      }
      const now = Date.now();
      if (force || now - this.lastPersistT > 10_000) {
        await db.kvSet(`engine:${testId}`, this.engine.serialize());
      }
      this.lastPersistT = now;
      if (this.state.error?.startsWith('Salvataggio')) {
        this.state.error = null;
        this.emitChange();
      }
    } catch (e) {
      // non perdere i dati: rimetti in coda
      this.pendingInputs = [...inputs, ...this.pendingInputs];
      this.pendingEvents = [...events, ...this.pendingEvents];
      this.state.error = `Salvataggio: ${String(e)}`;
    }
  }

  // ---- timer e sensori in primo piano ------------------------------------------------------

  private startTimers(): void {
    this.stopTimers();
    this.tickTimer = setInterval(() => this.tick(), 1000);
    this.flushTimer = setInterval(() => void this.flush(false), 5000);
    this.geocodeTimer = setInterval(() => void this.retryGeocoding(), 60_000);
  }

  private stopTimers(): void {
    if (this.tickTimer) clearInterval(this.tickTimer);
    if (this.flushTimer) clearInterval(this.flushTimer);
    if (this.geocodeTimer) clearInterval(this.geocodeTimer);
    this.tickTimer = this.flushTimer = this.geocodeTimer = null;
  }

  startForegroundSensors(): void {
    if (!this.state.active) return;
    startMotion((f) => this.ingestMotion(f));
  }

  /** App in primo piano: recupera ciò che è successo in background. */
  async onForeground(): Promise<void> {
    await this.ensureInit();
    if (!this.state.active) return;
    this.startForegroundSensors();
    await this.catchUpActivities();
    this.pump(Date.now());
    if (this.engine) await this.applySideEffectsForState(this.engine.state);
    // GPS fermato dal telefono: in primo piano si può riavviare
    setTimeout(() => {
      if (!this.state.active || Date.now() - this.lastLocRecvT < 30_000) return;
      const st = this.engine?.state ?? 'UNKNOWN';
      void restartLocation(getLocationMode() ?? 'high', `${STATE_TEXT[st].icon} ${STATE_TEXT[st].label}`).catch((e) => {
        this.state.error = `Posizione: ${String(e)}`;
      });
    }, 15_000);
  }

  async onBackground(): Promise<void> {
    if (!this.state.active) return;
    await this.flush(true);
  }

  private updateRates(now: number): void {
    const per = (arr: number[]) => {
      while (arr.length && now - arr[0] > 60_000) arr.shift();
      return arr.length; // campioni nell'ultimo minuto
    };
    this.state.rates = {
      ...this.state.rates,
      location: per(this.counts.location),
      activity: per(this.counts.activity),
      motion: per(this.counts.motion),
    };
  }

  // ---- configurazione (schermata Debug) ------------------------------------------------------

  async setConfigOverrides(overrides: Partial<DetectionConfig>): Promise<void> {
    await db.kvSet(CONFIG_KEY, JSON.stringify(overrides));
    this.state.config = makeConfig(overrides);
    this.emitChange();
  }

  async getConfigOverrides(): Promise<Partial<DetectionConfig>> {
    const raw = await db.kvGet(CONFIG_KEY);
    return raw ? JSON.parse(raw) : {};
  }
}

export const host = new Host();

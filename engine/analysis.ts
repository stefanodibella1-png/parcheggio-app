// Analisi a posteriori: qualità del test, partenza reale, metriche.
// Usa i dati registrati e le etichette di revisione. Non influenza il motore.

import type { DetectionConfig } from './config.ts';
import { DEFAULT_CONFIG } from './config.ts';
import { distanceM } from './geo.ts';
import { inputTime, normalizeInputs } from './replay.ts';
import type {
  DetectionEvent,
  EngineInput,
  EngineState,
  LocationSample,
  ParkingSession,
  QualityWarning,
  ReviewLabel,
} from './types.ts';

function locations(inputs: EngineInput[]): LocationSample[] {
  const out: LocationSample[] = [];
  for (const i of inputs) if (i.kind === 'location') out.push(i.sample);
  return out.sort((a, b) => a.t - b.t);
}

/**
 * Istante reale di partenza ricavato dalla traccia completa:
 * l'ultimo fix vicino al punto (≤ 15 m) prima che la distanza superi
 * stabilmente 60 m senza tornare indietro.
 */
export function realDepartureTime(
  inputs: EngineInput[],
  session: ParkingSession,
  cfg: DetectionConfig = DEFAULT_CONFIG,
): number | null {
  const p = session.spot.pointFinal;
  const fixes = locations(inputs).filter(
    (f) => f.accuracy <= cfg.GPS_ACCURACY_LIMIT && f.t >= session.startT,
  );
  let lastNear: number | null = null;
  for (let i = 0; i < fixes.length; i++) {
    const d = distanceM(p, fixes[i]);
    if (d <= 15) lastNear = fixes[i].t;
    if (d >= cfg.MIN_DEPARTURE_DISTANCE && lastNear !== null) {
      // conferma: nei 30 s successivi non si torna entro 30 m
      const back = fixes.slice(i, i + 30).some((f) => distanceM(p, f) < 30);
      if (!back) return lastNear;
    }
  }
  return null;
}

export interface TestQualityInput {
  inputs: EngineInput[];
  events: DetectionEvent[];
  sessions: ParkingSession[];
  finalState: EngineState;
  stoppedAt: number | null;
  cfg?: DetectionConfig;
}

export function analyzeTestQuality(q: TestQualityInput): QualityWarning[] {
  const cfg = q.cfg ?? DEFAULT_CONFIG;
  const w: QualityWarning[] = [];
  const { inputs, stats } = normalizeInputs(q.inputs);
  const locs = locations(inputs);
  if (inputs.length === 0) {
    return [{ code: 'EMPTY', severity: 'warning', message: 'Nessun dato registrato.' }];
  }
  const t0 = inputTime(inputs[0]);
  const t1 = q.stoppedAt ?? inputTime(inputs[inputs.length - 1]);

  // sosta finale troppo breve
  if (q.finalState === 'VEHICLE_STOPPED' || q.finalState === 'POSSIBLE_PARKING') {
    const lastStop = [...q.events].reverse().find((e) => e.to === 'VEHICLE_STOPPED');
    if (lastStop) {
      const s = Math.round((t1 - lastStop.t) / 1000) + cfg.STOP_CONFIRM_S;
      w.push({
        code: 'SHORT_FINAL_STOP',
        severity: 'warning',
        message: `Test fermato ${s} s dopo l'ultima sosta: per verificare un parcheggio servono almeno ${Math.ceil(cfg.MIN_PARKING_DURATION_S / 60) + 1} minuti di sosta.`,
      });
    }
  }
  // GPS impreciso
  if (locs.length > 0) {
    const bad = locs.filter((l) => l.accuracy > cfg.GPS_ACCURACY_LIMIT).length;
    const pct = Math.round((bad / locs.length) * 100);
    if (pct >= 10) {
      w.push({
        code: 'GPS_POOR',
        severity: pct >= 30 ? 'warning' : 'info',
        message: `GPS impreciso (> ${cfg.GPS_ACCURACY_LIMIT} m) per il ${pct}% dei fix: quei dati sono stati scartati.`,
      });
    }
  } else {
    w.push({ code: 'NO_GPS', severity: 'warning', message: 'Nessuna posizione registrata: controlla il permesso posizione.' });
  }
  // buchi nei dati (sistema che sospende l'app)
  let maxGap = 0;
  let gapAt = 0;
  for (let i = 1; i < locs.length; i++) {
    const g = locs[i].t - locs[i - 1].t;
    if (g > maxGap) {
      maxGap = g;
      gapAt = locs[i - 1].t;
    }
  }
  if (maxGap > 120_000) {
    w.push({
      code: 'DATA_GAP',
      severity: 'warning',
      message: `Nessuna posizione per ${Math.round(maxGap / 60000)} min (dal minuto ${Math.round((gapAt - t0) / 60000)}): probabile sospensione dell'app in background.`,
    });
  }
  // riconoscimento attività assente (risparmio energetico, servizi Google sospesi)
  if (t1 - t0 >= 10 * 60_000 && !inputs.some((i) => i.kind === 'activity')) {
    w.push({
      code: 'NO_ACTIVITY',
      severity: 'warning',
      message:
        "Nessun dato dal riconoscimento attività (auto/a piedi) per tutto il test: probabile risparmio energetico attivo o servizi Google sospesi. Senza questo dato auto e camminata si distinguono solo dal GPS.",
    });
  }
  // activity duplicate / fuori ordine
  if (stats.outOfOrder > 0 || stats.duplicates > 0) {
    w.push({
      code: 'INPUT_ORDER',
      severity: 'info',
      message: `${stats.outOfOrder} campioni arrivati fuori ordine e ${stats.duplicates} duplicati: riordinati prima dell'analisi.`,
    });
  }
  // test troppo corto
  if (t1 - t0 < 5 * 60_000) {
    w.push({ code: 'SHORT_TEST', severity: 'info', message: `Test di ${Math.round((t1 - t0) / 60000)} min: per una prova completa servono almeno 10 minuti.` });
  }
  // indirizzi mancanti
  const noAddr = q.sessions.filter((s) => s.spot.geocodeStatus !== 'OK').length;
  if (noAddr > 0) {
    w.push({ code: 'NO_ADDRESS', severity: 'info', message: `${noAddr} ${noAddr === 1 ? "parcheggio" : "parcheggi"} senza indirizzo (rete assente o geocoder non disponibile): verrà riprovato.` });
  }
  if (q.sessions.length === 0 && !q.events.some((e) => e.type === 'PARKED')) {
    w.push({ code: 'NO_PARKING', severity: 'info', message: 'Nessun parcheggio rilevato in questo test.' });
  }
  return w;
}

// ---------------------------------------------------------------------------
// Metriche (sezione 12, scheda Risultati)

export interface TestRecord {
  testId: string;
  platform: string;
  inputs?: EngineInput[];
  events: DetectionEvent[];
  sessions: ParkingSession[];
  labels: ReviewLabel[];
}

export interface Metrics {
  tests: number;
  parkingsDetected: number;
  departuresVehicle: number;
  departuresWalking: number;
  releasesGenerated: number;
  releasesInferred: number;
  releasesCorrect: number;
  falsePositives: number;
  falseNegatives: number;
  realDepartures: number;
  detectionRate: number | null;
  falsePositiveRate: number | null;
  avgReleaseConfidence: number | null;
  avgGpsAccuracy: number | null;
  avgPointAccuracy: number | null;
  addressResolvedPct: number | null;
  avgDetectionDelayS: number | null;
  avgReturnLeadS: number | null;
  returnPredictions: number;
  returnPredictionsFollowed: number;
  reviewed: number;
  toReview: number;
  /** ricerca del parcheggio (sperimentale) */
  searchesDetected: number;
  avgSearchTimeS: number | null;
}

function avg(xs: number[]): number | null {
  return xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null;
}

export function isRelease(e: DetectionEvent): boolean {
  return e.type === 'PARKING_RELEASED' || e.type === 'PARKING_RELEASED_INFERRED';
}

export function computeMetrics(tests: TestRecord[], cfg: DetectionConfig = DEFAULT_CONFIG): Metrics {
  let parkings = 0;
  let depV = 0;
  let depW = 0;
  let rel = 0;
  let relInf = 0;
  let correct = 0;
  let fp = 0;
  let fn = 0;
  let reviewed = 0;
  let toReview = 0;
  let predictions = 0;
  let predictionsFollowed = 0;
  const confs: number[] = [];
  const gpsAcc: number[] = [];
  const pointAcc: number[] = [];
  const delays: number[] = [];
  const leads: number[] = [];
  let addrOk = 0;
  let sessionsN = 0;
  let searches = 0;
  const searchTimes: number[] = [];

  for (const t of tests) {
    parkings += t.events.filter((e) => e.type === 'PARKED').length + t.sessions.filter((s) => s.inferred).length;
    depV += t.events.filter((e) => e.type === 'VEHICLE_DEPARTED').length;
    depW += t.events.filter((e) => e.from === 'DEPARTURE_CANDIDATE' && (e.to === 'PARKED' || e.to === 'PARKED_USER_AWAY')).length;
    const releases = t.events.filter(isRelease);
    rel += releases.length;
    relInf += releases.filter((e) => e.type === 'PARKING_RELEASED_INFERRED').length;
    for (const e of releases) {
      confs.push(e.scores.release);
      const label = t.labels.find((l) => l.kind === 'RELEASE' && l.targetId === e.id);
      if (!label) toReview++;
      else {
        reviewed++;
        if (label.verdict === 'CORRECT') correct++;
        else if (label.verdict === 'FALSE_POSITIVE') fp++;
      }
      const s = t.sessions.find((x) => x.parkingId === e.parkingId);
      if (s && t.inputs) {
        const real = s.realDepartureT ?? realDepartureTime(t.inputs, s, cfg);
        if (real !== null) delays.push((e.t - real) / 1000);
      }
    }
    fn += t.labels.filter((l) => l.verdict === 'MISSED' && l.kind === 'RELEASE').length;
    searches += t.events.filter((e) => e.type === 'PARKING_SEARCH').length;
    for (const s of t.sessions) {
      if (s.searchDurationS !== null && s.searchDurationS !== undefined) searchTimes.push(s.searchDurationS);
      sessionsN++;
      pointAcc.push(s.spot.pointFinal.accuracyM);
      if (s.spot.geocodeStatus === 'OK') addrOk++;
    }
    for (const e of t.events) if (e.data.gpsAccuracyM !== null) gpsAcc.push(e.data.gpsAccuracyM);
    // previsione di ritorno
    const preds = t.events.filter((e) => e.type === 'RETURN_PREDICTED');
    predictions += preds.length;
    for (const p of preds) {
      const next = t.events.find((e) => e.t > p.t && isRelease(e) && e.parkingId === p.parkingId);
      const cancelled = t.events.find((e) => e.t > p.t && e.from === 'RETURN_PREDICTED' && e.to === 'PARKED_USER_AWAY');
      if (next && (!cancelled || cancelled.t > next.t)) {
        predictionsFollowed++;
        leads.push((next.t - p.t) / 1000);
      }
    }
  }
  const real = correct + fn;
  return {
    tests: tests.length,
    parkingsDetected: parkings,
    departuresVehicle: depV,
    departuresWalking: depW,
    releasesGenerated: rel,
    releasesInferred: relInf,
    releasesCorrect: correct,
    falsePositives: fp,
    falseNegatives: fn,
    realDepartures: real,
    detectionRate: real > 0 ? Math.round((correct / real) * 1000) / 10 : null,
    falsePositiveRate: correct + fp > 0 ? Math.round((fp / (correct + fp)) * 1000) / 10 : null,
    avgReleaseConfidence: avg(confs),
    avgGpsAccuracy: avg(gpsAcc),
    avgPointAccuracy: avg(pointAcc),
    addressResolvedPct: sessionsN ? Math.round((addrOk / sessionsN) * 100) : null,
    avgDetectionDelayS: avg(delays),
    avgReturnLeadS: avg(leads),
    returnPredictions: predictions,
    returnPredictionsFollowed: predictionsFollowed,
    reviewed,
    toReview,
    searchesDetected: searches,
    avgSearchTimeS: avg(searchTimes),
  };
}

/** Parcheggi ricorrenti: stesso punto entro il raggio in almeno N sessioni. */
export function recurringSpotIds(sessions: ParkingSession[], cfg: DetectionConfig = DEFAULT_CONFIG): Set<string> {
  const ids = new Set<string>();
  for (const s of sessions) {
    const near = sessions.filter((o) => distanceM(o.spot.pointFinal, s.spot.pointFinal) <= cfg.RECURRING_SPOT_RADIUS);
    if (near.length >= cfg.RECURRING_SPOT_MIN_SESSIONS) ids.add(s.parkingId);
  }
  return ids;
}

// Esportazione completa e rigiocabile (sezione 14).
import { inputTime } from '../../engine/replay.ts';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { replay, normalizeInputs } from '../../engine/replay.ts';
import { analyzeTestQuality } from '../../engine/analysis.ts';
import { distanceM } from '../../engine/geo.ts';
import * as db from '../storage/db.ts';
import { deviceInfo } from './deviceInfo.ts';
import { ActivityRecognition } from '../../modules/activity-recognition/index.ts';
import { ALERTS_LOG_KEY, type AlertLogEntry } from '../community/bridge.ts';

function hhmmss(t: number): string {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/**
 * Avvisi ricevuti dal telefono che cerca (ruolo CERCA): ora, tipo, distanza e anticipo.
 * Anticipo di un SOON = secondi tra la sua ricezione e l'ora del FREED dello stesso posto
 * (quando il telefono che libera ha rilevato la partenza). Ritardo di un FREED = secondi
 * tra quell'ora e la ricezione.
 */
async function receivedAlerts(fromT: number, toT: number) {
  let log: AlertLogEntry[] = [];
  try {
    const raw = await db.kvGet(ALERTS_LOG_KEY);
    log = raw ? (JSON.parse(raw) as AlertLogEntry[]) : [];
  } catch {
    log = [];
  }
  const all = log.filter((e) => e.type === 'alert') as Extract<AlertLogEntry, { type: 'alert' }>[];
  const freed = new Map(all.filter((e) => e.kind === 'FREED').map((e) => [e.id, e]));
  const inTest = (t: number) => t >= fromT && t <= toT;
  const alertsReceived = all.filter((e) => inTest(e.t)).map((e) => {
    const f = freed.get(e.id);
    return {
      t: e.t,
      ora: hhmmss(e.t),
      type: e.kind,
      distanceM: e.distanceM,
      spotId: e.id,
      alerted: e.alerted,
      leadS: e.kind === 'SOON' && f ? Math.round((f.freeAt - e.t) / 1000) : null,
      delayS: e.kind === 'FREED' ? Math.round((e.t - e.freeAt) / 1000) : null,
    };
  });
  const listenLog = log
    .filter((e) => (e.type === 'listen' || e.type === 'gap') && inTest(e.t))
    .map((e) => ({ ...e, ora: hhmmss(e.t) }));
  // telefono che libera: pubblicati, ritirati e NON pubblicati con il motivo
  const alertsSent = log
    .filter((e) => e.type === 'sent' && inTest(e.t))
    .map((e) => {
      const x = e as Extract<AlertLogEntry, { type: 'sent' }>;
      return { t: x.t, ora: hhmmss(x.t), action: x.action, published: x.ok, reason: x.reason, event: x.event, spotId: x.id, freeAt: x.freeAt ?? null };
    });
  return { alertsReceived, listenLog, alertsSent };
}

export const SCHEMA_VERSION = 2;

function stamp(t: number): string {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}`;
}

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csv(rows: unknown[][]): string {
  return rows.map((r) => r.map(csvCell).join(';')).join('\n');
}

export async function buildExport(testId: string) {
  const test = await db.getTest(testId);
  if (!test) throw new Error('Test non trovato');
  const raw = await db.getInputs(testId);
  const { inputs } = normalizeInputs(raw);
  const events = await db.getEvents(testId);
  const sessions = await db.getSessions(testId);
  const snapshots = await db.getSnapshots(testId);
  const labels = await db.getLabels(testId);
  const quality =
    test.quality.length > 0
      ? test.quality
      : analyzeTestQuality({ inputs, events, sessions, finalState: (test.finalState as never) ?? 'UNKNOWN', stoppedAt: test.stoppedAt, cfg: test.config });
  const exportedAt = Date.now();
  // build installata adesso (il test può essere partito con una build più vecchia)
  const installedBuild = deviceInfo().buildNumber ?? test.meta.buildNumber;
  const serviceLog = (await ActivityRecognition.getServiceLog().catch(() => [])).filter(
    (x) => x.t >= test.startedAt && x.t <= exportedAt,
  );
  const { alertsReceived, listenLog, alertsSent } = await receivedAlerts(test.startedAt, exportedAt);
  // build 23+: GPS del servizio, riconoscimento attività e veglia di JS al momento dell'export
  const nativeStatus = ActivityRecognition.nativeStatus();
  const json = {
    schemaVersion: SCHEMA_VERSION,
    app: 'PARCHEGGIO',
    appVersion: test.meta.appVersion,
    buildNumber: installedBuild,
    buildAtStart: test.meta.buildNumber,
    updateId: test.meta.updateId,
    runtimeVersion: test.meta.runtimeVersion,
    device: test.platform,
    deviceModel: test.meta.deviceModel,
    osVersion: test.meta.osVersion,
    testId,
    scenarios: test.meta.scenarios,
    startedAt: test.startedAt,
    stoppedAt: test.stoppedAt,
    exportedAt,
    timezone: test.meta.timezone,
    config: test.config,
    permissions: test.meta.permissions,
    sensorAvailability: test.meta.sensorAvailability,
    inputs,
    events,
    sessions: sessions.map(({ testId: _t, ...s }) => s),
    snapshots,
    reviewLabels: labels,
    qualityWarnings: quality,
    serviceLog,
    nativeStatus,
    alertsSent,
    alertsReceived,
    listenLog,
  };
  return { test, json, inputs, events, sessions };
}

/** CSV: un fix per riga con stato e score, ricalcolati con lo stesso config. */
async function samplesCsv(testId: string): Promise<string> {
  const { test, inputs } = await buildExport(testId);
  const r = replay(inputs, test.config, 'X');
  // stato al tempo t: dagli snapshot + eventi
  const changes = r.events.map((e) => ({ t: e.t, state: e.to }));
  const sessions = r.sessions;
  let ci = 0;
  let state = 'UNKNOWN';
  let lastAct = '';
  const t0 = inputs.length ? inputTime(inputs[0]) : 0;
  const rows: unknown[][] = [[
    'tRelS', 'ora', 'lat', 'lon', 'accuracyM', 'speedKmh', 'heading', 'valido', 'stato', 'activity', 'distanzaDalParcheggioM',
  ]];
  for (const i of inputs) {
    if (i.kind === 'activity') lastAct = `${i.sample.activity} ${i.sample.confidence}`;
    if (i.kind !== 'location') continue;
    const s = i.sample;
    while (ci < changes.length && changes[ci].t <= s.t) state = changes[ci++].state;
    const sess = sessions.find((x) => x.startT <= s.t && (x.endT === null || x.endT >= s.t) && !x.inferred);
    rows.push([
      ((s.t - t0) / 1000).toFixed(1),
      new Date(s.t).toISOString(),
      s.latitude.toFixed(7),
      s.longitude.toFixed(7),
      s.accuracy.toFixed(1),
      s.speed === null ? '' : (s.speed * 3.6).toFixed(1),
      s.heading ?? '',
      s.accuracy <= test.config.GPS_ACCURACY_LIMIT ? 1 : 0,
      state,
      lastAct,
      sess ? Math.round(distanceM(sess.spot.pointFinal, s)) : '',
    ]);
  }
  return csv(rows);
}

async function sessionsCsv(testId: string): Promise<string> {
  const sessions = await db.getSessions(testId);
  const labels = await db.getLabels(testId);
  const rows: unknown[][] = [[
    'parkingId', 'esito', 'dedotto', 'inizio', 'fine', 'durataS', 'lat', 'lon', 'precisioneM', 'qualita', 'indirizzo', 'statoIndirizzo', 'direzioneArrivo', 'direzionePartenza', 'confidence', 'ricorrente', 'revisione',
  ]];
  for (const s of sessions) {
    const p = s.spot.pointFinal;
    const l = labels.find((x) => x.targetId === s.parkingId);
    rows.push([
      s.parkingId, s.outcome, s.inferred ? 1 : 0,
      new Date(s.startT).toISOString(), s.endT ? new Date(s.endT).toISOString() : '', s.durationS ?? '',
      p.latitude.toFixed(7), p.longitude.toFixed(7), p.accuracyM, s.spot.pointQuality,
      s.spot.address?.formatted ?? '', s.spot.geocodeStatus, s.spot.arrivalHeading ?? '', s.spot.departureHeading ?? '',
      s.releaseConfidence ?? '', s.spot.recurringSpot ? 1 : 0, l?.verdict ?? '',
    ]);
  }
  return csv(rows);
}

export type ExportKind = 'json' | 'csv' | 'parkings';

export async function shareExport(testId: string, kind: ExportKind): Promise<void> {
  const test = await db.getTest(testId);
  if (!test) throw new Error('Test non trovato');
  const base = `test_${stamp(test.startedAt)}_${test.platform}`;
  let name: string;
  let content: string;
  let mime: string;
  if (kind === 'json') {
    const { json } = await buildExport(testId);
    name = `${base}.json`;
    content = JSON.stringify(json);
    mime = 'application/json';
  } else if (kind === 'csv') {
    name = `${base}.csv`;
    content = await samplesCsv(testId);
    mime = 'text/csv';
  } else {
    name = `${base}_parcheggi.csv`;
    content = await sessionsCsv(testId);
    mime = 'text/csv';
  }
  const uri = `${FileSystem.cacheDirectory}${name}`;
  await FileSystem.writeAsStringAsync(uri, content, { encoding: FileSystem.EncodingType.UTF8 });
  await Sharing.shareAsync(uri, { mimeType: mime, dialogTitle: `Esporta ${name}`, UTI: kind === 'json' ? 'public.json' : 'public.comma-separated-values-text' });
}

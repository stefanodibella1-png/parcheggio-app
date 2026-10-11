// ParkingCT: dati sul server (Firestore via REST, nessun account).
// Inviati: zona (cella di ~5 km), parcheggi anonimi, uso del codice sostenitore.
// Mai nome, numero di telefono o posizione in tempo reale.
import { FIREBASE_CONFIG } from '../community/firebaseConfig.ts';
import { encode } from '../community/geohash.ts';
import type { ParkingSession } from '../../engine/types.ts';
import { kvGet, kvSet } from '../storage/db.ts';
import { normalizeCode, sha256Hex } from './sha256.ts';

export interface PublicConfig {
  launchAt: number;
  supportUrl: string;
  zoneTarget: number;
  zoneName: string;
}

const DEFAULT_CONFIG: PublicConfig = { launchAt: Date.parse('2026-12-01T10:00:00+01:00'), supportUrl: '', zoneTarget: 1000, zoneName: '' };

function base(): string | null {
  return FIREBASE_CONFIG ? `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents` : null;
}
function key(): string {
  return FIREBASE_CONFIG ? `key=${encodeURIComponent(FIREBASE_CONFIG.apiKey)}` : '';
}

async function call(url: string, init: RequestInit = {}, timeoutMs = 10_000): Promise<Response | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal, headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) } });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

type FsVal = { stringValue?: string; doubleValue?: number; integerValue?: string; booleanValue?: boolean; nullValue?: null };
const num = (v: FsVal | undefined): number | null => (v?.doubleValue ?? (v?.integerValue ? Number(v.integerValue) : null)) ?? null;

/** Configurazione del lancio (data, link per sostenere, obiettivo per zona). Usa l'ultima salvata se offline. */
export async function getConfig(): Promise<PublicConfig> {
  const b = base();
  if (b) {
    const r = await call(`${b}/config/public?${key()}`);
    if (r?.ok) {
      const f = ((await r.json()) as { fields: Record<string, FsVal> }).fields;
      const cfg: PublicConfig = {
        launchAt: num(f.launchAt) ?? DEFAULT_CONFIG.launchAt,
        supportUrl: f.supportUrl?.stringValue ?? '',
        zoneTarget: num(f.zoneTarget) ?? 1000,
        zoneName: f.zoneName?.stringValue ?? '',
      };
      await kvSet('pc:config', JSON.stringify(cfg)).catch(() => {});
      return cfg;
    }
  }
  const saved = await kvGet('pc:config').catch(() => null);
  return saved ? (JSON.parse(saved) as PublicConfig) : DEFAULT_CONFIG;
}

export async function deviceId(): Promise<string> {
  let id = await kvGet('community:deviceId').catch(() => null);
  if (!id) {
    id = `d${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
    await kvSet('community:deviceId', id).catch(() => {});
  }
  return id;
}

/** Registra il telefono nella sua zona (cella geohash di ~5 km). */
export async function registerDevice(lat: number, lon: number, founder: boolean): Promise<string | null> {
  const b = base();
  if (!b) return null;
  const zone = encode(lat, lon, 5);
  const id = await deviceId();
  const r = await call(`${b}/devices/${id}?${key()}`, {
    method: 'PATCH',
    body: JSON.stringify({ fields: { zone: { stringValue: zone }, t: { doubleValue: Date.now() }, founder: { booleanValue: founder } } }),
  });
  if (r?.ok) await kvSet('pc:zone', zone).catch(() => {});
  return r?.ok ? zone : null;
}

/** Quanti telefoni ParkingCT ci sono nella zona. */
export async function zoneCount(zone: string): Promise<number | null> {
  const b = base();
  if (!b) return null;
  const r = await call(`${b}:runAggregationQuery?${key()}`, {
    method: 'POST',
    body: JSON.stringify({
      structuredAggregationQuery: {
        structuredQuery: { from: [{ collectionId: 'devices' }], where: { fieldFilter: { field: { fieldPath: 'zone' }, op: 'EQUAL', value: { stringValue: zone } } } },
        aggregations: [{ alias: 'n', count: {} }],
      },
    }),
  });
  if (!r?.ok) return null;
  const j = (await r.json()) as { result?: { aggregateFields?: { n?: FsVal } } }[];
  return num(j?.[0]?.result?.aggregateFields?.n) ?? 0;
}

export type RedeemResult = 'ok' | 'invalid' | 'used' | 'offline';

/** Verifica e usa un codice sostenitore. */
export async function redeemCode(input: string): Promise<RedeemResult> {
  const b = base();
  const code = normalizeCode(input);
  if (code.length !== 12) return 'invalid';
  if (!b) return 'offline';
  const h = sha256Hex(code);
  const get = await call(`${b}/codes/${h}?${key()}`);
  if (!get) return 'offline';
  if (get.status === 404) return 'invalid';
  if (!get.ok) return 'offline';
  const doc = (await get.json()) as { fields: Record<string, FsVal> };
  const id = await deviceId();
  const usedBy = doc.fields.usedBy?.stringValue ?? null;
  if (usedBy && usedBy !== id) return 'used';
  if (!usedBy) {
    const up = await call(`${b}/codes/${h}?updateMask.fieldPaths=usedBy&updateMask.fieldPaths=usedAt&${key()}`, {
      method: 'PATCH',
      body: JSON.stringify({ fields: { usedBy: { stringValue: id }, usedAt: { doubleValue: Date.now() } } }),
    });
    if (!up) return 'offline';
    if (!up.ok) return 'used';
  }
  await kvSet('pc:founder', JSON.stringify({ code: `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8)}`, t: Date.now() })).catch(() => {});
  return 'ok';
}

export async function founderInfo(): Promise<{ code: string; t: number } | null> {
  const s = await kvGet('pc:founder').catch(() => null);
  return s ? (JSON.parse(s) as { code: string; t: number }) : null;
}

/** Parcheggio concluso, in forma anonima: serve a costruire la mappa dei posti veri. */
export async function uploadParking(s: ParkingSession): Promise<void> {
  const b = base();
  if (!b || s.parkedT === null) return;
  const p = s.spot.pointFinal;
  const id = `${await deviceId()}-${s.parkingId}`;
  await call(`${b}/parkings/${encodeURIComponent(id)}?${key()}`, {
    method: 'PATCH',
    body: JSON.stringify({
      fields: {
        latitude: { doubleValue: Math.round(p.latitude * 1e5) / 1e5 },
        longitude: { doubleValue: Math.round(p.longitude * 1e5) / 1e5 },
        geohash7: { stringValue: encode(p.latitude, p.longitude, 7) },
        parkedT: { doubleValue: Math.round(s.parkedT / 60000) * 60000 },
        durationS: { doubleValue: s.durationS ?? 0 },
        outcome: { stringValue: s.outcome },
        exitedOnFoot: { booleanValue: !!s.exitedOnFoot },
        quality: { stringValue: s.spot.pointQuality },
        atFuel: { booleanValue: !!s.atFuelStation },
        gpsLost: { booleanValue: !!s.gpsLostAtPark },
        deviceId: { stringValue: await deviceId() },
      },
    }),
  });
}

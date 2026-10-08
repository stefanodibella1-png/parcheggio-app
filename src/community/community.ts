// Community: condivisione dei posti che si liberano tra telefoni vicini.
//
// Cosa viene inviato: SOLO coordinate del posto, indirizzo, tipo (libero / si libera
// tra X minuti), orari e un identificativo casuale del telefono (per non avvisare
// se stessi). Mai nome, account o posizione di chi cerca: chi cerca LEGGE i posti
// della sua zona e filtra la distanza sul proprio telefono.
//
// Trasporto: API REST di Firestore con fetch (nessuna libreria nativa, quindi
// arriva con un aggiornamento automatico, senza reinstallare l'app).
import { distanceM } from '../../engine/geo.ts';
import { FIREBASE_CONFIG } from './firebaseConfig.ts';
import { cellsAround, encode } from './geohash.ts';

export type SpotKind = 'FREED' | 'SOON';

export interface SharedSpot {
  id: string;
  kind: SpotKind;
  latitude: number;
  longitude: number;
  geohash6: string;
  address: string | null;
  quality: string | null;
  confidence: number;
  /** quando il posto sarà libero (per SOON), o quando si è liberato (FREED) */
  freeAt: number;
  createdAt: number;
  expiresAt: number;
  deviceId: string;
}

export interface NearbySpot extends SharedSpot {
  distanceM: number;
}

export function communityConfigured(): boolean {
  return FIREBASE_CONFIG !== null;
}

function base(): string | null {
  if (!FIREBASE_CONFIG) return null;
  return `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents`;
}

function keyParam(): string {
  return FIREBASE_CONFIG ? `key=${encodeURIComponent(FIREBASE_CONFIG.apiKey)}` : '';
}

// ---- conversione da/verso il formato dei documenti Firestore ----------------------

type FsValue =
  | { stringValue: string }
  | { doubleValue: number }
  | { integerValue: string }
  | { nullValue: null }
  | { booleanValue: boolean };

function toFields(o: Record<string, string | number | null>): Record<string, FsValue> {
  const out: Record<string, FsValue> = {};
  for (const [k, v] of Object.entries(o)) {
    if (v === null) out[k] = { nullValue: null };
    else if (typeof v === 'number') out[k] = { doubleValue: v };
    else out[k] = { stringValue: v };
  }
  return out;
}

function fromValue(v: Record<string, unknown> | undefined): string | number | null {
  if (!v) return null;
  if ('stringValue' in v) return v.stringValue as string;
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('integerValue' in v) return Number(v.integerValue);
  return null;
}

function fromDoc(fields: Record<string, Record<string, unknown>>): SharedSpot | null {
  const g = (k: string) => fromValue(fields[k]);
  const lat = g('latitude');
  const lon = g('longitude');
  const kind = g('kind');
  if (typeof lat !== 'number' || typeof lon !== 'number' || (kind !== 'FREED' && kind !== 'SOON')) return null;
  return {
    id: String(g('id') ?? ''),
    kind,
    latitude: lat,
    longitude: lon,
    geohash6: String(g('geohash6') ?? ''),
    address: (g('address') as string | null) ?? null,
    quality: (g('quality') as string | null) ?? null,
    confidence: Number(g('confidence') ?? 0),
    freeAt: Number(g('freeAt') ?? 0),
    createdAt: Number(g('createdAt') ?? 0),
    expiresAt: Number(g('expiresAt') ?? 0),
    deviceId: String(g('deviceId') ?? ''),
  };
}

async function call(url: string, init: RequestInit, timeoutMs = 10_000): Promise<Response | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ---- operazioni ---------------------------------------------------------------

/** Pubblica (o aggiorna) un posto. true = salvato sul server. */
export async function publishSpot(spot: Omit<SharedSpot, 'geohash6'>): Promise<boolean> {
  const b = base();
  if (!b) return false;
  const full: SharedSpot = { ...spot, geohash6: encode(spot.latitude, spot.longitude, 6) };
  const r = await call(`${b}/spots/${encodeURIComponent(spot.id)}?${keyParam()}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: toFields({ ...full }) }),
  });
  return !!r && r.ok;
}

/** Ritira un posto (previsione annullata, rilascio incerto). */
export async function withdrawSpot(id: string): Promise<void> {
  const b = base();
  if (!b) return;
  await call(`${b}/spots/${encodeURIComponent(id)}?${keyParam()}`, { method: 'DELETE' });
}

/**
 * Posti condivisi attorno a un punto: entro `radiusM`, non scaduti e non
 * pubblicati da questo telefono. null = server non raggiungibile.
 */
export async function fetchNearby(
  center: { latitude: number; longitude: number },
  radiusM: number,
  myDeviceId: string,
  now: number,
): Promise<NearbySpot[] | null> {
  const b = base();
  if (!b) return null;
  const cells = cellsAround(center.latitude, center.longitude, 6);
  const r = await call(`${b}:runQuery?${keyParam()}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: 'spots' }],
        where: {
          fieldFilter: {
            field: { fieldPath: 'geohash6' },
            op: 'IN',
            value: { arrayValue: { values: cells.map((c) => ({ stringValue: c })) } },
          },
        },
        limit: 100,
      },
    }),
  });
  if (!r || !r.ok) return null;
  const rows = (await r.json()) as { document?: { fields: Record<string, Record<string, unknown>> } }[];
  const out: NearbySpot[] = [];
  for (const row of rows) {
    if (!row.document) continue;
    const s = fromDoc(row.document.fields);
    if (!s || s.expiresAt <= now || s.deviceId === myDeviceId) continue;
    const d = Math.round(distanceM(center, s));
    if (d <= radiusM) out.push({ ...s, distanceM: d });
  }
  return out.sort((a, b2) => a.freeAt - b2.freeAt || a.distanceM - b2.distanceM);
}

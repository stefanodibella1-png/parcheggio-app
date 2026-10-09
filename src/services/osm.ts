// Semafori e distributori di carburante da OpenStreetMap (Overpass API), scaricati per zone di circa 2 km
// e tenuti sul telefono per 30 giorni. Servono al motore per distinguere la coda
// al semaforo da un parcheggio. Dati © OpenStreetMap contributors (ODbL).
import { kvGet, kvSet } from '../storage/db.ts';

export interface Signal {
  latitude: number;
  longitude: number;
}

export interface MapData {
  signals: Signal[];
  fuel: Signal[];
}

const TILE = 0.02; // gradi
const MARGIN = 0.003; // ~300 m oltre il bordo della zona
const TTL_MS = 30 * 24 * 3600_000;
const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];

export function tileKey(lat: number, lon: number): string {
  return `${Math.floor(lat / TILE)}_${Math.floor(lon / TILE)}`;
}

async function download(key: string): Promise<MapData | null> {
  const [a, b] = key.split('_').map(Number);
  const s = a * TILE - MARGIN;
  const w = b * TILE - MARGIN;
  const n = (a + 1) * TILE + MARGIN;
  const e = (b + 1) * TILE + MARGIN;
  const bbox = `${s.toFixed(4)},${w.toFixed(4)},${n.toFixed(4)},${e.toFixed(4)}`;
  const q =
    `[out:json][timeout:25];(node["highway"="traffic_signals"](${bbox});node["crossing"="traffic_signals"](${bbox});` +
    `nwr["amenity"="fuel"](${bbox}););out tags center;`;
  for (const url of ENDPOINTS) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 25_000);
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(q)}`,
        signal: ctrl.signal,
      });
      if (!r.ok) continue;
      type El = { lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> };
      const j = (await r.json()) as { elements?: El[] };
      const pos = (x: El): Signal | null => {
        const lat = x.lat ?? x.center?.lat;
        const lon = x.lon ?? x.center?.lon;
        return typeof lat === 'number' && typeof lon === 'number' ? { latitude: lat, longitude: lon } : null;
      };
      const out: MapData = { signals: [], fuel: [] };
      for (const x of j.elements ?? []) {
        const p = pos(x);
        if (!p) continue;
        if (x.tags?.amenity === 'fuel') out.fuel.push(p);
        else out.signals.push(p);
      }
      return out;
    } catch {
      // prova il server successivo
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

/** Semafori e distributori della zona (dalla memoria del telefono o scaricati). null = non disponibili ora. */
export async function signalsForTile(key: string, now: number): Promise<MapData | null> {
  try {
    const cached = await kvGet(`osm:map:${key}`);
    if (cached) {
      const c = JSON.parse(cached) as { t: number; data: MapData };
      if (now - c.t < TTL_MS) return c.data;
    }
  } catch {
    // cache illeggibile: si riscarica
  }
  const fresh = await download(key);
  if (fresh) await kvSet(`osm:map:${key}`, JSON.stringify({ t: now, data: fresh })).catch(() => {});
  return fresh;
}

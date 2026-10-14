// Divieti di sosta da OpenStreetMap: isole pedonali, strade con divieto di sosta/fermata su entrambi
// i lati, passi carrabili. Una "sosta" lì è una fermata o una doppia fila, non un posto da segnalare.
// Scaricati per zone di circa 2 km e tenuti sul telefono per 30 giorni. Dati © OpenStreetMap contributors (ODbL).
import { kvGet, kvSet } from '../storage/db.ts';
import { tileKey } from './osm.ts';

type Pt = [number, number]; // lat, lon
export interface Restriction {
  kind: 'pedestrian' | 'no_parking' | 'driveway';
  pts: Pt[];
}

const TILE = 0.02;
const MARGIN = 0.003;
const TTL_MS = 30 * 24 * 3600_000;
const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];

async function download(key: string): Promise<Restriction[] | null> {
  const [a, b] = key.split('_').map(Number);
  const bbox = `${(a * TILE - MARGIN).toFixed(4)},${(b * TILE - MARGIN).toFixed(4)},${((a + 1) * TILE + MARGIN).toFixed(4)},${((b + 1) * TILE + MARGIN).toFixed(4)}`;
  const q =
    `[out:json][timeout:25];(` +
    `way["highway"="pedestrian"](${bbox});` +
    `way["parking:both"~"^(no|no_parking|no_stopping)$"](${bbox});` +
    `way["parking:both:restriction"~"^(no_parking|no_stopping)$"](${bbox});` +
    `way["parking:lane:both"~"^(no_parking|no_stopping|fire_lane)$"](${bbox});` +
    `way["service"="driveway"](${bbox});` +
    `);out tags geom;`;
  for (const url of ENDPOINTS) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 25_000);
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `data=${encodeURIComponent(q)}`, signal: ctrl.signal });
      if (!r.ok) continue;
      type El = { tags?: Record<string, string>; geometry?: { lat: number; lon: number }[] };
      const j = (await r.json()) as { elements?: El[] };
      const out: Restriction[] = [];
      for (const x of j.elements ?? []) {
        const g = x.geometry;
        if (!g || g.length === 0) continue;
        const pts = g.map((p) => [p.lat, p.lon] as Pt);
        const t = x.tags ?? {};
        if (t.service === 'driveway') out.push({ kind: 'driveway', pts: [pts[0], pts[pts.length - 1]] });
        else if (t.highway === 'pedestrian') out.push({ kind: 'pedestrian', pts });
        else out.push({ kind: 'no_parking', pts });
      }
      return out;
    } catch {
      // server successivo
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

async function forTile(key: string, now: number): Promise<Restriction[] | null> {
  try {
    const c = await kvGet(`osm:rules1:${key}`);
    if (c) {
      const v = JSON.parse(c) as { t: number; data: Restriction[] };
      if (now - v.t < TTL_MS) return v.data;
    }
  } catch {
    // cache illeggibile
  }
  const fresh = await download(key);
  if (fresh) await kvSet(`osm:rules1:${key}`, JSON.stringify({ t: now, data: fresh })).catch(() => {});
  return fresh;
}

/** distanza in metri da un punto a un segmento (proiezione locale) */
function segDist(p: Pt, a: Pt, b: Pt): number {
  const k = Math.cos((p[0] * Math.PI) / 180);
  const ax = (a[1] - p[1]) * 111_320 * k;
  const ay = (a[0] - p[0]) * 110_540;
  const bx = (b[1] - p[1]) * 111_320 * k;
  const by = (b[0] - p[0]) * 110_540;
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2));
  const x = ax + t * dx;
  const y = ay + t * dy;
  return Math.sqrt(x * x + y * y);
}

/**
 * Il posto è in una zona dove non si parcheggia? null = nessun divieto noto (o dati non disponibili).
 * Le distanze arrivano da engine/config.ts.
 */
export async function parkingRestriction(
  lat: number,
  lon: number,
  now: number,
  cfg: { OSM_NOPARK_RADIUS_M: number; OSM_DRIVEWAY_RADIUS_M: number },
): Promise<Restriction['kind'] | null> {
  const list = await forTile(tileKey(lat, lon), now);
  if (!list) return null;
  const p: Pt = [lat, lon];
  for (const r of list) {
    if (r.kind === 'driveway') {
      if (r.pts.some((q) => segDist(p, q, q) <= cfg.OSM_DRIVEWAY_RADIUS_M)) return 'driveway';
      continue;
    }
    for (let i = 1; i < r.pts.length; i++) {
      if (segDist(p, r.pts[i - 1], r.pts[i]) <= cfg.OSM_NOPARK_RADIUS_M) return r.kind;
    }
  }
  return null;
}

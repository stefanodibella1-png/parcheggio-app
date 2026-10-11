// Usato solo da .github/workflows/stats.yml (ogni 15 minuti).
// Calcola i numeri di ParkingCT con l'account di servizio e li scrive nella cassaforte
// del control center (vault/{v}/stats/latest): l'app pubblica non può leggerli.
import { GoogleAuth } from 'google-auth-library';

const pid = process.env.PROJECT_ID;
const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform', 'https://www.googleapis.com/auth/datastore'] });
const token = (await (await auth.getClient()).getAccessToken()).token;
const base = `https://firestore.googleapis.com/v1/projects/${pid}/databases/(default)/documents`;

async function api(method, url, body) {
  const r = await fetch(url, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* testo */ }
  return { ok: r.ok, status: r.status, json, text };
}

async function listAll(collection) {
  const out = [];
  let pageToken = '';
  for (;;) {
    const r = await api('GET', `${base}/${collection}?pageSize=300${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`);
    if (!r.ok) { if (r.status === 404) return out; throw new Error(`${collection}: HTTP ${r.status} ${r.text.slice(0, 200)}`); }
    out.push(...(r.json.documents ?? []).map((d) => ({ id: d.name.split('/').pop(), f: d.fields ?? {} })));
    if (!r.json.nextPageToken) return out;
    pageToken = r.json.nextPageToken;
  }
}

const num = (v) => (v?.doubleValue ?? (v?.integerValue !== undefined ? Number(v.integerValue) : null));
const str = (v) => v?.stringValue ?? null;

const key = await api('GET', `${base}/admin/key`);
if (key.status === 404) {
  console.log('::notice title=Statistiche::password admin non ancora scelta (7 tocchi sul logo di ParkingCT)');
  process.exit(0);
}
if (!key.ok) { console.log(`::error title=Statistiche::HTTP ${key.status} ${key.text.slice(0, 300)}`); process.exit(1); }
const v = str(key.json.fields.v);

const B32 = '0123456789bcdefghjkmnpqrstuvwxyz';
function center(h) {
  let la = [-90, 90], lo = [-180, 180], even = true;
  for (const ch of h) {
    const x = B32.indexOf(ch);
    for (let i = 4; i >= 0; i--) {
      const bit = (x >> i) & 1;
      const r = even ? lo : la;
      const mid = (r[0] + r[1]) / 2;
      if (bit) r[0] = mid; else r[1] = mid;
      even = !even;
    }
  }
  return { lat: (la[0] + la[1]) / 2, lon: (lo[0] + lo[1]) / 2 };
}

const now = Date.now();
// mezzanotte di oggi in Italia
const romeNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Rome' }));
const startToday = now - ((romeNow.getHours() * 60 + romeNow.getMinutes()) * 60 + romeNow.getSeconds()) * 1000;

const [devices, parkings, invites, events, vcodes] = await Promise.all([
  listAll('devices'),
  listAll('parkings'),
  listAll('invites'),
  listAll('adEvents'),
  listAll(`vault/${v}/codes`),
]);

const zones = new Map();
const byTier = {};
const versions = {};
let active24h = 0, active7d = 0, newToday = 0, new7d = 0, founders = 0;
for (const d of devices) {
  if (d.id === 'ci-test') continue;
  const t = num(d.f.t) ?? 0;
  const first = num(d.f.first) ?? t;
  if (now - t < 86400000) active24h++;
  if (now - t < 7 * 86400000) active7d++;
  if (first >= startToday) newToday++;
  if (now - first < 7 * 86400000) new7d++;
  if (d.f.founder?.booleanValue) {
    founders++;
    const tier = str(d.f.tier) || 'base';
    byTier[tier] = (byTier[tier] ?? 0) + 1;
  }
  const z = str(d.f.zone) ?? '?';
  zones.set(z, (zones.get(z) ?? 0) + 1);
  const ver = str(d.f.v) || 'vecchia';
  versions[ver] = (versions[ver] ?? 0) + 1;
}

const ads = {};
for (const e of events) {
  const id = str(e.f.adId);
  if (!id) continue;
  ads[id] ??= { views: 0, clicks: 0 };
  if (str(e.f.kind) === 'click') ads[id].clicks++; else ads[id].views++;
}

const codesUsedSet = [];
for (const c of vcodes) {
  const r = await api('GET', `${base}/codes/${c.id}`);
  if (r.ok && str(r.json.fields?.usedBy)) codesUsedSet.push(c.id);
}
const usedAll = await api('POST', `${base}:runAggregationQuery`, {
  structuredAggregationQuery: {
    structuredQuery: { from: [{ collectionId: 'codes' }], where: { fieldFilter: { field: { fieldPath: 'usedAt' }, op: 'GREATER_THAN', value: { doubleValue: 0 } } } },
    aggregations: [{ alias: 'n', count: {} }],
  },
});
const codesUsed = num(usedAll.json?.[0]?.result?.aggregateFields?.n) ?? codesUsedSet.length;

const inv = invites.map((d) => ({ code: d.id, n: num(d.f.n) ?? 0 })).sort((a, b) => b.n - a.n);
const stats = {
  at: now,
  devices: devices.filter((d) => d.id !== 'ci-test').length,
  active24h,
  active7d,
  newToday,
  new7d,
  founders,
  byTier,
  zones: [...zones.entries()].map(([zone, n]) => ({ zone, n, ...center(zone) })).sort((a, b) => b.n - a.n),
  versions,
  codesUsed,
  codesGenerated: vcodes.length,
  parkings: parkings.length,
  parkings7d: parkings.filter((p) => now - (num(p.f.parkedT) ?? 0) < 7 * 86400000).length,
  invites: inv.slice(0, 20),
  invitedTotal: inv.reduce((s, x) => s + x.n, 0),
  ads,
  codesUsedSet,
};
const w = await api('PATCH', `${base}/vault/${v}/stats/latest`, { fields: { json: { stringValue: JSON.stringify(stats) }, at: { doubleValue: now } } });
if (!w.ok) { console.log(`::error title=Statistiche::HTTP ${w.status} ${w.text.slice(0, 300)}`); process.exit(1); }
console.log(`::notice title=Statistiche::${stats.devices} installazioni, ${stats.active24h} attive 24h, ${stats.parkings} parcheggi`);

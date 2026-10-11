// Prova la community come fa l'app: scrive un posto, lo ritrova con la ricerca per zona e lo cancella.
import { readFileSync } from 'node:fs';
const src = readFileSync('src/community/firebaseConfig.ts', 'utf8');
const apiKey = src.match(/"apiKey": "([^"]+)"/)[1];
const pid = src.match(/"projectId": "([^"]+)"/)[1];
const base = `https://firestore.googleapis.com/v1/projects/${pid}/databases/(default)/documents`;
const now = Date.now();
const f = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'number' ? { doubleValue: v } : { stringValue: v }]));
const doc = { id: 'ci-test', kind: 'SOON', latitude: 37.5079, longitude: 15.083, geohash6: 'sqdxqe', address: 'Prova automatica', quality: 'A', confidence: 0, freeAt: now + 60000, createdAt: now, expiresAt: now + 120000, deviceId: 'ci' };
const w = await fetch(`${base}/spots/ci-test?key=${apiKey}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: f(doc) }) });
if (!w.ok) { console.log(`::error title=Community scrittura::HTTP ${w.status} ${(await w.text()).slice(0, 400).replace(/\n/g, ' ')}`); process.exit(1); }
const q = await fetch(`${base}:runQuery?key=${apiKey}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'spots' }], where: { fieldFilter: { field: { fieldPath: 'geohash6' }, op: 'IN', value: { arrayValue: { values: [{ stringValue: 'sqdxqe' }] } } } } } }) });
const rows = q.ok ? await q.json() : [];
const found = rows.some((r) => r.document && r.document.name.endsWith('/spots/ci-test'));
if (!found) { console.log(`::error title=Community lettura::HTTP ${q.status} posto di prova non trovato`); process.exit(1); }
const bad = await fetch(`${base}/spots/ci-bad?key=${apiKey}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: f({ evil: 'x' }) }) });
const d = await fetch(`${base}/spots/ci-test?key=${apiKey}`, { method: 'DELETE' });
const v = await fetch(`${base}/validations/ci-test?key=${apiKey}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: f({ spotId: 'ci-test', latitude: 37.5079, longitude: 15.083, geohash6: 'sqdxqe', t: now, deviceId: 'ci' }) }) });
if (!v.ok) { console.log(`::error title=Community conferme::HTTP ${v.status} ${(await v.text()).slice(0, 300).replace(/\n/g, ' ')}`); process.exit(1); }
console.log(`::notice title=Community prova::conferma automatica (posto preso) OK; scrittura OK, lettura per zona OK, cancellazione ${d.ok ? 'OK' : 'KO ' + d.status}, documento non valido ${bad.ok ? 'ACCETTATO (regole da rivedere)' : 'rifiutato dalle regole OK'}`);

// ParkingCT: configurazione leggibile, registrazione per zona e conteggio
const cfg = await fetch(`${base}/config/public?key=${apiKey}`);
if (!cfg.ok) { console.log(`::error title=ParkingCT config::HTTP ${cfg.status}`); process.exit(1); }
const dv = await fetch(`${base}/devices/ci-test?key=${apiKey}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: { zone: { stringValue: 'zzzzz' }, t: { doubleValue: now }, founder: { booleanValue: false } } }) });
if (!dv.ok) { console.log(`::error title=ParkingCT device::HTTP ${dv.status} ${(await dv.text()).slice(0, 300).replace(/\n/g, ' ')}`); process.exit(1); }
const cnt = await fetch(`${base}:runAggregationQuery?key=${apiKey}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ structuredAggregationQuery: { structuredQuery: { from: [{ collectionId: 'devices' }], where: { fieldFilter: { field: { fieldPath: 'zone' }, op: 'EQUAL', value: { stringValue: 'zzzzz' } } } }, aggregations: [{ alias: 'n', count: {} }] } }) });
const cj = cnt.ok ? await cnt.json() : null;
const n = cj?.[0]?.result?.aggregateFields?.n?.integerValue;
if (!n) { console.log(`::error title=ParkingCT conteggio::HTTP ${cnt.status} ${JSON.stringify(cj).slice(0, 300)}`); process.exit(1); }
const codeBad = await fetch(`${base}/codes/${'0'.repeat(64)}?key=${apiKey}`);
const firstHash = readFileSync('tools/ci/founder-codes.sha256', 'utf8').split('\n').find((x) => /^[0-9a-f]{64}$/.test(x.trim()));
const codeOk = await fetch(`${base}/codes/${firstHash}?key=${apiKey}`);
console.log(`::notice title=Codice reale::lettura → ${codeOk.status} ${(await codeOk.text()).slice(0, 200).replace(/\n/g, ' ')}`);
const listCodes = await fetch(`${base}/codes?key=${apiKey}`);
console.log(`::notice title=ParkingCT prova::config OK, registrazione zona OK, conteggio ${n}, codice inesistente → ${codeBad.status}, elenco codici → ${listCodes.status} (deve essere 403)`);

// Prova del control center (come fa l'app), solo se la password admin non è ancora stata scelta.
// Alla fine cancella tutto con l'account di servizio, così la prima password resta libera.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { GoogleAuth } from 'google-auth-library';

const pid = process.env.PROJECT_ID;
const cfgSrc = readFileSync(process.env.CFG_FILE, "utf8");
const apiKey = /apiKey":\s*"([^"]+)"/.exec(cfgSrc)[1];
const base = `https://firestore.googleapis.com/v1/projects/${pid}/databases/(default)/documents`;
const name = (p) => `projects/${pid}/databases/(default)/documents/${p}`;
const sha = (s) => createHash('sha256').update(s).digest('hex');
const token = (await (await new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] }).getClient()).getAccessToken()).token;
const sa = (method, url) => fetch(url, { method, headers: { Authorization: `Bearer ${token}` } });

if ((await sa('GET', `${base}/admin/key`)).ok) {
  console.log('::notice title=Prova control center::password admin già scelta, prova saltata');
  process.exit(0);
}
const pub = async (method, path, body) => {
  const r = await fetch(`${base}${path}${path.includes('?') ? '&' : '?'}key=${apiKey}`, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { ok: r.ok, status: r.status, text: await r.text() };
};
const commit = (writes) => pub('POST', ':commit', { writes });
const s = sha('parkingct-admin:prova-ci-123');
const v = sha(String(Math.random())).slice(0, 32);
const results = [];
const check = (label, cond) => results.push(`${cond ? 'OK' : 'KO'} ${label}`);
try {
  const c1 = await commit([
    { update: { name: name('admin/key'), fields: { s: { stringValue: s }, v: { stringValue: v }, prev: { stringValue: '' } } }, currentDocument: { exists: false } },
    { update: { name: name(`gate/${s}`), fields: { v: { stringValue: v } } }, currentDocument: { exists: false } },
  ]);
  check(`prima password (${c1.status} ${c1.ok ? '' : c1.text.slice(0, 200)})`, c1.ok);
  const g = await pub('GET', `/gate/${s}`);
  check('accesso con password', g.ok && g.text.includes(v));
  const gBad = await pub('GET', `/gate/${sha('parkingct-admin:sbagliata')}`);
  check('password sbagliata rifiutata', !gBad.ok);
  const k = await pub('GET', '/admin/key');
  check('chiave admin illeggibile', !k.ok);
  const tokenW = { update: { name: name(`vault/${v}/tokens/w`), fields: {} }, updateTransforms: [{ fieldPath: 't', setToServerValue: 'REQUEST_TIME' }] };
  const ad = { update: { name: name('ads/ci-test'), fields: { title: { stringValue: 'prova' }, active: { booleanValue: false } } } };
  const a1 = await commit([tokenW, ad]);
  check(`pubblicità con lasciapassare (${a1.status} ${a1.ok ? '' : a1.text.slice(0, 200)})`, a1.ok);
  const a2 = await commit([ad]);
  check('pubblicità senza lasciapassare rifiutata', !a2.ok);
  const code = { update: { name: name(`codes/${sha('CITESTCODE01')}`), fields: { usedBy: { nullValue: null }, usedAt: { nullValue: null }, tier: { stringValue: 'oro' } } }, currentDocument: { exists: false } };
  const c2 = await commit([code]);
  check('codice senza lasciapassare rifiutato', !c2.ok);
  const c3 = await commit([tokenW, code]);
  check(`codice con lasciapassare (${c3.status})`, c3.ok);
  const newS = sha('parkingct-admin:nuova-ci-456');
  const p1 = await commit([
    { update: { name: name('admin/key'), fields: { s: { stringValue: newS }, v: { stringValue: v }, prev: { stringValue: sha('parkingct-admin:sbagliata') } } } },
    { update: { name: name(`gate/${newS}`), fields: { v: { stringValue: v } } }, currentDocument: { exists: false } },
  ]);
  check('cambio password con password sbagliata rifiutato', !p1.ok);
  const p2 = await commit([
    { update: { name: name('admin/key'), fields: { s: { stringValue: newS }, v: { stringValue: v }, prev: { stringValue: s } } } },
    { update: { name: name(`gate/${newS}`), fields: { v: { stringValue: v } } }, currentDocument: { exists: false } },
  ]);
  check(`cambio password (${p2.status} ${p2.ok ? '' : p2.text.slice(0, 200)})`, p2.ok);
  check('vecchia password non vale più', !(await pub('GET', `/gate/${s}`)).ok);
  check('nuova password vale', (await pub('GET', `/gate/${newS}`)).ok);
  const vr = await pub('GET', `/vault/${v}/tokens/w`);
  check('cassaforte leggibile con la chiave', vr.ok);
  const vr2 = await pub('GET', `/vault/${'0'.repeat(32)}/tokens/w`);
  check('cassaforte sbagliata rifiutata', !vr2.ok);
  const dv = await pub('GET', '/devices');
  check('elenco telefoni nascosto', !dv.ok);
} finally {
  for (const p of ['admin/key', `gate/${s}`, `gate/${sha('parkingct-admin:nuova-ci-456')}`, `vault/${v}/tokens/w`, 'ads/ci-test', `codes/${sha('CITESTCODE01')}`]) await sa('DELETE', `${base}/${p}`);
}
const bad = results.filter((r) => r.startsWith('KO'));
console.log(`::${bad.length ? 'error' : 'notice'} title=Prova control center::${results.join(' · ')}`);
if (bad.length) process.exit(1);

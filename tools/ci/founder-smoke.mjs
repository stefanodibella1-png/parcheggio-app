// Prova automatica: codice sostenitore spostato su un altro telefono e limite di correzione del nome nel muro.
// Crea un codice di prova con l'account di servizio, prova come fa l'app (chiave pubblica) e poi cancella tutto.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { GoogleAuth } from 'google-auth-library';

const pid = process.env.PROJECT_ID;
const apiKey = /apiKey":\s*"([^"]+)"/.exec(readFileSync(process.env.CFG_FILE, 'utf8'))[1];
const base = `https://firestore.googleapis.com/v1/projects/${pid}/databases/(default)/documents`;
const token = (await (await new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] }).getClient()).getAccessToken()).token;
const sa = (method, path, body) => fetch(`${base}/${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
const pub = async (method, path, body) => {
  const r = await fetch(`${base}/${path}${path.includes('?') ? '&' : '?'}key=${apiKey}`, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { ok: r.ok, status: r.status, text: await r.text() };
};
const h = createHash('sha256').update(`CITEST${Date.now()}`).digest('hex');
const res = [];
const check = (l, c) => res.push(`${c ? 'OK' : 'KO'} ${l}`);
const mask = (keys) => keys.map((k) => `updateMask.fieldPaths=${k}`).join('&');
const wall = (name, by, edits) => ({ fields: { name: { stringValue: name }, visible: { booleanValue: !!name }, tier: { stringValue: 'oro' }, t: { doubleValue: 1 }, by: { stringValue: by }, edits: { integerValue: String(edits) } } });
try {
  await sa('PATCH', `codes/${h}`, { fields: { usedBy: { nullValue: null }, usedAt: { nullValue: null }, tier: { stringValue: 'oro' } } });
  let r = await pub('PATCH', `codes/${h}?${mask(['usedBy', 'usedAt'])}`, { fields: { usedBy: { stringValue: 'telA' }, usedAt: { doubleValue: 1 } } });
  check('prima attivazione', r.ok);
  r = await pub('PATCH', `codes/${h}?${mask(['usedBy', 'usedAt'])}`, { fields: { usedBy: { stringValue: 'ladro' }, usedAt: { doubleValue: 2 } } });
  check('spostamento senza contatore rifiutato', !r.ok);
  r = await pub('PATCH', `codes/${h}?${mask(['usedBy', 'usedAt', 'moves'])}`, { fields: { usedBy: { stringValue: 'telB' }, usedAt: { doubleValue: 2 }, moves: { integerValue: '1' } } });
  check(`spostamento su nuovo telefono (${r.status})`, r.ok);
  r = await pub('PATCH', `codes/${h}?${mask(['tier'])}`, { fields: { tier: { stringValue: 'platino' } } });
  check('cambio livello rifiutato', !r.ok);
  const wm = mask(['name', 'visible', 'tier', 't', 'by', 'edits']);
  r = await pub('PATCH', `wall/${h}?${wm}`, wall('Mario R.', 'telA', 1));
  check('muro dal vecchio telefono rifiutato', !r.ok);
  r = await pub('PATCH', `wall/${h}?${wm}`, wall('Mario R.', 'telB', 1));
  check(`primo nome (${r.status} ${r.ok ? '' : r.text.slice(0, 160)})`, r.ok);
  r = await pub('PATCH', `wall/${h}?${wm}`, wall('Mario Rossi', 'telB', 1));
  check('cambio nome senza contare rifiutato', !r.ok);
  r = await pub('PATCH', `wall/${h}?${wm}`, wall('Mario Rossi', 'telB', 2));
  check('una correzione permessa', r.ok);
  r = await pub('PATCH', `wall/${h}?${wm}`, wall('Super Mario', 'telB', 3));
  check('seconda correzione rifiutata', !r.ok);
  r = await pub('PATCH', `wall/${h}?${wm}`, wall('', 'telB', 2));
  check('tornare anonimo permesso', r.ok);
  r = await pub('PATCH', `wall/${h}?${wm}`, wall('Altro Nome', 'telB', 3));
  check('nuovo nome dopo anonimo rifiutato', !r.ok);
} finally {
  await sa('DELETE', `codes/${h}`);
  await sa('DELETE', `wall/${h}`);
}
const bad = res.filter((x) => x.startsWith('KO'));
console.log(`::${bad.length ? 'error' : 'notice'} title=Prova codici e muro::${res.join(' · ')}`);
if (bad.length) process.exit(1);

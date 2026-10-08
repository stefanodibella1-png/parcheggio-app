// Usato solo da .github/workflows/firebase.yml.
// Pubblica le regole Firestore e scrive la configurazione web nell'app usando
// direttamente le API di Firebase con l'account di servizio (GOOGLE_APPLICATION_CREDENTIALS).
import { readFileSync, writeFileSync } from 'node:fs';
import { GoogleAuth } from 'google-auth-library';

const pid = process.env.PROJECT_ID;
const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform', 'https://www.googleapis.com/auth/firebase'] });
const client = await auth.getClient();
const token = (await client.getAccessToken()).token;

async function api(method, url, body) {
  const r = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'x-goog-user-project': pid },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* testo */ }
  return { ok: r.ok, status: r.status, json, text };
}

function fail(title, res) {
  console.log(`::error title=${title}::HTTP ${res.status} ${res.text.slice(0, 800).replace(/\n/g, ' ')}`);
  process.exit(1);
}

// 1) regole
const rules = readFileSync('firestore.rules', 'utf8');
const rs = await api('POST', `https://firebaserules.googleapis.com/v1/projects/${pid}/rulesets`, {
  source: { files: [{ name: 'firestore.rules', content: rules }] },
});
if (!rs.ok) fail('Regole (ruleset)', rs);
const rulesetName = rs.json.name;
const relName = `projects/${pid}/releases/cloud.firestore`;
let rel = await api('PATCH', `https://firebaserules.googleapis.com/v1/${relName}`, { release: { name: relName, rulesetName } });
if (rel.status === 404) rel = await api('POST', `https://firebaserules.googleapis.com/v1/projects/${pid}/releases`, { name: relName, rulesetName });
if (!rel.ok) fail('Regole (release)', rel);
console.log('::notice title=Firestore regole::pubblicate');

// 2) configurazione dell'app web
const list = await api('GET', `https://firebase.googleapis.com/v1beta1/projects/${pid}/webApps`);
if (!list.ok) fail('App web (elenco)', list);
const app = (list.json.apps ?? [])[0];
if (!app) {
  console.log("::error title=App web::nessuna app web nel progetto: registrala dalla console (icona </>)");
  process.exit(1);
}
const cfgRes = await api('GET', `https://firebase.googleapis.com/v1beta1/projects/${pid}/webApps/${app.appId}/config`);
if (!cfgRes.ok) fail('App web (configurazione)', cfgRes);
const c = cfgRes.json;
const cfg = {
  apiKey: c.apiKey,
  authDomain: c.authDomain,
  projectId: c.projectId,
  storageBucket: c.storageBucket,
  messagingSenderId: c.messagingSenderId,
  appId: c.appId,
};
const head =
  '// Configurazione Firebase del progetto PARCHEGGIO (Firestore).\n' +
  '// Scritta in automatico da .github/workflows/firebase.yml. Valori pubblici:\n' +
  '// la protezione dei dati è affidata alle regole in firestore.rules.\n';
const body =
  'export const FIREBASE_CONFIG: {\n  apiKey: string;\n  authDomain: string;\n  projectId: string;\n  storageBucket?: string;\n  messagingSenderId?: string;\n  appId: string;\n} | null = ' +
  JSON.stringify(cfg, null, 2) +
  ';\n';
writeFileSync('src/community/firebaseConfig.ts', head + body);
console.log(`::notice title=FIREBASE_CONFIG::${cfg.projectId} ${cfg.appId}`);

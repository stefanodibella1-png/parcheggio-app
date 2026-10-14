// Legge gli ultimi errori inviati dalle app (collezione crashes) e li stampa come avvisi della run.
import { GoogleAuth } from 'google-auth-library';
const pid = process.env.PROJECT_ID;
const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/datastore'] });
const token = (await (await auth.getClient()).getAccessToken()).token;
const r = await fetch(`https://firestore.googleapis.com/v1/projects/${pid}/databases/(default)/documents:runQuery`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'crashes' }], orderBy: [{ field: { fieldPath: 't' }, direction: 'DESCENDING' }], limit: 15 } }),
});
const rows = (await r.json()).filter((x) => x.document);
if (!rows.length) console.log('::notice title=Errori app::nessun errore registrato');
for (const x of rows) {
  const f = x.document.fields;
  const g = (k) => f[k]?.stringValue ?? f[k]?.doubleValue ?? '';
  const when = new Date(Number(g('t'))).toLocaleString('it-IT', { timeZone: 'Europe/Rome' });
  const line = `${when} | ${g('app')} build ${g('build')} upd ${String(g('update')).slice(0, 8)} ${g('os')} | ${g('kind')} | ${g('msg')} | ${String(g('stack')).replace(/\n/g, ' ⏎ ').slice(0, 600)} | ${String(g('extra')).replace(/\n/g, ' ').slice(0, 300)}`;
  console.log(`::warning title=Errore app::${line.replace(/%/g, '%25').replace(/\r?\n/g, ' ')}`);
}

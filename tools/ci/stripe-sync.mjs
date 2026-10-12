// Usato solo da .github/workflows/stripe.yml.
// 1) Crea (una volta) prodotti, prezzi e link di pagamento Stripe per i tre livelli e li scrive in config/public.
// 2) Legge i pagamenti completati e per ognuno genera il codice personale (+ codici regalo),
//    lo registra sul server e lo mette a disposizione del telefono che ha pagato (pickup/{ref}).
// Chiave: secret STRIPE_SECRET_KEY (modalità test: sk_test_...). Gira in ciclo per ~4,5 minuti.
import { createHash, randomInt } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { GoogleAuth } from 'google-auth-library';

const SK = process.env.STRIPE_SECRET_KEY;
const pid = process.env.PROJECT_ID;
const LOOP_S = Number(process.env.LOOP_S ?? 270);
const cfgFile = JSON.parse(readFileSync(process.env.CFG_JSON, 'utf8'));
const TIERS = [
  { tier: 'base', name: 'ParkingCT — Fondatore', price: cfgFile.priceBase ?? 3.9, gifts: 0, field: 'linkBase' },
  { tier: 'oro', name: 'ParkingCT — Fondatore Oro', price: cfgFile.priceGold ?? 9.9, gifts: cfgFile.giftsGold ?? 3, field: 'linkGold' },
  { tier: 'platino', name: 'ParkingCT — Fondatore Platino', price: cfgFile.pricePlat ?? 19.9, gifts: cfgFile.giftsPlat ?? 7, field: 'linkPlat' },
  // offerta libera: l'importo lo sceglie chi paga, minimo testerMin (1 €)
  { tier: 'tester', name: 'ParkingCT — Tester (offerta libera)', price: cfgFile.testerMin ?? 1, gifts: 0, field: 'linkTester', custom: true },
];

const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
let gtoken = (await (await auth.getClient()).getAccessToken()).token;
const fsBase = `https://firestore.googleapis.com/v1/projects/${pid}/databases/(default)/documents`;
async function fs(method, path, body) {
  const r = await fetch(`${fsBase}/${path}`, { method, headers: { Authorization: `Bearer ${gtoken}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* */ }
  return { ok: r.ok, status: r.status, json, text };
}

function form(obj, prefix = '', out = []) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v !== null && typeof v === 'object') form(v, key, out);
    else if (v !== undefined) out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
  }
  return out.join('&');
}
async function stripe(method, path, params) {
  const url = `https://api.stripe.com/v1/${path}${method === 'GET' && params ? `?${form(params)}` : ''}`;
  const r = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${SK}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: method === 'GET' ? undefined : form(params ?? {}),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`Stripe ${path}: ${j.error?.message ?? r.status}`);
  return j;
}

// ---- 1) catalogo e link -------------------------------------------------------------
const products = (await stripe('GET', 'products', { limit: 100 })).data;
const links = (await stripe('GET', 'payment_links', { limit: 100 })).data;
const linkTier = new Map(); // id link → livello (anche link vecchi disattivati)
for (const l of links) if (l.metadata?.parkingct_tier) linkTier.set(l.id, l.metadata.parkingct_tier);
const cfgFields = {};
for (const t of TIERS) {
  const cents = Math.round(t.price * 100);
  let prod = products.find((p) => p.metadata?.parkingct_tier === t.tier && p.active);
  if (!prod) prod = await stripe('POST', 'products', { name: t.name, metadata: { parkingct_tier: t.tier } });
  const prices = (await stripe('GET', 'prices', { product: prod.id, active: true, limit: 100 })).data;
  let price = t.custom
    ? prices.find((p) => p.custom_unit_amount?.minimum === cents && p.currency === 'eur')
    : prices.find((p) => p.unit_amount === cents && p.currency === 'eur');
  if (!price) {
    price = await stripe(
      'POST',
      'prices',
      t.custom
        ? { product: prod.id, currency: 'eur', custom_unit_amount: { enabled: true, minimum: cents } }
        : { product: prod.id, unit_amount: cents, currency: 'eur' },
    );
    for (const p of prices) await stripe('POST', `prices/${p.id}`, { active: false });
  }
  let link = links.find((l) => l.active && l.metadata?.parkingct_tier === t.tier && l.metadata?.price === price.id);
  if (!link) {
    link = await stripe('POST', 'payment_links', {
      line_items: { 0: { price: price.id, quantity: 1 } },
      metadata: { parkingct_tier: t.tier, price: price.id },
      after_completion: {
        type: 'hosted_confirmation',
        hosted_confirmation: { custom_message: 'Grazie! Torna nell\'app ParkingCT: il tuo codice personale arriva lì entro pochi minuti.' },
      },
    });
    linkTier.set(link.id, t.tier);
    for (const l of links) if (l.active && l.metadata?.parkingct_tier === t.tier && l.id !== link.id) await stripe('POST', `payment_links/${l.id}`, { active: false });
  }
  cfgFields[t.field] = { stringValue: link.url };
}
const mask = Object.keys(cfgFields).map((k) => `updateMask.fieldPaths=${k}`).join('&');
const w = await fs('PATCH', `config/public?${mask}`, { fields: cfgFields });
if (!w.ok) throw new Error(`config/public: ${w.status} ${w.text.slice(0, 200)}`);
console.log(`::notice title=Stripe::link pronti (${Object.values(cfgFields).map((x) => x.stringValue).join(' · ')})`);

// ---- 2) pagamenti → codici -------------------------------------------------------------
const ALPH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () => Array.from({ length: 12 }, () => ALPH[randomInt(ALPH.length)]).join('');
const sha = (s) => createHash('sha256').update(s).digest('hex');
const keyDoc = await fs('GET', 'admin/key');
const vault = keyDoc.ok ? keyDoc.json.fields?.v?.stringValue : null;

async function createCode(code, tier, gifts) {
  const r = await fs('PATCH', `codes/${sha(code)}?currentDocument.exists=false`, {
    fields: {
      usedBy: { nullValue: null },
      usedAt: { nullValue: null },
      tier: { stringValue: tier },
      gifts: { arrayValue: { values: gifts.map((g) => ({ stringValue: g })) } },
      createdAt: { doubleValue: Date.now() },
    },
  });
  if (!r.ok) throw new Error(`codice: ${r.status} ${r.text.slice(0, 200)}`);
}

let handled = 0;
async function processPayments() {
  const since = Math.floor(Date.now() / 1000) - 7 * 86400;
  const sessions = (await stripe('GET', 'checkout/sessions', { limit: 100, status: 'complete', created: { gte: since } })).data;
  for (const s of sessions) {
    if (s.payment_status !== 'paid' || !s.payment_link) continue;
    const tierName = linkTier.get(s.payment_link);
    const t = TIERS.find((x) => x.tier === tierName);
    if (!t) continue;
    const done = await fs('GET', `purchases/${s.id}`);
    if (done.ok) continue;
    const gifts = Array.from({ length: t.gifts }, newCode);
    for (const g of gifts) await createCode(g, 'regalo', []);
    const code = newCode();
    await createCode(code, t.tier, gifts);
    const email = s.customer_details?.email ?? '';
    const amount = (s.amount_total ?? 0) / 100;
    const ref = typeof s.client_reference_id === 'string' && /^[a-f0-9]{32}$/.test(s.client_reference_id) ? s.client_reference_id : '';
    const arr = (xs) => ({ arrayValue: { values: xs.map((x) => ({ stringValue: x })) } });
    await fs('PATCH', `purchases/${s.id}`, {
      fields: { code: { stringValue: code }, tier: { stringValue: t.tier }, gifts: arr(gifts), email: { stringValue: email }, amount: { doubleValue: amount }, ref: { stringValue: ref }, t: { doubleValue: Date.now() }, live: { booleanValue: !!s.livemode } },
    });
    if (ref) await fs('PATCH', `pickup/${ref}`, { fields: { code: { stringValue: code }, tier: { stringValue: t.tier }, gifts: arr(gifts), t: { doubleValue: Date.now() } } });
    if (vault) {
      await fs('PATCH', `vault/${vault}/codes/${sha(code)}`, {
        fields: {
          code: { stringValue: code },
          tier: { stringValue: t.tier },
          note: { stringValue: `Stripe${s.livemode ? '' : ' (TEST)'} · ${email || 'senza email'}` },
          amount: { doubleValue: amount },
          createdAt: { doubleValue: Date.now() },
          gifts: arr(gifts),
        },
      });
    }
    handled++;
    console.log(`::notice title=Pagamento::${t.tier} ${amount} € ${s.livemode ? '' : '(test) '}→ codice consegnato${ref ? ' all\'app' : ' (senza ref: solo control center)'}`);
  }
}

const end = Date.now() + LOOP_S * 1000;
let rounds = 0;
do {
  await processPayments();
  rounds++;
  if (Date.now() + 20_000 < end) await new Promise((r) => setTimeout(r, 20_000));
  if (rounds % 10 === 0) gtoken = (await (await auth.getClient()).getAccessToken()).token;
} while (Date.now() < end);
console.log(`::notice title=Stripe::${rounds} controlli, ${handled} pagamenti gestiti`);

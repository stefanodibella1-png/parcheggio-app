// ParkingCT — control center segreto (solo il proprietario).
// Accesso: 7 tocchi sul logo + password admin (cambiabile dall'interno).
// Come funziona la protezione (vedi firestore.rules):
//   s = impronta SHA-256 della password; gate/{s} contiene v, l'id della cassaforte;
//   i dati riservati stanno in vault/{v}; i numeri li calcola ogni 15 minuti il server
//   (GitHub Actions, tools/ci/stats.mjs) e li scrive in vault/{v}/stats/latest.
// Le scritture pubbliche (codici, pubblicità) vanno insieme a vault/{v}/tokens/w con l'ora del server.
import { FIREBASE_CONFIG } from '../community/firebaseConfig.ts';
import { kvGet, kvSet } from '../storage/db.ts';
import { adFromDoc, base, call, key, num, str, strList, type Ad, type FsVal, type Tier } from './server.ts';
import { normalizeCode, sha256Hex } from './sha256.ts';

function secretOf(password: string): string {
  return sha256Hex(`parkingct-admin:${password}`);
}

let vault: string | null = null;

function docName(path: string): string {
  return `projects/${FIREBASE_CONFIG!.projectId}/databases/(default)/documents/${path}`;
}

type Write = { update?: { name: string; fields: Record<string, FsVal> }; delete?: string; currentDocument?: { exists: boolean }; updateTransforms?: object[] };

async function commit(writes: Write[]): Promise<boolean> {
  const b = base();
  if (!b) return false;
  const r = await call(`${b}:commit?${key()}`, { method: 'POST', body: JSON.stringify({ writes }) }, 20_000);
  return !!r?.ok;
}

/** il "lasciapassare" che rende valide le scritture pubbliche dell'admin nello stesso invio */
function token(): Write {
  return {
    update: { name: docName(`vault/${vault}/tokens/w`), fields: {} },
    updateTransforms: [{ fieldPath: 't', setToServerValue: 'REQUEST_TIME' }],
  };
}

export type LoginResult = { ok: true } | { ok: false; msg: string };

/** Entra con la password. Se non è mai stata scelta, la prima password inserita diventa quella admin. */
export async function login(password: string): Promise<LoginResult> {
  const b = base();
  if (!b) return { ok: false, msg: 'Server non configurato.' };
  if (password.length < 6) return { ok: false, msg: 'Password troppo corta.' };
  const s = secretOf(password);
  const r = await call(`${b}/gate/${s}?${key()}`);
  if (!r) return { ok: false, msg: 'Connessione assente.' };
  if (r.ok) {
    const v = str(((await r.json()) as { fields: Record<string, FsVal> }).fields?.v);
    if (!v) return { ok: false, msg: 'Password sbagliata.' };
    vault = v;
    await kvSet('pc:vault', v).catch(() => {});
    return { ok: true };
  }
  // password sbagliata, oppure password admin non ancora scelta: si prova a crearla
  const v = sha256Hex(`${Math.random()}-${Date.now()}-${Math.random()}`).slice(0, 32);
  const created = await commit([
    { update: { name: docName('admin/key'), fields: { s: { stringValue: s }, v: { stringValue: v }, prev: { stringValue: '' } } }, currentDocument: { exists: false } },
    { update: { name: docName(`gate/${s}`), fields: { v: { stringValue: v } } }, currentDocument: { exists: false } },
  ]);
  if (!created) return { ok: false, msg: 'Password sbagliata.' };
  vault = v;
  await kvSet('pc:vault', v).catch(() => {});
  return { ok: true };
}

export async function resume(): Promise<boolean> {
  if (vault) return true;
  const v = await kvGet('pc:vault').catch(() => null);
  if (!v) return false;
  // la cassaforte esiste ancora? (se la password è cambiata da un altro telefono resta valida)
  const b = base();
  if (!b) return false;
  const r = await call(`${b}/vault/${v}/stats/latest?${key()}`);
  if (r && (r.ok || r.status === 404)) {
    vault = v;
    return true;
  }
  return false;
}

export async function logout(): Promise<void> {
  vault = null;
  await kvSet('pc:vault', '').catch(() => {});
}

export async function changePassword(oldPwd: string, newPwd: string): Promise<string> {
  if (!vault) return 'Accedi di nuovo.';
  if (newPwd.length < 6) return 'La nuova password deve avere almeno 6 caratteri.';
  const oldS = secretOf(oldPwd);
  const newS = secretOf(newPwd);
  const ok = await commit([
    { update: { name: docName('admin/key'), fields: { s: { stringValue: newS }, v: { stringValue: vault }, prev: { stringValue: oldS } } }, currentDocument: { exists: true } },
    { update: { name: docName(`gate/${newS}`), fields: { v: { stringValue: vault } } }, currentDocument: { exists: false } },
  ]);
  return ok ? 'Password cambiata.' : 'Non riuscito: la password attuale è sbagliata (o la nuova è già stata usata).';
}

// ---------------------------------------------------------------------------------------
// numeri (calcolati dal server ogni 15 minuti)

export interface Stats {
  at: number;
  devices: number;
  active24h: number;
  active7d: number;
  newToday: number;
  new7d: number;
  founders: number;
  byTier: Record<string, number>;
  zones: { zone: string; n: number; lat: number; lon: number }[];
  versions: Record<string, number>;
  codesUsed: number;
  codesGenerated: number;
  parkings: number;
  parkings7d: number;
  invites: { code: string; n: number }[];
  invitedTotal: number;
  ads: Record<string, { views: number; clicks: number }>;
  codesUsedSet: string[];
}

export async function loadStats(): Promise<Stats | null> {
  const b = base();
  if (!b || !vault) return null;
  const r = await call(`${b}/vault/${vault}/stats/latest?${key()}`);
  if (!r?.ok) return null;
  const f = ((await r.json()) as { fields: Record<string, FsVal> }).fields;
  try {
    return JSON.parse(str(f.json) ?? '') as Stats;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------
// codici sostenitori

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomCode(): string {
  let s = '';
  for (let i = 0; i < 12; i++) s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return s;
}

export function pretty(code: string): string {
  const c = normalizeCode(code);
  return `${c.slice(0, 4)}-${c.slice(4, 8)}-${c.slice(8)}`;
}

export interface AdminCode {
  hash: string;
  code: string;
  tier: Tier;
  note: string;
  amount: number;
  createdAt: number;
  gifts: string[];
}

function codeWrite(code: string, tier: Tier, gifts: string[]): Write {
  return {
    update: {
      name: docName(`codes/${sha256Hex(code)}`),
      fields: {
        usedBy: { nullValue: null },
        usedAt: { nullValue: null },
        tier: { stringValue: tier },
        gifts: { arrayValue: { values: gifts.map((g) => ({ stringValue: g })) } },
        createdAt: { doubleValue: Date.now() },
      },
    },
    currentDocument: { exists: false },
  };
}

/** Genera un codice per un sostenitore (con i codici regalo per Oro e Platino). */
export async function generateCode(tier: Tier, gifts: number, note: string, amount: number): Promise<AdminCode | null> {
  if (!vault) return null;
  const giftCodes = Array.from({ length: gifts }, randomCode);
  const code = randomCode();
  const h = sha256Hex(code);
  const createdAt = Date.now();
  const ok = await commit([
    token(),
    ...giftCodes.map((g) => codeWrite(g, 'regalo', [])),
    codeWrite(code, tier, giftCodes),
    {
      update: {
        name: docName(`vault/${vault}/codes/${h}`),
        fields: {
          code: { stringValue: code },
          tier: { stringValue: tier },
          note: { stringValue: note },
          amount: { doubleValue: amount },
          createdAt: { doubleValue: createdAt },
          gifts: { arrayValue: { values: giftCodes.map((g) => ({ stringValue: g })) } },
        },
      },
    },
  ]);
  return ok ? { hash: h, code, tier, note, amount, createdAt, gifts: giftCodes } : null;
}

export async function listCodes(): Promise<AdminCode[]> {
  const b = base();
  if (!b || !vault) return [];
  const r = await call(`${b}/vault/${vault}/codes?pageSize=300&${key()}`);
  if (!r?.ok) return [];
  const j = (await r.json()) as { documents?: { name: string; fields: Record<string, FsVal> }[] };
  return (j.documents ?? [])
    .map((d) => ({
      hash: d.name.split('/').pop() ?? '',
      code: str(d.fields.code) ?? '',
      tier: (str(d.fields.tier) as Tier | null) ?? 'base',
      note: str(d.fields.note) ?? '',
      amount: num(d.fields.amount) ?? 0,
      createdAt: num(d.fields.createdAt) ?? 0,
      gifts: strList(d.fields.gifts),
    }))
    .sort((a, b2) => b2.createdAt - a.createdAt);
}

// ---------------------------------------------------------------------------------------
// pubblicità

export async function listAds(): Promise<Ad[]> {
  const b = base();
  if (!b) return [];
  const r = await call(`${b}/ads?pageSize=300&${key()}`);
  if (!r?.ok) return [];
  const j = (await r.json()) as { documents?: { name: string; fields: Record<string, FsVal> }[] };
  return (j.documents ?? []).map((d) => adFromDoc(d.name, d.fields ?? {}));
}

export async function saveAd(a: Ad): Promise<boolean> {
  if (!vault) return false;
  const id = a.id || `ad${Date.now().toString(36)}`;
  return commit([
    token(),
    {
      update: {
        name: docName(`ads/${id}`),
        fields: {
          sponsor: { stringValue: a.sponsor },
          title: { stringValue: a.title },
          text: { stringValue: a.text },
          cta: { stringValue: a.cta },
          url: { stringValue: a.url },
          image: { stringValue: a.image },
          zone: { stringValue: a.zone },
          active: { booleanValue: a.active },
          until: { doubleValue: a.until },
          weight: { doubleValue: a.weight },
        },
      },
    },
  ]);
}

export async function deleteAd(id: string): Promise<boolean> {
  if (!vault) return false;
  return commit([token(), { delete: docName(`ads/${id}`) }]);
}

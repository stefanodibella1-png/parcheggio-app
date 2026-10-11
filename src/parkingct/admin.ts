// ParkingCT — control center segreto (solo il proprietario).
// Accesso con Firebase Authentication (email + password, email verificata);
// le regole del server (firestore.rules, isAdmin) permettono di leggere i numeri
// e di scrivere codici e pubblicità solo a quell'account.
import { FIREBASE_CONFIG } from '../community/firebaseConfig.ts';
import { kvGet, kvSet } from '../storage/db.ts';
import { adFromDoc, base, call, key, num, str, strList, type Ad, type FsVal, type Tier } from './server.ts';
import { normalizeCode, sha256Hex } from './sha256.ts';

/** impronta SHA-256 dell'email del proprietario (la stessa di firestore.rules) */
const OWNER_HASH = 'de88b4d414e4020545351bf4badea9b14f78bb6baeddd03e408ec6341c05af07';

export function isOwnerEmail(email: string): boolean {
  return sha256Hex(email.trim().toLowerCase()) === OWNER_HASH;
}

interface Session {
  email: string;
  idToken: string;
  refreshToken: string;
  exp: number;
}

let session: Session | null = null;

const IDT = 'https://identitytoolkit.googleapis.com/v1';

async function authPost(path: string, body: object): Promise<{ ok: boolean; json: Record<string, unknown> }> {
  if (!FIREBASE_CONFIG) return { ok: false, json: { error: { message: 'NO_CONFIG' } } };
  const r = await call(`${IDT}/${path}?key=${encodeURIComponent(FIREBASE_CONFIG.apiKey)}`, { method: 'POST', body: JSON.stringify(body) });
  if (!r) return { ok: false, json: { error: { message: 'OFFLINE' } } };
  return { ok: r.ok, json: (await r.json().catch(() => ({}))) as Record<string, unknown> };
}

function errMsg(j: Record<string, unknown>): string {
  const m = ((j.error as { message?: string } | undefined)?.message ?? 'ERRORE').split(' ')[0];
  const map: Record<string, string> = {
    OFFLINE: 'Connessione assente.',
    EMAIL_NOT_FOUND: 'Account non ancora creato: usa «Primo accesso».',
    INVALID_PASSWORD: 'Password sbagliata.',
    INVALID_LOGIN_CREDENTIALS: 'Email o password sbagliata (se è il primo accesso usa «Primo accesso»).',
    EMAIL_EXISTS: "L'account esiste già: accedi con la password.",
    WEAK_PASSWORD: 'Password troppo corta (almeno 8 caratteri).',
    OPERATION_NOT_ALLOWED: 'Accesso con email non ancora attivo sul server: riprova tra qualche minuto.',
    CONFIGURATION_NOT_FOUND: 'Accesso con email non ancora attivo sul server: riprova tra qualche minuto.',
    TOO_MANY_ATTEMPTS_TRY_LATER: 'Troppi tentativi: riprova più tardi.',
  };
  return map[m] ?? `Errore: ${m}`;
}

async function saveSession(email: string, j: Record<string, unknown>): Promise<void> {
  session = {
    email,
    idToken: String(j.idToken ?? j.id_token),
    refreshToken: String(j.refreshToken ?? j.refresh_token),
    exp: Date.now() + (Number(j.expiresIn ?? j.expires_in ?? 3600) - 120) * 1000,
  };
  await kvSet('pc:admin', JSON.stringify({ email, refreshToken: session.refreshToken })).catch(() => {});
}

async function emailVerified(idToken: string): Promise<boolean> {
  const r = await authPost('accounts:lookup', { idToken });
  const u = (r.json.users as { emailVerified?: boolean }[] | undefined)?.[0];
  return !!u?.emailVerified;
}

export type LoginResult = { ok: true } | { ok: false; msg: string; needsVerify?: boolean };

export async function login(email: string, password: string): Promise<LoginResult> {
  const e = email.trim().toLowerCase();
  if (!isOwnerEmail(e)) return { ok: false, msg: 'Accesso non autorizzato.' };
  const r = await authPost('accounts:signInWithPassword', { email: e, password, returnSecureToken: true });
  if (!r.ok) return { ok: false, msg: errMsg(r.json) };
  await saveSession(e, r.json);
  if (!(await emailVerified(session!.idToken))) {
    await authPost('accounts:sendOobCode', { requestType: 'VERIFY_EMAIL', idToken: session!.idToken });
    return { ok: false, needsVerify: true, msg: "Ti ho mandato un'email: apri il link per confermare, poi accedi di nuovo." };
  }
  return { ok: true };
}

/** Primo accesso: crea l'account del proprietario e invia l'email di conferma. */
export async function firstAccess(email: string, password: string): Promise<LoginResult> {
  const e = email.trim().toLowerCase();
  if (!isOwnerEmail(e)) return { ok: false, msg: 'Accesso non autorizzato.' };
  const r = await authPost('accounts:signUp', { email: e, password, returnSecureToken: true });
  if (!r.ok) return { ok: false, msg: errMsg(r.json) };
  await saveSession(e, r.json);
  await authPost('accounts:sendOobCode', { requestType: 'VERIFY_EMAIL', idToken: session!.idToken });
  return { ok: false, needsVerify: true, msg: "Account creato. Ti ho mandato un'email: apri il link per confermare, poi accedi." };
}

export async function resetPassword(email: string): Promise<string> {
  const e = email.trim().toLowerCase();
  if (!isOwnerEmail(e)) return 'Accesso non autorizzato.';
  const r = await authPost('accounts:sendOobCode', { requestType: 'PASSWORD_RESET', email: e });
  return r.ok ? "Ti ho mandato un'email per scegliere una nuova password." : errMsg(r.json);
}

/** Riprende l'accesso salvato (senza ridigitare la password). */
export async function resume(): Promise<boolean> {
  if (session && session.exp > Date.now()) return true;
  const saved = await kvGet('pc:admin').catch(() => null);
  if (!saved || !FIREBASE_CONFIG) return false;
  const { email, refreshToken } = JSON.parse(saved) as { email: string; refreshToken: string };
  const r = await call(`https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(FIREBASE_CONFIG.apiKey)}`, {
    method: 'POST',
    body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: refreshToken }),
  });
  if (!r?.ok) return false;
  await saveSession(email, (await r.json()) as Record<string, unknown>);
  return emailVerified(session!.idToken);
}

export async function logout(): Promise<void> {
  session = null;
  await kvSet('pc:admin', '').catch(() => {});
}

async function auth(): Promise<Record<string, string>> {
  if (!session || session.exp <= Date.now()) await resume();
  return session ? { Authorization: `Bearer ${session.idToken}` } : {};
}

async function adminCall(url: string, init: RequestInit = {}): Promise<Response | null> {
  return call(url, { ...init, headers: { ...(await auth()), ...((init.headers as Record<string, string>) ?? {}) } }, 20_000);
}

// ---------------------------------------------------------------------------------------
// numeri

type Filter = { field: string; op: 'EQUAL' | 'GREATER_THAN' | 'GREATER_THAN_OR_EQUAL'; value: FsVal };

function where(filters: Filter[]): object | undefined {
  const f = filters.map((x) => ({ fieldFilter: { field: { fieldPath: x.field }, op: x.op, value: x.value } }));
  if (f.length === 0) return undefined;
  if (f.length === 1) return f[0];
  return { compositeFilter: { op: 'AND', filters: f } };
}

export async function count(collection: string, filters: Filter[] = []): Promise<number | null> {
  const b = base();
  if (!b) return null;
  const r = await adminCall(`${b}:runAggregationQuery?${key()}`, {
    method: 'POST',
    body: JSON.stringify({
      structuredAggregationQuery: { structuredQuery: { from: [{ collectionId: collection }], where: where(filters) }, aggregations: [{ alias: 'n', count: {} }] },
    }),
  });
  if (!r?.ok) return null;
  const j = (await r.json()) as { result?: { aggregateFields?: { n?: FsVal } } }[];
  return num(j?.[0]?.result?.aggregateFields?.n) ?? 0;
}

async function listAll(collection: string, max = 5000): Promise<{ name: string; fields: Record<string, FsVal> }[]> {
  const b = base();
  if (!b) return [];
  const out: { name: string; fields: Record<string, FsVal> }[] = [];
  let token = '';
  while (out.length < max) {
    const r = await adminCall(`${b}/${collection}?pageSize=300${token ? `&pageToken=${encodeURIComponent(token)}` : ''}&${key()}`);
    if (!r?.ok) break;
    const j = (await r.json()) as { documents?: { name: string; fields: Record<string, FsVal> }[]; nextPageToken?: string };
    out.push(...(j.documents ?? []).map((d) => ({ name: d.name, fields: d.fields ?? {} })));
    if (!j.nextPageToken) break;
    token = j.nextPageToken;
  }
  return out;
}

export interface Stats {
  devices: number;
  active24h: number;
  active7d: number;
  newToday: number;
  new7d: number;
  founders: number;
  byTier: Record<string, number>;
  zones: { zone: string; n: number; lat: number; lon: number }[];
  versions: Record<string, number>;
  codesUsed: number | null;
  codesGenerated: number | null;
  parkings: number | null;
  parkings7d: number | null;
  invites: { code: string; n: number }[];
  invitedTotal: number;
  ok: boolean;
}

const B32 = '0123456789bcdefghjkmnpqrstuvwxyz';

export function geohashCenter(h: string): { lat: number; lon: number } {
  let latMin = -90;
  let latMax = 90;
  let lonMin = -180;
  let lonMax = 180;
  let even = true;
  for (const ch of h) {
    const v = B32.indexOf(ch);
    for (let i = 4; i >= 0; i--) {
      const bit = (v >> i) & 1;
      if (even) {
        const mid = (lonMin + lonMax) / 2;
        if (bit) lonMin = mid;
        else lonMax = mid;
      } else {
        const mid = (latMin + latMax) / 2;
        if (bit) latMin = mid;
        else latMax = mid;
      }
      even = !even;
    }
  }
  return { lat: (latMin + latMax) / 2, lon: (lonMin + lonMax) / 2 };
}

export async function loadStats(): Promise<Stats> {
  const now = Date.now();
  const startToday = new Date();
  startToday.setHours(0, 0, 0, 0);
  const [devs, codesUsed, codesGenerated, parkings, parkings7d, inv] = await Promise.all([
    listAll('devices'),
    count('codes', [{ field: 'usedAt', op: 'GREATER_THAN', value: { doubleValue: 0 } }]),
    count('adminCodes'),
    count('parkings'),
    count('parkings', [{ field: 'parkedT', op: 'GREATER_THAN_OR_EQUAL', value: { doubleValue: now - 7 * 86_400_000 } }]),
    listAll('invites', 2000),
  ]);
  const zones = new Map<string, number>();
  const byTier: Record<string, number> = {};
  const versions: Record<string, number> = {};
  let active24h = 0;
  let active7d = 0;
  let newToday = 0;
  let new7d = 0;
  let founders = 0;
  for (const d of devs) {
    const t = num(d.fields.t) ?? 0;
    const first = num(d.fields.first) ?? t;
    if (now - t < 86_400_000) active24h++;
    if (now - t < 7 * 86_400_000) active7d++;
    if (first >= startToday.getTime()) newToday++;
    if (now - first < 7 * 86_400_000) new7d++;
    if (d.fields.founder?.booleanValue) {
      founders++;
      const tier = str(d.fields.tier) ?? 'base';
      byTier[tier] = (byTier[tier] ?? 0) + 1;
    }
    const z = str(d.fields.zone) ?? '?';
    zones.set(z, (zones.get(z) ?? 0) + 1);
    const v = str(d.fields.v) ?? 'vecchia';
    versions[v] = (versions[v] ?? 0) + 1;
  }
  const invites = inv
    .map((d) => ({ code: d.name.split('/').pop() ?? '', n: num(d.fields.n) ?? 0 }))
    .sort((a, b) => b.n - a.n);
  return {
    ok: devs.length > 0 || codesGenerated !== null,
    devices: devs.length,
    active24h,
    active7d,
    newToday,
    new7d,
    founders,
    byTier,
    zones: [...zones.entries()]
      .map(([zone, n]) => ({ zone, n, ...geohashCenter(zone) }))
      .sort((a, b) => b.n - a.n),
    versions,
    codesUsed,
    codesGenerated,
    parkings,
    parkings7d,
    invites: invites.slice(0, 20),
    invitedTotal: invites.reduce((s, x) => s + x.n, 0),
  };
}

// ---------------------------------------------------------------------------------------
// codici sostenitori generati dal control center

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
  used: boolean;
}

async function createCodeDoc(code: string, tier: Tier, gifts: string[]): Promise<boolean> {
  const b = base();
  if (!b) return false;
  const h = sha256Hex(code);
  const r = await adminCall(`${b}/codes/${h}?currentDocument.exists=false&${key()}`, {
    method: 'PATCH',
    body: JSON.stringify({
      fields: {
        usedBy: { nullValue: null },
        usedAt: { nullValue: null },
        tier: { stringValue: tier },
        gifts: { arrayValue: { values: gifts.map((g) => ({ stringValue: g })) } },
        createdAt: { doubleValue: Date.now() },
      },
    }),
  });
  return !!r?.ok;
}

/** Genera un codice per un sostenitore (con i codici regalo per Oro e Platino). */
export async function generateCode(tier: Tier, gifts: number, note: string, amount: number): Promise<AdminCode | null> {
  const b = base();
  if (!b) return null;
  const giftCodes: string[] = [];
  for (let i = 0; i < gifts; i++) {
    const g = randomCode();
    if (!(await createCodeDoc(g, 'regalo', []))) return null;
    giftCodes.push(g);
  }
  const code = randomCode();
  if (!(await createCodeDoc(code, tier, giftCodes))) return null;
  const h = sha256Hex(code);
  const createdAt = Date.now();
  const r = await adminCall(`${b}/adminCodes/${h}?${key()}`, {
    method: 'PATCH',
    body: JSON.stringify({
      fields: {
        code: { stringValue: code },
        tier: { stringValue: tier },
        note: { stringValue: note },
        amount: { doubleValue: amount },
        createdAt: { doubleValue: createdAt },
        gifts: { arrayValue: { values: giftCodes.map((g) => ({ stringValue: g })) } },
      },
    }),
  });
  if (!r?.ok) return null;
  return { hash: h, code, tier, note, amount, createdAt, gifts: giftCodes, used: false };
}

export async function listCodes(): Promise<AdminCode[]> {
  const b = base();
  if (!b) return [];
  const docs = await listAll('adminCodes', 2000);
  const out: AdminCode[] = docs.map((d) => ({
    hash: d.name.split('/').pop() ?? '',
    code: str(d.fields.code) ?? '',
    tier: (str(d.fields.tier) as Tier | null) ?? 'base',
    note: str(d.fields.note) ?? '',
    amount: num(d.fields.amount) ?? 0,
    createdAt: num(d.fields.createdAt) ?? 0,
    gifts: strList(d.fields.gifts),
    used: false,
  }));
  await Promise.all(
    out.map(async (c) => {
      const r = await adminCall(`${b}/codes/${c.hash}?${key()}`);
      if (r?.ok) c.used = !!str(((await r.json()) as { fields: Record<string, FsVal> }).fields.usedBy);
    }),
  );
  return out.sort((a, b2) => b2.createdAt - a.createdAt);
}

// ---------------------------------------------------------------------------------------
// pubblicità

export interface AdStats {
  views: number | null;
  clicks: number | null;
}

export async function listAds(): Promise<(Ad & AdStats)[]> {
  const docs = await listAll('ads', 500);
  const ads = docs.map((d) => adFromDoc(d.name, d.fields));
  return Promise.all(
    ads.map(async (a) => ({
      ...a,
      views: await count('adEvents', [
        { field: 'adId', op: 'EQUAL', value: { stringValue: a.id } },
        { field: 'kind', op: 'EQUAL', value: { stringValue: 'view' } },
      ]),
      clicks: await count('adEvents', [
        { field: 'adId', op: 'EQUAL', value: { stringValue: a.id } },
        { field: 'kind', op: 'EQUAL', value: { stringValue: 'click' } },
      ]),
    })),
  );
}

export async function saveAd(a: Ad): Promise<boolean> {
  const b = base();
  if (!b) return false;
  const id = a.id || `ad${Date.now().toString(36)}`;
  const r = await adminCall(`${b}/ads/${id}?${key()}`, {
    method: 'PATCH',
    body: JSON.stringify({
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
    }),
  });
  return !!r?.ok;
}

export async function deleteAd(id: string): Promise<boolean> {
  const b = base();
  if (!b) return false;
  const r = await adminCall(`${b}/ads/${id}?${key()}`, { method: 'DELETE' });
  return !!r?.ok;
}

// ParkingCT: dati sul server (Firestore via REST, nessun account utente).
// Inviati: zona (cella di ~5 km), parcheggi anonimi, uso del codice sostenitore,
// inviti (solo un contatore), visualizzazioni anonime delle pubblicità.
// Mai nome, numero di telefono o posizione in tempo reale.
// I numeri complessivi (quanti telefoni, quante zone) li vede solo il control center.
import { FIREBASE_CONFIG } from '../community/firebaseConfig.ts';
import { encode } from '../community/geohash.ts';
import type { ParkingSession } from '../../engine/types.ts';
import { kvGet, kvSet } from '../storage/db.ts';
import { checkName } from './moderation.ts';
import { normalizeCode, sha256Hex } from './sha256.ts';

export interface PublicConfig {
  launchAt: number;
  supportUrl: string;
  zoneTarget: number;
  zoneName: string;
  priceBase: number;
  priceGold: number;
  pricePlat: number;
  giftsGold: number;
  giftsPlat: number;
  /** amici invitati per avere ParkingCT gratis per sempre (0 = disattivato) */
  inviteFreeAt: number;
  landingUrl: string;
  /** link di pagamento Stripe per livello ('' = pagamenti non ancora attivi) */
  linkBase: string;
  linkGold: string;
  linkPlat: string;
  linkTester: string;
  /** pagamento per continuare dopo la fine del periodo Tester (dopo il lancio) */
  linkContinue: string;
  continuePrice: number;
  /** Tester: giorni di uso completo dall'attivazione, e offerta minima in € */
  testerDays: number;
  testerMin: number;
}

export const APK_URL = 'https://github.com/stefanodibella1-png/parcheggio-app/releases/latest/download/ParkingCT.apk';

const DEFAULT_CONFIG: PublicConfig = {
  launchAt: Date.parse('2026-12-01T10:00:00+01:00'),
  supportUrl: '',
  zoneTarget: 1000,
  zoneName: '',
  priceBase: 3.9,
  priceGold: 9.9,
  pricePlat: 19.9,
  giftsGold: 3,
  giftsPlat: 6,
  inviteFreeAt: 10,
  landingUrl: '',
  linkBase: '',
  linkGold: '',
  linkPlat: '',
  linkTester: '',
  linkContinue: '',
  continuePrice: 3.9,
  testerDays: 90,
  testerMin: 1,
};

export function base(): string | null {
  return FIREBASE_CONFIG ? `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents` : null;
}
export function key(): string {
  return FIREBASE_CONFIG ? `key=${encodeURIComponent(FIREBASE_CONFIG.apiKey)}` : '';
}

export async function call(url: string, init: RequestInit = {}, timeoutMs = 10_000): Promise<Response | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal, headers: { 'Content-Type': 'application/json', ...((init.headers as Record<string, string>) ?? {}) } });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export type FsVal = {
  stringValue?: string;
  doubleValue?: number;
  integerValue?: string;
  booleanValue?: boolean;
  nullValue?: null;
  arrayValue?: { values?: FsVal[] };
  timestampValue?: string;
};
export const num = (v: FsVal | undefined): number | null => (v?.doubleValue ?? (v?.integerValue ? Number(v.integerValue) : null)) ?? null;
export const str = (v: FsVal | undefined): string | null => v?.stringValue ?? null;
export const strList = (v: FsVal | undefined): string[] => (v?.arrayValue?.values ?? []).map((x) => x.stringValue ?? '').filter(Boolean);

/** Configurazione del lancio (data, link per sostenere, livelli). Usa l'ultima salvata se offline. */
export async function getConfig(): Promise<PublicConfig> {
  const b = base();
  if (b) {
    const r = await call(`${b}/config/public?${key()}`);
    if (r?.ok) {
      const f = ((await r.json()) as { fields: Record<string, FsVal> }).fields;
      const cfg: PublicConfig = {
        launchAt: num(f.launchAt) ?? DEFAULT_CONFIG.launchAt,
        supportUrl: str(f.supportUrl) ?? '',
        zoneTarget: num(f.zoneTarget) ?? DEFAULT_CONFIG.zoneTarget,
        zoneName: str(f.zoneName) ?? '',
        priceBase: num(f.priceBase) ?? DEFAULT_CONFIG.priceBase,
        priceGold: num(f.priceGold) ?? DEFAULT_CONFIG.priceGold,
        pricePlat: num(f.pricePlat) ?? DEFAULT_CONFIG.pricePlat,
        giftsGold: num(f.giftsGold) ?? DEFAULT_CONFIG.giftsGold,
        giftsPlat: num(f.giftsPlat) ?? DEFAULT_CONFIG.giftsPlat,
        inviteFreeAt: num(f.inviteFreeAt) ?? DEFAULT_CONFIG.inviteFreeAt,
        landingUrl: str(f.landingUrl) ?? '',
        linkBase: str(f.linkBase) ?? '',
        linkGold: str(f.linkGold) ?? '',
        linkPlat: str(f.linkPlat) ?? '',
        linkTester: str(f.linkTester) ?? '',
        linkContinue: str(f.linkContinue) ?? '',
        continuePrice: num(f.continuePrice) ?? DEFAULT_CONFIG.continuePrice,
        testerDays: num(f.testerDays) ?? DEFAULT_CONFIG.testerDays,
        testerMin: num(f.testerMin) ?? DEFAULT_CONFIG.testerMin,
      };
      await kvSet('pc:config', JSON.stringify(cfg)).catch(() => {});
      return cfg;
    }
  }
  const saved = await kvGet('pc:config').catch(() => null);
  return saved ? { ...DEFAULT_CONFIG, ...(JSON.parse(saved) as Partial<PublicConfig>) } : DEFAULT_CONFIG;
}

export async function deviceId(): Promise<string> {
  let id = await kvGet('community:deviceId').catch(() => null);
  if (!id) {
    id = `d${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
    await kvSet('community:deviceId', id).catch(() => {});
  }
  return id;
}

/** Registra il telefono nella sua zona (cella geohash di ~5 km). */
export async function registerDevice(lat: number, lon: number, founder: boolean, tier: string, version: string): Promise<string | null> {
  const b = base();
  if (!b) return null;
  const zone = encode(lat, lon, 5);
  const id = await deviceId();
  let first = Number((await kvGet('pc:first').catch(() => null)) ?? 0);
  if (!first) {
    first = Date.now();
    await kvSet('pc:first', String(first)).catch(() => {});
  }
  const r = await call(`${b}/devices/${id}?${key()}`, {
    method: 'PATCH',
    body: JSON.stringify({
      fields: {
        zone: { stringValue: zone },
        t: { doubleValue: Date.now() },
        founder: { booleanValue: founder },
        first: { doubleValue: first },
        tier: { stringValue: tier },
        v: { stringValue: version },
      },
    }),
  });
  if (r?.ok) await kvSet('pc:zone', zone).catch(() => {});
  return r?.ok ? zone : null;
}

// ---------------------------------------------------------------------------------------
// sostenitori fondatori

export type Tier = 'base' | 'oro' | 'platino' | 'regalo' | 'amici' | 'tester' | 'continua';

export const TIER_LABEL: Record<Tier, string> = {
  base: 'Sostenitore fondatore',
  oro: 'Fondatore Oro',
  platino: 'Fondatore Platino',
  regalo: 'Fondatore (regalo di un amico)',
  amici: 'Fondatore ad honorem',
  tester: 'Tester',
  continua: 'Utente ParkingCT',
};

export interface FounderInfo {
  /** prima attivazione del codice (per il Tester: inizio dei 3 mesi) */
  start?: number;
  code: string;
  t: number;
  tier: Tier;
  gifts: string[];
}

export type RedeemResult = 'ok' | 'moved' | 'invalid' | 'limit' | 'offline';

/** quante volte un codice può essere spostato su un altro telefono (cambio telefono, reinstallazione) */
export const MAX_CODE_MOVES = 5;

export function prettyCode(code: string): string {
  const c = normalizeCode(code);
  return `${c.slice(0, 4)}-${c.slice(4, 8)}-${c.slice(8)}`;
}

/** Verifica e usa un codice sostenitore. */
export async function redeemCode(input: string): Promise<RedeemResult> {
  const b = base();
  const code = normalizeCode(input);
  if (code.length !== 12) return 'invalid';
  if (!b) return 'offline';
  const h = sha256Hex(code);
  const get = await call(`${b}/codes/${h}?${key()}`);
  if (!get) return 'offline';
  if (get.status === 404) return 'invalid';
  if (!get.ok) return 'offline';
  const doc = (await get.json()) as { fields: Record<string, FsVal> };
  const id = await deviceId();
  const usedBy = str(doc.fields.usedBy);
  let result: RedeemResult = 'ok';
  if (!usedBy) {
    const up = await call(`${b}/codes/${h}?updateMask.fieldPaths=usedBy&updateMask.fieldPaths=usedAt&updateMask.fieldPaths=start&${key()}`, {
      method: 'PATCH',
      body: JSON.stringify({ fields: { usedBy: { stringValue: id }, usedAt: { doubleValue: Date.now() }, start: { doubleValue: Date.now() } } }),
    });
    if (!up) return 'offline';
    if (!up.ok) return 'invalid';
  } else if (usedBy !== id) {
    // stesso codice su un nuovo telefono (o app reinstallata): il codice si sposta qui
    const moves = num(doc.fields.moves) ?? 0;
    if (moves >= MAX_CODE_MOVES) return 'limit';
    const mask = ['usedBy', 'usedAt', 'moves'].map((k) => `updateMask.fieldPaths=${k}`).join('&');
    const up = await call(`${b}/codes/${h}?${mask}&${key()}`, {
      method: 'PATCH',
      body: JSON.stringify({ fields: { usedBy: { stringValue: id }, usedAt: { doubleValue: Date.now() }, moves: { integerValue: String(moves + 1) } } }),
    });
    if (!up) return 'offline';
    if (!up.ok) return 'limit';
    result = 'moved';
  }
  const tier = (str(doc.fields.tier) as Tier | null) ?? 'base';
  // inizio: la prima attivazione in assoluto (un cambio telefono o una reinstallazione non lo azzera)
  const start = num(doc.fields.start) ?? (usedBy ? num(doc.fields.usedAt) : null) ?? Date.now();
  const info: FounderInfo = { code: prettyCode(code), t: Date.now(), tier, gifts: strList(doc.fields.gifts).map(prettyCode), start };
  await kvSet('pc:founder', JSON.stringify(info)).catch(() => {});
  await kvSet('pc:founderCheckT', String(Date.now())).catch(() => {});
  return result;
}

/**
 * Il codice è ancora attivo su questo telefono? (una volta al giorno)
 * Se è stato attivato su un altro telefono, qui torna non attivo: un codice vale per un telefono alla volta.
 */
export async function verifyFounder(): Promise<'ok' | 'moved' | 'unknown'> {
  const f = await founderInfo();
  const b = base();
  if (!f || f.tier === 'amici' || !b) return 'unknown';
  const last = Number((await kvGet('pc:founderCheckT').catch(() => null)) ?? 0);
  if (Date.now() - last < 24 * 3600_000) return 'unknown';
  const r = await call(`${b}/codes/${sha256Hex(normalizeCode(f.code))}?${key()}`);
  if (!r?.ok) return 'unknown';
  await kvSet('pc:founderCheckT', String(Date.now())).catch(() => {});
  const usedBy = str(((await r.json()) as { fields: Record<string, FsVal> }).fields.usedBy);
  if (usedBy && usedBy !== (await deviceId())) {
    await kvSet('pc:founder', '').catch(() => {});
    await kvSet('pc:wall', '').catch(() => {});
    return 'moved';
  }
  return 'ok';
}

export async function founderInfo(): Promise<FounderInfo | null> {
  const s = await kvGet('pc:founder').catch(() => null);
  if (!s) return null;
  const f = JSON.parse(s) as Partial<FounderInfo>;
  if (!f.code && f.tier !== 'amici') return null;
  return { code: f.code ?? '', t: f.t ?? 0, tier: f.tier ?? 'base', gifts: f.gifts ?? [], start: f.start ?? f.t ?? 0 };
}

/** Quali codici regalo sono già stati usati dagli amici. */
export async function giftStatus(gifts: string[]): Promise<Record<string, boolean>> {
  const b = base();
  const out: Record<string, boolean> = {};
  if (!b) return out;
  await Promise.all(
    gifts.map(async (g) => {
      const r = await call(`${b}/codes/${sha256Hex(normalizeCode(g))}?${key()}`);
      if (r?.ok) {
        const d = (await r.json()) as { fields: Record<string, FsVal> };
        out[g] = !!str(d.fields.usedBy);
      }
    }),
  );
  return out;
}

// ---------------------------------------------------------------------------------------
// inviti: ogni telefono ha un codice amico; chi installa lo inserisce una volta

const INVITE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export async function myInviteCode(): Promise<string> {
  const h = sha256Hex(await deviceId());
  let out = '';
  for (let i = 0; i < 6; i++) out += INVITE_ALPHABET[parseInt(h.slice(i * 2, i * 2 + 2), 16) % INVITE_ALPHABET.length];
  return out;
}

export function normalizeInvite(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
}

/** Quanti amici hanno usato il mio codice. null = offline. */
export async function myInviteCount(): Promise<number | null> {
  const b = base();
  if (!b) return null;
  const r = await call(`${b}/invites/${await myInviteCode()}?${key()}`);
  if (!r) return null;
  if (r.status === 404) return 0;
  if (!r.ok) return null;
  return num(((await r.json()) as { fields: Record<string, FsVal> }).fields.n) ?? 0;
}

export type InviteResult = 'ok' | 'self' | 'already' | 'invalid' | 'offline';

/** Il nuovo utente conferma chi l'ha invitato (una sola volta per telefono). */
export async function claimInvite(input: string): Promise<InviteResult> {
  const b = base();
  const code = normalizeInvite(input);
  if (code.length < 4) return 'invalid';
  if ((await kvGet('pc:invitedBy').catch(() => null)) !== null) return 'already';
  if (code === (await myInviteCode())) return 'self';
  if (!b) return 'offline';
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await call(`${b}/invites/${code}?${key()}`);
    if (!r) return 'offline';
    let res: Response | null;
    if (r.status === 404) {
      res = await call(`${b}/invites/${code}?currentDocument.exists=false&${key()}`, {
        method: 'PATCH',
        body: JSON.stringify({ fields: { n: { integerValue: '1' }, t: { doubleValue: Date.now() } } }),
      });
    } else if (r.ok) {
      const d = (await r.json()) as { fields: Record<string, FsVal>; updateTime: string };
      const n = num(d.fields.n) ?? 0;
      res = await call(`${b}/invites/${code}?currentDocument.updateTime=${encodeURIComponent(d.updateTime)}&${key()}`, {
        method: 'PATCH',
        body: JSON.stringify({ fields: { n: { integerValue: String(n + 1) }, t: { doubleValue: Date.now() } } }),
      });
    } else return 'offline';
    if (!res) return 'offline';
    if (res.ok) {
      await kvSet('pc:invitedBy', code).catch(() => {});
      return 'ok';
    }
    // qualcun altro ha aggiornato nello stesso momento: riprova
  }
  return 'offline';
}

// ---------------------------------------------------------------------------------------
// pubblicità

export interface Ad {
  id: string;
  sponsor: string;
  title: string;
  text: string;
  cta: string;
  url: string;
  image: string;
  /** zona geohash5 ('' = tutte) */
  zone: string;
  active: boolean;
  until: number;
  weight: number;
}

export function adFromDoc(name: string, f: Record<string, FsVal>): Ad {
  return {
    id: name.split('/').pop() ?? '',
    sponsor: str(f.sponsor) ?? '',
    title: str(f.title) ?? '',
    text: str(f.text) ?? '',
    cta: str(f.cta) ?? '',
    url: str(f.url) ?? '',
    image: str(f.image) ?? '',
    zone: str(f.zone) ?? '',
    active: f.active?.booleanValue ?? false,
    until: num(f.until) ?? 0,
    weight: num(f.weight) ?? 1,
  };
}

/** Le pubblicità attive per la zona del telefono (salvate per l'uso offline). */
export async function fetchAds(zone: string | null): Promise<Ad[]> {
  const b = base();
  const now = Date.now();
  const keep = (a: Ad) => a.active && a.title && (!a.until || a.until > now) && (!a.zone || (zone !== null && zone.startsWith(a.zone)));
  if (b) {
    const r = await call(`${b}/ads?pageSize=100&${key()}`);
    if (r?.ok) {
      const j = (await r.json()) as { documents?: { name: string; fields: Record<string, FsVal> }[] };
      const all = (j.documents ?? []).map((d) => adFromDoc(d.name, d.fields ?? {}));
      await kvSet('pc:ads', JSON.stringify(all)).catch(() => {});
      return all.filter(keep);
    }
  }
  const saved = await kvGet('pc:ads').catch(() => null);
  return saved ? (JSON.parse(saved) as Ad[]).filter(keep) : [];
}

export function pickAd(ads: Ad[]): Ad | null {
  const tot = ads.reduce((s, a) => s + Math.max(0, a.weight || 1), 0);
  if (!tot) return null;
  let r = Math.random() * tot;
  for (const a of ads) {
    r -= Math.max(0, a.weight || 1);
    if (r <= 0) return a;
  }
  return ads[ads.length - 1];
}

/** Visualizzazione (al massimo una al giorno per pubblicità) o tocco. */
export async function logAdEvent(ad: Ad, kind: 'view' | 'click', zone: string | null): Promise<void> {
  const b = base();
  if (!b) return;
  if (kind === 'view') {
    const day = new Date().toISOString().slice(0, 10);
    const k = `pc:adview:${ad.id}`;
    if ((await kvGet(k).catch(() => null)) === day) return;
    await kvSet(k, day).catch(() => {});
  }
  await call(`${b}/adEvents?${key()}`, {
    method: 'POST',
    body: JSON.stringify({
      fields: { adId: { stringValue: ad.id }, kind: { stringValue: kind }, t: { doubleValue: Date.now() }, zone: { stringValue: zone ?? '' } },
    }),
  });
}

// ---------------------------------------------------------------------------------------

/** Parcheggio concluso, in forma anonima: serve a costruire la mappa dei posti veri. */
export async function uploadParking(s: ParkingSession): Promise<void> {
  const b = base();
  if (!b || s.parkedT === null) return;
  const p = s.spot.pointFinal;
  const id = `${await deviceId()}-${s.parkingId}`;
  await call(`${b}/parkings/${encodeURIComponent(id)}?${key()}`, {
    method: 'PATCH',
    body: JSON.stringify({
      fields: {
        latitude: { doubleValue: Math.round(p.latitude * 1e5) / 1e5 },
        longitude: { doubleValue: Math.round(p.longitude * 1e5) / 1e5 },
        geohash7: { stringValue: encode(p.latitude, p.longitude, 7) },
        parkedT: { doubleValue: Math.round(s.parkedT / 60000) * 60000 },
        durationS: { doubleValue: s.durationS ?? 0 },
        outcome: { stringValue: s.outcome },
        exitedOnFoot: { booleanValue: !!s.exitedOnFoot },
        quality: { stringValue: s.spot.pointQuality },
        atFuel: { booleanValue: !!s.atFuelStation },
        gpsLost: { booleanValue: !!s.gpsLostAtPark },
        deviceId: { stringValue: await deviceId() },
      },
    }),
  });
}

// ---------------------------------------------------------------------------------------
// muro dei fondatori

export interface WallEntry {
  id: string;
  name: string;
  visible: boolean;
  tier: Tier;
  t: number;
  /** moderazione: 'ok' (approvato modName), 'hidden' (nascosto dal control center), '' (non ancora visto) */
  mod: string;
  modName: string;
}

/** il nome compare nel muro pubblico? */
export function wallShows(w: WallEntry): boolean {
  if (!w.visible || !w.name || w.mod === 'hidden') return false;
  if (w.mod === 'ok' && w.modName === w.name) return true;
  return checkName(w.name) === 'ok';
}

export const TIER_RANK: Record<Tier, number> = { platino: 0, oro: 1, base: 2, regalo: 3, amici: 4, tester: 5, continua: 6 };
export const TIER_BADGE: Record<Tier, string> = { platino: '💎', oro: '🥇', base: '⭐', regalo: '🎁', amici: '🤝', tester: '🧪', continua: '🚗' };

async function wallId(f: FounderInfo): Promise<string> {
  if (f.tier === 'amici') return `inv-${await myInviteCode()}`;
  return sha256Hex(normalizeCode(f.code));
}

export async function fetchWall(): Promise<WallEntry[] | null> {
  const b = base();
  if (!b) return null;
  const out: WallEntry[] = [];
  let token = '';
  for (let page = 0; page < 10; page++) {
    const r = await call(`${b}/wall?pageSize=300${token ? `&pageToken=${encodeURIComponent(token)}` : ''}&${key()}`);
    if (!r?.ok) return page === 0 ? null : out;
    const j = (await r.json()) as { documents?: { name: string; fields: Record<string, FsVal> }[]; nextPageToken?: string };
    for (const d of j.documents ?? []) {
      out.push({
        id: d.name.split('/').pop() ?? '',
        name: str(d.fields.name) ?? '',
        visible: d.fields.visible?.booleanValue ?? false,
        tier: ((str(d.fields.tier) as Tier | null) ?? 'base'),
        t: num(d.fields.t) ?? 0,
        mod: str(d.fields.mod) ?? '',
        modName: str(d.fields.modName) ?? '',
      });
    }
    if (!j.nextPageToken) break;
    token = j.nextPageToken;
  }
  return out.sort((a, b2) => TIER_RANK[a.tier] - TIER_RANK[b2.tier] || a.t - b2.t);
}

/** quante volte si può scrivere un nome nel muro: il primo + una correzione */
export const WALL_MAX_NAMES = 2;

export interface MyWall {
  name: string;
  visible: boolean;
  /** nomi scritti finora (0, 1 o 2) */
  edits: number;
  hidden: boolean;
  t: number;
}

/** La mia voce nel muro, letta dal server (serve anche dopo un cambio telefono o una reinstallazione). */
export async function myWallEntry(f?: FounderInfo | null): Promise<MyWall | null> {
  const fi = f ?? (await founderInfo());
  const b = base();
  if (fi && b) {
    const r = await call(`${b}/wall/${await wallId(fi)}?${key()}`);
    if (r?.status === 404) return null;
    if (r?.ok) {
      const d = ((await r.json()) as { fields: Record<string, FsVal> }).fields;
      const w: MyWall = {
        name: str(d.name) ?? '',
        visible: d.visible?.booleanValue ?? false,
        edits: num(d.edits) ?? (str(d.name) ? 1 : 0),
        hidden: str(d.mod) === 'hidden',
        t: num(d.t) ?? Date.now(),
      };
      await kvSet('pc:wall', JSON.stringify(w)).catch(() => {});
      return w;
    }
  }
  const s = await kvGet('pc:wall').catch(() => null);
  return s ? (JSON.parse(s) as MyWall) : null;
}

export type WallSave = 'ok' | 'review' | 'blocked' | 'locked' | 'limit' | 'offline';

/**
 * Salva la scelta per il muro. Il nome si scrive una volta e si può correggere una sola volta
 * (lo garantisce il server); passare ad anonimo è sempre possibile.
 */
export async function saveWallEntry(f: FounderInfo, name: string, visible: boolean): Promise<WallSave> {
  const b = base();
  if (!b) return 'offline';
  const clean = visible ? name.replace(/\s+/g, ' ').trim().slice(0, 24) : '';
  const check = clean ? checkName(clean) : 'ok';
  if (check === 'blocked') return 'blocked';
  const id = await wallId(f);
  const prev = await myWallEntry(f);
  if (prev?.hidden) return 'locked';
  const newName = clean.length > 0 && clean !== (prev?.name ?? '');
  const edits = (prev?.edits ?? 0) + (newName ? 1 : 0);
  if (newName && edits > WALL_MAX_NAMES) return 'limit';
  const mask = ['name', 'visible', 'tier', 't', 'by', 'edits'].map((k) => `updateMask.fieldPaths=${k}`).join('&');
  const r = await call(`${b}/wall/${id}?${mask}&${key()}`, {
    method: 'PATCH',
    body: JSON.stringify({
      fields: {
        name: { stringValue: clean },
        visible: { booleanValue: clean.length > 0 },
        tier: { stringValue: f.tier },
        t: { doubleValue: prev?.t ?? Date.now() },
        by: { stringValue: await deviceId() },
        edits: { integerValue: String(edits) },
      },
    }),
  });
  if (!r) return 'offline';
  if (r.status === 403) return newName ? 'limit' : 'locked';
  if (!r.ok) return 'offline';
  await kvSet('pc:wall', JSON.stringify({ name: clean, visible: clean.length > 0, edits, hidden: false, t: prev?.t ?? Date.now() })).catch(() => {});
  return check === 'review' ? 'review' : 'ok';
}

/** prezzo in formato italiano: 2,90 € */
export function euro(n: number): string {
  return `${n.toLocaleString('it-IT', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })} €`;
}

// ---------------------------------------------------------------------------------------
// pagamento con Stripe: il telefono crea un riferimento casuale, lo passa al pagamento
// e poi ritira il codice da pickup/{ref} (lo scrive il server appena il pagamento è confermato)

export interface Pending {
  ref: string;
  tier: Tier;
  t: number;
}

export function payLink(cfg: PublicConfig | null, tier: Tier): string {
  if (!cfg) return '';
  return tier === 'oro'
    ? cfg.linkGold
    : tier === 'platino'
      ? cfg.linkPlat
      : tier === 'tester'
        ? cfg.linkTester
        : tier === 'continua'
          ? cfg.linkContinue
          : cfg.linkBase;
}

/** Tester: millisecondi di uso rimasti (null se non è un tester) */
export function testerLeftMs(f: FounderInfo | null, cfg: PublicConfig | null, now: number): number | null {
  if (!f || f.tier !== 'tester') return null;
  const days = cfg?.testerDays ?? 90;
  return (f.start ?? f.t) + days * 86_400_000 - now;
}

/** commissione stimata della carta (Stripe, carte europee: 1,5% + 0,25 €) */
export function cardFee(amount: number): number {
  return Math.round((amount * 0.015 + 0.25) * 100) / 100;
}

/** Prepara il pagamento: restituisce l'indirizzo da aprire ('' se i pagamenti non sono attivi). */
export async function startPurchase(cfg: PublicConfig | null, tier: Tier): Promise<string> {
  const link = payLink(cfg, tier);
  if (!link) return '';
  const ref = sha256Hex(`${Math.random()}-${Date.now()}-${await deviceId()}`).slice(0, 32);
  await kvSet('pc:pending', JSON.stringify({ ref, tier, t: Date.now() } satisfies Pending)).catch(() => {});
  return `${link}${link.includes('?') ? '&' : '?'}client_reference_id=${ref}`;
}

export async function pendingPurchase(): Promise<Pending | null> {
  const s = await kvGet('pc:pending').catch(() => null);
  if (!s) return null;
  const p = JSON.parse(s) as Pending;
  // dopo 3 giorni si smette di aspettare
  if (Date.now() - p.t > 3 * 86_400_000) return null;
  return p;
}

export async function clearPending(): Promise<void> {
  await kvSet('pc:pending', '').catch(() => {});
}

/** Il codice del pagamento è pronto? Se sì lo attiva su questo telefono. */
export async function collectPurchase(): Promise<{ code: string; result: RedeemResult } | null> {
  const p = await pendingPurchase();
  const b = base();
  if (!p || !b) return null;
  const r = await call(`${b}/pickup/${p.ref}?${key()}`);
  if (!r?.ok) return null;
  const code = str(((await r.json()) as { fields: Record<string, FsVal> }).fields.code);
  if (!code) return null;
  const result = await redeemCode(code);
  if (result === 'ok' || result === 'moved') await clearPending();
  return { code: prettyCode(code), result };
}

/** formatta il codice mentre si scrive: ABCD-EFGH-JKLM */
export function formatCodeInput(t: string): string {
  const c = t.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
  return [c.slice(0, 4), c.slice(4, 8), c.slice(8, 12)].filter(Boolean).join('-');
}

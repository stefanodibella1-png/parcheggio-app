// ParkingCT: dati sul server (Firestore via REST, nessun account utente).
// Inviati: zona (cella di ~5 km), parcheggi anonimi, uso del codice sostenitore,
// inviti (solo un contatore), visualizzazioni anonime delle pubblicità.
// Mai nome, numero di telefono o posizione in tempo reale.
// I numeri complessivi (quanti telefoni, quante zone) li vede solo il control center.
import { FIREBASE_CONFIG } from '../community/firebaseConfig.ts';
import { encode } from '../community/geohash.ts';
import type { ParkingSession } from '../../engine/types.ts';
import { kvGet, kvSet } from '../storage/db.ts';
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
}

export const APK_URL = 'https://github.com/stefanodibella1-png/parcheggio-app/releases/latest/download/ParkingCT.apk';

const DEFAULT_CONFIG: PublicConfig = {
  launchAt: Date.parse('2026-12-01T10:00:00+01:00'),
  supportUrl: '',
  zoneTarget: 1000,
  zoneName: '',
  priceBase: 3,
  priceGold: 10,
  pricePlat: 25,
  giftsGold: 2,
  giftsPlat: 5,
  inviteFreeAt: 10,
  landingUrl: '',
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

export type Tier = 'base' | 'oro' | 'platino' | 'regalo' | 'amici';

export const TIER_LABEL: Record<Tier, string> = {
  base: 'Sostenitore fondatore',
  oro: 'Fondatore Oro',
  platino: 'Fondatore Platino',
  regalo: 'Fondatore (regalo di un amico)',
  amici: 'Fondatore ad honorem',
};

export interface FounderInfo {
  code: string;
  t: number;
  tier: Tier;
  gifts: string[];
}

export type RedeemResult = 'ok' | 'invalid' | 'used' | 'offline';

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
  if (usedBy && usedBy !== id) return 'used';
  if (!usedBy) {
    const up = await call(`${b}/codes/${h}?updateMask.fieldPaths=usedBy&updateMask.fieldPaths=usedAt&${key()}`, {
      method: 'PATCH',
      body: JSON.stringify({ fields: { usedBy: { stringValue: id }, usedAt: { doubleValue: Date.now() } } }),
    });
    if (!up) return 'offline';
    if (!up.ok) return 'used';
  }
  const tier = (str(doc.fields.tier) as Tier | null) ?? 'base';
  const info: FounderInfo = { code: prettyCode(code), t: Date.now(), tier, gifts: strList(doc.fields.gifts).map(prettyCode) };
  await kvSet('pc:founder', JSON.stringify(info)).catch(() => {});
  return 'ok';
}

export async function founderInfo(): Promise<FounderInfo | null> {
  const s = await kvGet('pc:founder').catch(() => null);
  if (!s) return null;
  const f = JSON.parse(s) as Partial<FounderInfo>;
  return { code: f.code ?? '', t: f.t ?? 0, tier: f.tier ?? 'base', gifts: f.gifts ?? [] };
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
}

export const TIER_RANK: Record<Tier, number> = { platino: 0, oro: 1, base: 2, regalo: 3, amici: 4 };
export const TIER_BADGE: Record<Tier, string> = { platino: '💎', oro: '🥇', base: '⭐', regalo: '🎁', amici: '🤝' };

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
      });
    }
    if (!j.nextPageToken) break;
    token = j.nextPageToken;
  }
  return out.sort((a, b2) => TIER_RANK[a.tier] - TIER_RANK[b2.tier] || a.t - b2.t);
}

export async function myWallEntry(): Promise<{ name: string; visible: boolean } | null> {
  const s = await kvGet('pc:wall').catch(() => null);
  return s ? (JSON.parse(s) as { name: string; visible: boolean }) : null;
}

/** Salva la scelta per il muro: nome visibile oppure anonimo. */
export async function saveWallEntry(f: FounderInfo, name: string, visible: boolean): Promise<boolean> {
  const b = base();
  if (!b) return false;
  const clean = name.replace(/\s+/g, ' ').trim().slice(0, 24);
  const id = await wallId(f);
  const prev = await myWallEntry();
  const r = await call(`${b}/wall/${id}?${key()}`, {
    method: 'PATCH',
    body: JSON.stringify({
      fields: {
        name: { stringValue: visible ? clean : '' },
        visible: { booleanValue: visible && clean.length > 0 },
        tier: { stringValue: f.tier },
        t: { doubleValue: prev ? Number((await kvGet('pc:wallT').catch(() => null)) ?? Date.now()) : Date.now() },
        by: { stringValue: await deviceId() },
      },
    }),
  });
  if (!r?.ok) return false;
  if (!prev) await kvSet('pc:wallT', String(Date.now())).catch(() => {});
  await kvSet('pc:wall', JSON.stringify({ name: clean, visible: visible && clean.length > 0 })).catch(() => {});
  return true;
}

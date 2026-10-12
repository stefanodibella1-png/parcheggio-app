// Preferenze dell'utente su avvisi e voce (salvate sul telefono).
import { kvGet, kvSet } from '../storage/db.ts';

export type PrefKey = 'voice' | 'spotNotif' | 'parkNotif';

export const PREF_LABEL: Record<PrefKey, string> = {
  voice: 'Avviso a voce mentre guidi',
  spotNotif: 'Notifiche dei posti che si liberano',
  parkNotif: 'Notifica "Ho ricordato dove hai parcheggiato"',
};

/** tutte attive di serie */
export async function getPref(k: PrefKey): Promise<boolean> {
  return ((await kvGet(`pref:${k}`).catch(() => null)) ?? '1') !== '0';
}

export async function setPref(k: PrefKey, on: boolean): Promise<void> {
  await kvSet(`pref:${k}`, on ? '1' : '0').catch(() => {});
}

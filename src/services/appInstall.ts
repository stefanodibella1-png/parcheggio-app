// Nuove installazioni (APK) fuori dal Play Store.
// Gli aggiornamenti JavaScript arrivano da soli (EAS Update). Quando cambia il codice nativo
// serve invece una nuova APK: qui si confronta la build installata con l'ultima release
// pubblicata su GitHub e, se è più vecchia, l'app propone di scaricarla con un tocco.
// Android chiede sempre all'utente di confermare l'installazione (fuori dal Play Store non si può evitare).
import { Platform } from 'react-native';
import * as Application from 'expo-application';
import { ActivityRecognition } from '../../modules/activity-recognition/index.ts';
import { IS_PUBLIC } from '../variant.ts';

const REPO = 'stefanodibella1-png/parcheggio-app';

/** Build nativa installata. Dalla 18 è il versionCode; prima era sempre 1 e si riconosce dalle funzioni presenti. */
export function installedBuild(): number {
  const vc = Number(Application.nativeBuildVersion);
  if (vc > 1) return vc;
  return ActivityRecognition.locationBackupPresent ? 17 : 16;
}

export function apkUrl(build: number): string {
  const name = IS_PUBLIC ? 'ParkingCT' : 'PARCHEGGIO';
  return `https://github.com/${REPO}/releases/download/build-${build}/${name}-build-${build}.apk`;
}

/** Numero dell'ultima build pubblicata, oppure null se non si sa (offline). */
export async function latestBuild(): Promise<number | null> {
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 10_000);
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: ctl.signal,
    });
    clearTimeout(timer);
    if (!r.ok) return null;
    const j = (await r.json()) as { tag_name?: string; assets?: { name: string }[] };
    const n = Number(/^build-(\d+)$/.exec(j.tag_name ?? '')?.[1]);
    if (!(n > 0)) return null;
    // la release deve contenere l'APK di questa app (le due varianti si compilano in parallelo)
    const names = (j.assets ?? []).map((a) => a.name);
    if (!names.includes(`${IS_PUBLIC ? 'ParkingCT' : 'PARCHEGGIO'}-build-${n}.apk`)) return null;
    return n;
  } catch {
    return null;
  }
}

/** La build installata è più vecchia dell'ultima pubblicata? */
export async function newInstallAvailable(): Promise<number | null> {
  if (Platform.OS !== 'android') return null;
  const latest = await latestBuild();
  if (latest === null) return null;
  return latest > installedBuild() ? latest : null;
}

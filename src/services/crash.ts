// Diagnostica: quando l'app va in errore (schermo nero) il messaggio arriva al server,
// così si legge la causa vera invece di indovinarla. Nessun dato personale: solo l'errore,
// la versione e il punto del codice.
import { Platform } from 'react-native';
import * as Updates from 'expo-updates';
import * as Application from 'expo-application';
import { FIREBASE_CONFIG } from '../community/firebaseConfig.ts';
import { APP_NAME } from '../variant.ts';

let lastError: { msg: string; stack: string } | null = null;

export function getLastError(): { msg: string; stack: string } | null {
  return lastError;
}

export function report(kind: string, e: unknown, extra = ''): void {
  const err = e instanceof Error ? e : new Error(String(e));
  lastError = { msg: `${err.name}: ${err.message}`, stack: String(err.stack ?? '').slice(0, 3000) };
  if (!FIREBASE_CONFIG) return;
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const s = (v: string) => ({ stringValue: v.slice(0, 3000) });
  const body = {
    fields: {
      t: { doubleValue: Date.now() },
      kind: s(kind),
      app: s(APP_NAME),
      build: s(String(Application.nativeBuildVersion ?? '')),
      update: s(Updates.updateId ?? 'embedded'),
      os: s(`${Platform.OS} ${Platform.Version}`),
      msg: s(lastError.msg),
      stack: s(lastError.stack),
      extra: s(extra),
    },
  };
  void fetch(
    `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents/crashes/${id}?key=${encodeURIComponent(FIREBASE_CONFIG.apiKey)}`,
    { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
  ).catch(() => {});
}

/** Errori JavaScript non gestiti: si registrano e poi si lascia fare al gestore originale. */
export function installCrashHandler(): void {
  const g = globalThis as unknown as { ErrorUtils?: { getGlobalHandler(): (e: unknown, fatal?: boolean) => void; setGlobalHandler(h: (e: unknown, fatal?: boolean) => void): void } };
  const eu = g.ErrorUtils;
  if (!eu) return;
  const prev = eu.getGlobalHandler();
  eu.setGlobalHandler((e, fatal) => {
    report(fatal ? 'fatal' : 'error', e);
    // si aspetta un attimo che l'invio parta prima che l'app si chiuda
    setTimeout(() => prev(e, fatal), fatal ? 1500 : 0);
  });
  const p = globalThis as unknown as { HermesInternal?: { enablePromiseRejectionTracker?: (o: object) => void } };
  p.HermesInternal?.enablePromiseRejectionTracker?.({
    allRejections: true,
    onUnhandled: (_id: number, e: unknown) => report('promise', e),
  });
}

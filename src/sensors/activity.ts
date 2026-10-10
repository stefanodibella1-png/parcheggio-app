// Activity recognition: un solo listener, una sola sorgente per piattaforma.
import { ActivityRecognition, type NativeActivity } from '../../modules/activity-recognition/index.ts';
import type { ActivitySample } from '../../engine/types.ts';

let sub: { remove(): void } | null = null;

export function toActivitySample(a: NativeActivity): ActivitySample {
  return { t: a.t, activity: a.activity, confidence: a.confidence, platform: a.platform, source: a.source };
}

let nativeStarted = false;

export function startActivity(onSample: (s: ActivitySample) => void): void {
  // Solo il listener JS si sostituisce. La richiesta a Play Services NON va tolta e rimessa:
  // le due operazioni sono asincrone e la rimozione poteva arrivare dopo, lasciando
  // il riconoscimento spento ("attività 0/min").
  sub?.remove();
  sub = ActivityRecognition.addListener((a) => onSample(toActivitySample(a)));
  if (!nativeStarted) {
    nativeStarted = true;
    ActivityRecognition.start(3000);
  }
}

/**
 * Se Play Services non manda nulla, si rifà la registrazione da zero:
 * prima la rimozione, poi (dopo che è stata eseguita) una nuova richiesta.
 */
export async function kickActivity(): Promise<void> {
  ActivityRecognition.stop();
  await new Promise((r) => setTimeout(r, 3000));
  ActivityRecognition.start(3000);
  nativeStarted = true;
}

export function stopActivity(): void {
  sub?.remove();
  sub = null;
  if (nativeStarted) {
    nativeStarted = false;
    ActivityRecognition.stop();
  }
}

/** iOS: attività registrate da Core Motion mentre l'app era sospesa. */
export async function activityHistory(fromMs: number, toMs: number): Promise<ActivitySample[]> {
  try {
    const list = await ActivityRecognition.queryHistory(fromMs, toMs);
    return list.map(toActivitySample);
  } catch {
    return [];
  }
}

/** Android: risultati ricevuti mentre JS non ascoltava. */
export async function bufferedActivities(): Promise<ActivitySample[]> {
  try {
    return (await ActivityRecognition.getBuffered()).map(toActivitySample);
  } catch {
    return [];
  }
}

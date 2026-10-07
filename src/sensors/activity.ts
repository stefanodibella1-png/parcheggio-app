// Activity recognition: un solo listener, una sola sorgente per piattaforma.
import { ActivityRecognition, type NativeActivity } from '../../modules/activity-recognition/index.ts';
import type { ActivitySample } from '../../engine/types.ts';

let sub: { remove(): void } | null = null;

export function toActivitySample(a: NativeActivity): ActivitySample {
  return { t: a.t, activity: a.activity, confidence: a.confidence, platform: a.platform, source: a.source };
}

export function startActivity(onSample: (s: ActivitySample) => void): void {
  stopActivity();
  sub = ActivityRecognition.addListener((a) => onSample(toActivitySample(a)));
  ActivityRecognition.start(3000);
}

export function stopActivity(): void {
  sub?.remove();
  sub = null;
  ActivityRecognition.stop();
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

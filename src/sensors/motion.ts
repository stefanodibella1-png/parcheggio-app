// Accelerometro → feature aggregate ogni 2 s (non si salvano dati grezzi a 50 Hz).
import { Accelerometer } from 'expo-sensors';
import type { MotionFeatures } from '../../engine/types.ts';

const HZ = 25;
const WINDOW_MS = 2000;
const STEP_THRESHOLD_G = 0.12;
const STEP_MIN_INTERVAL_MS = 300;

let sub: { remove(): void } | null = null;
let buf: { t: number; mag: number }[] = [];
let windowStart = 0;
let lastStepT = 0;
let samplesInLastWindow = 0;

export async function motionAvailable(): Promise<boolean> {
  try {
    return await Accelerometer.isAvailableAsync();
  } catch {
    return false;
  }
}

export function startMotion(onFeatures: (f: MotionFeatures) => void): void {
  stopMotion();
  Accelerometer.setUpdateInterval(Math.round(1000 / HZ));
  windowStart = Date.now();
  sub = Accelerometer.addListener(({ x, y, z }) => {
    const t = Date.now();
    buf.push({ t, mag: Math.sqrt(x * x + y * y + z * z) });
    if (t - windowStart >= WINDOW_MS) {
      const f = features(buf, t, t - windowStart);
      samplesInLastWindow = buf.length;
      buf = [];
      windowStart = t;
      if (f) onFeatures(f);
    }
  });
}

export function stopMotion(): void {
  sub?.remove();
  sub = null;
  buf = [];
}

export function motionRate(): number {
  return samplesInLastWindow / (WINDOW_MS / 1000);
}

function features(samples: { t: number; mag: number }[], t: number, windowMs: number): MotionFeatures | null {
  if (samples.length < 5) return null;
  const mean = samples.reduce((s, x) => s + x.mag, 0) / samples.length; // ≈ 1 g (gravità)
  const dyn = samples.map((x) => Math.abs(x.mag - mean));
  const accMean = dyn.reduce((s, x) => s + x, 0) / dyn.length;
  const accVariance = dyn.reduce((s, x) => s + (x - accMean) ** 2, 0) / dyn.length;
  const accPeak = Math.max(...dyn);
  // passi: picchi della componente dinamica sopra soglia, distanziati almeno 300 ms
  let steps = 0;
  for (let i = 1; i < samples.length - 1; i++) {
    const v = samples[i].mag - mean;
    if (v > STEP_THRESHOLD_G && v >= samples[i - 1].mag - mean && v >= samples[i + 1].mag - mean && samples[i].t - lastStepT >= STEP_MIN_INTERVAL_MS) {
      steps++;
      lastStepT = samples[i].t;
    }
  }
  return { t, windowMs, accMean, accVariance, accPeak, stepCount: steps, gyroMean: null };
}

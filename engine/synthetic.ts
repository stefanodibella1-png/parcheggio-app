// Generatore di scenari sintetici per i test automatici e il simulatore.
// Solo per test/simulatore: l'app reale usa esclusivamente sensori reali.

import type { ActivityType, EngineInput } from './types.ts';

const M_PER_DEG_LAT = 111_320;

/** PRNG deterministico (mulberry32) per rumore ripetibile. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SegmentOpts {
  /** precisione GPS dichiarata (m) */
  accuracy?: number;
  /** rumore reale applicato alla posizione (m) */
  noiseM?: number;
  /** activity riportata dal sistema (default coerente con il segmento) */
  activity?: ActivityType;
  activityConfidence?: number;
  /** passi per finestra di 2 s */
  steps?: number;
  /** nessun fix GPS nel segmento */
  gpsLost?: boolean;
  /** la velocità del sistema non è disponibile (solo derivata) */
  noSystemSpeed?: boolean;
}

export class Scenario {
  t: number;
  lat: number;
  lon: number;
  readonly inputs: EngineInput[] = [];
  private rand: () => number;
  private lastActivityT = -Infinity;

  constructor(start = { latitude: 37.5079, longitude: 15.083 }, t0 = 1_790_000_000_000, seed = 1) {
    this.t = t0;
    this.lat = start.latitude;
    this.lon = start.longitude;
    this.rand = rng(seed);
  }

  private move(meters: number, bearing: number): void {
    const b = (bearing * Math.PI) / 180;
    this.lat += (meters * Math.cos(b)) / M_PER_DEG_LAT;
    this.lon += (meters * Math.sin(b)) / (M_PER_DEG_LAT * Math.cos((this.lat * Math.PI) / 180));
  }

  private segment(seconds: number, kmh: number, bearing: number, def: Required<Pick<SegmentOpts, 'activity' | 'steps'>>, o: SegmentOpts): this {
    const ms = kmh / 3.6;
    const acc = o.accuracy ?? 5;
    const noise = o.noiseM ?? Math.min(acc / 3, 3);
    const activity = o.activity ?? def.activity;
    const conf = o.activityConfidence ?? 90;
    const steps = o.steps ?? def.steps;
    for (let i = 0; i < seconds; i++) {
      this.t += 1000;
      this.move(ms, bearing);
      if (!o.gpsLost) {
        const dn = (this.rand() - 0.5) * 2 * noise;
        const de = (this.rand() - 0.5) * 2 * noise;
        const lat = this.lat + dn / M_PER_DEG_LAT;
        const lon = this.lon + de / (M_PER_DEG_LAT * Math.cos((this.lat * Math.PI) / 180));
        this.inputs.push({
          kind: 'location',
          sample: {
            t: this.t,
            latitude: lat,
            longitude: lon,
            accuracy: acc,
            speed: o.noSystemSpeed ? null : Math.max(0, ms + (this.rand() - 0.5) * 0.3),
            heading: ms >= 1 ? bearing : null,
            source: 'sim',
          },
        });
      }
      if (i % 2 === 1) {
        this.inputs.push({
          kind: 'motion',
          sample: { t: this.t, windowMs: 2000, accMean: steps > 0 ? 0.25 : 0.05, accVariance: steps > 0 ? 0.05 : 0.004, accPeak: steps > 0 ? 1.2 : 0.3, stepCount: steps },
        });
      }
      if (this.t - this.lastActivityT >= 5000) {
        this.lastActivityT = this.t;
        this.inputs.push({ kind: 'activity', sample: { t: this.t, activity, confidence: conf, platform: 'sim', source: 'sim' } });
      }
      this.inputs.push({ kind: 'tick', t: this.t });
    }
    return this;
  }

  drive(seconds: number, kmh = 35, bearing = 90, o: SegmentOpts = {}): this {
    return this.segment(seconds, kmh, bearing, { activity: 'IN_VEHICLE', steps: 0 }, o);
  }

  /** sosta in auto (motore acceso, semaforo, parcheggio con persona a bordo) */
  stopInCar(seconds: number, o: SegmentOpts = {}): this {
    return this.segment(seconds, 0, 0, { activity: 'STILL', steps: 0 }, o);
  }

  walk(seconds: number, bearing = 0, kmh = 4.5, o: SegmentOpts = {}): this {
    return this.segment(seconds, kmh, bearing, { activity: 'WALKING', steps: 4 }, o);
  }

  /** fermo a piedi (es. in un negozio) */
  stand(seconds: number, o: SegmentOpts = {}): this {
    return this.segment(seconds, 0, 0, { activity: 'STILL', steps: 0 }, o);
  }

  /** tempo senza alcun dato (app sospesa) */
  silence(seconds: number): this {
    this.t += seconds * 1000;
    return this;
  }

  /** coda a scatti: brevi avanzamenti e piccole soste */
  stopAndGo(cycles: number, bearing = 90): this {
    for (let i = 0; i < cycles; i++) {
      this.drive(6, 12, bearing);
      this.stopInCar(20);
    }
    return this;
  }

  get position(): { latitude: number; longitude: number } {
    return { latitude: this.lat, longitude: this.lon };
  }
}

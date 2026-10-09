// Normalizzazione degli input, buffer di riordino e replay di test registrati.

import type { DetectionConfig } from './config.ts';
import { DEFAULT_CONFIG } from './config.ts';
import { DetectionEngine } from './engine.ts';
import type { DetectionEvent, EngineInput, EngineSnapshot, ParkingSession } from './types.ts';

export function inputTime(i: EngineInput): number {
  return i.kind === 'location' || i.kind === 'activity' || i.kind === 'motion' ? i.sample.t : i.t;
}

export interface NormalizeStats {
  total: number;
  outOfOrder: number;
  duplicates: number;
}

/**
 * Ordina per timestamp (stabile) ed elimina i duplicati esatti.
 * Nel test del 07/10 l'activity arrivava a coppie e fuori ordine.
 */
export function normalizeInputs(inputs: EngineInput[]): { inputs: EngineInput[]; stats: NormalizeStats } {
  let outOfOrder = 0;
  let lastT = -Infinity;
  for (const i of inputs) {
    const t = inputTime(i);
    if (t < lastT) outOfOrder++;
    lastT = Math.max(lastT, t);
  }
  const indexed = inputs.map((i, idx) => ({ i, idx, t: inputTime(i) }));
  indexed.sort((a, b) => a.t - b.t || a.idx - b.idx);
  const seen = new Set<string>();
  const out: EngineInput[] = [];
  let duplicates = 0;
  for (const x of indexed) {
    const key = JSON.stringify(x.i);
    if (seen.has(key)) {
      duplicates++;
      continue;
    }
    seen.add(key);
    out.push(x.i);
  }
  return { inputs: out, stats: { total: inputs.length, outOfOrder, duplicates } };
}

/** Buffer per l'uso dal vivo: trattiene gli input per `delayMs` e li rilascia ordinati. */
export class ReorderBuffer {
  private buf: EngineInput[] = [];
  private seen = new Set<string>();
  private released = -Infinity;
  readonly delayMs: number;

  constructor(delayMs = 2000) {
    this.delayMs = delayMs;
  }

  push(i: EngineInput): void {
    const key = JSON.stringify(i);
    if (this.seen.has(key)) return;
    this.seen.add(key);
    if (this.seen.size > 5000) this.seen = new Set([...this.seen].slice(-2500));
    this.buf.push(i);
  }

  /** Rilascia gli input con t <= now - delay (ordinati). Quelli troppo vecchi passano comunque. */
  release(now: number): EngineInput[] {
    const limit = now - this.delayMs;
    const ready = this.buf.filter((i) => inputTime(i) <= limit);
    this.buf = this.buf.filter((i) => inputTime(i) > limit);
    ready.sort((a, b) => inputTime(a) - inputTime(b));
    if (ready.length > 0) this.released = Math.max(this.released, inputTime(ready[ready.length - 1]));
    return ready;
  }

  /** Toglie dal buffer gli input già elaborati altrove (ricostruzione dal registro). */
  dropIf(pred: (i: EngineInput) => boolean): void {
    this.buf = this.buf.filter((i) => !pred(i));
  }

  flush(): EngineInput[] {
    const all = this.buf.sort((a, b) => inputTime(a) - inputTime(b));
    this.buf = [];
    return all;
  }
}

export interface ReplayResult {
  events: DetectionEvent[];
  sessions: ParkingSession[];
  snapshots: EngineSnapshot[];
  final: EngineSnapshot;
  stats: NormalizeStats;
  t0: number;
  t1: number;
}

/** Estrae gli input da un export (formato v1 del 07/10 o v2 attuale). */
export function inputsFromExport(json: unknown): EngineInput[] {
  const j = json as { inputs?: EngineInput[] };
  if (!j || !Array.isArray(j.inputs)) throw new Error('Export non valido: manca "inputs"');
  return j.inputs;
}

export function replay(inputs: EngineInput[], cfg: DetectionConfig = DEFAULT_CONFIG, idPrefix = 'R'): ReplayResult {
  const { inputs: norm, stats } = normalizeInputs(inputs);
  const engine = new DetectionEngine(cfg, idPrefix);
  const events: DetectionEvent[] = [];
  const snapshots: EngineSnapshot[] = [];
  for (const i of norm) {
    events.push(...engine.process(i));
    snapshots.push(...engine.drainSnapshots());
  }
  return {
    events,
    sessions: engine.getSessions(),
    snapshots,
    final: engine.snapshot(),
    stats,
    t0: norm.length ? inputTime(norm[0]) : 0,
    t1: norm.length ? inputTime(norm[norm.length - 1]) : 0,
  };
}

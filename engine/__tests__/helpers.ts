import type { DetectionEvent, EventType } from '../types.ts';

export function types(events: DetectionEvent[]): EventType[] {
  return events.map((e) => e.type);
}

export function has(events: DetectionEvent[], t: EventType): boolean {
  return events.some((e) => e.type === t);
}

export function releases(events: DetectionEvent[]): DetectionEvent[] {
  return events.filter((e) => e.type === 'PARKING_RELEASED' || e.type === 'PARKING_RELEASED_INFERRED');
}

export function trace(events: DetectionEvent[], t0: number): string {
  return events.map((e) => `${((e.t - t0) / 1000).toFixed(0)}s ${e.type} (${e.reason})`).join('\n');
}

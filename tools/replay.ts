// Rigioca un test esportato attraverso il motore attuale.
// Uso:  node tools/replay.ts percorso/test.json [--config override.json]

import { readFileSync } from 'node:fs';
import { replay, inputsFromExport } from '../engine/replay.ts';
import { analyzeTestQuality } from '../engine/analysis.ts';
import { makeConfig } from '../engine/config.ts';
import type { DetectionConfig } from '../engine/config.ts';

const file = process.argv[2];
if (!file) {
  console.error('Uso: node tools/replay.ts <export.json> [--config override.json]');
  process.exit(1);
}
const ci = process.argv.indexOf('--config');
const overrides: Partial<DetectionConfig> = ci > 0 ? JSON.parse(readFileSync(process.argv[ci + 1], 'utf8')) : {};
const cfg = makeConfig(overrides);
const data = JSON.parse(readFileSync(file, 'utf8'));
const inputs = inputsFromExport(data);
const r = replay(inputs, cfg);
const rel = (t: number) => ((t - r.t0) / 1000).toFixed(1).padStart(7);

console.log(`\n${file}`);
console.log(`input: ${r.stats.total} (fuori ordine ${r.stats.outOfOrder}, duplicati ${r.stats.duplicates}), durata ${((r.t1 - r.t0) / 60000).toFixed(1)} min\n`);
for (const e of r.events) {
  const d = e.data;
  console.log(`${rel(e.t)} s  ${e.type.padEnd(26)} ${String(d.speedKmh ?? '-').padStart(5)} km/h  d=${String(d.distanceM ?? '-').padStart(4)} m  | ${e.reason}`);
}
console.log('\nSessioni:');
for (const s of r.sessions) {
  const p = s.spot.pointFinal;
  console.log(
    `  ${s.parkingId} ${s.outcome}${s.inferred ? ' (dedotto)' : ''}  ${p.latitude.toFixed(6)}, ${p.longitude.toFixed(6)} ±${p.accuracyM} m  qualità ${s.spot.pointQuality}  durata ${s.durationS ?? '-'} s  confidence ${s.releaseConfidence ?? '-'}`,
  );
}
console.log(`\nStato finale: ${r.final.state}`);
const w = analyzeTestQuality({ inputs, events: r.events, sessions: r.sessions, finalState: r.final.state, stoppedAt: data.stoppedAt ?? data.exportedAt ?? null, cfg });
if (w.length) {
  console.log('\nAvvisi di qualità:');
  for (const x of w) console.log(`  [${x.severity}] ${x.message}`);
}

// Prova più configurazioni su tutti i test registrati che hanno etichette
// di revisione (o un .expected.json) e riporta rilevamenti e falsi positivi.
//
// Uso:  node tools/sweep.ts [cartella]   (default: engine/__tests__/fixtures/real)
//
// Un test conta come "partenza reale" se la revisione lo dice (reviewLabels)
// oppure se il .expected.json prevede un rilascio.

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { replay, inputsFromExport } from '../engine/replay.ts';
import { makeConfig } from '../engine/config.ts';
import type { DetectionConfig } from '../engine/config.ts';
import type { ReviewLabel } from '../engine/types.ts';

const dir = process.argv[2] ?? 'engine/__tests__/fixtures/real';
const files = readdirSync(dir).filter((f) => f.endsWith('.json') && !f.endsWith('.expected.json'));

interface Case {
  name: string;
  inputs: ReturnType<typeof inputsFromExport>;
  realReleases: number;
}

const cases: Case[] = files.map((f) => {
  const data = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  const labels: ReviewLabel[] = data.reviewLabels ?? [];
  let real = labels.filter((l) => l.kind === 'RELEASE' && (l.verdict === 'CORRECT' || l.verdict === 'MISSED')).length;
  const exp = join(dir, f.replace(/\.json$/, '.expected.json'));
  if (labels.length === 0 && existsSync(exp)) {
    const e = JSON.parse(readFileSync(exp, 'utf8'));
    real = (e.expect ?? []).filter((x: { type: string }) => x.type.startsWith('PARKING_RELEASED')).length;
  }
  return { name: f, inputs: inputsFromExport(data), realReleases: real };
});

// griglia dei parametri da esplorare (modificabile)
const grid: Partial<DetectionConfig>[] = [];
for (const MIN_RELEASE_CONFIDENCE of [75, 80, 85, 90]) {
  for (const MIN_DEPARTURE_DISTANCE of [40, 60, 90]) {
    for (const MIN_PARKING_DURATION_S of [90, 120, 180]) {
      grid.push({ MIN_RELEASE_CONFIDENCE, MIN_DEPARTURE_DISTANCE, MIN_PARKING_DURATION_S });
    }
  }
}

console.log(`${cases.length} test, ${grid.length} configurazioni\n`);
const rows = grid.map((o) => {
  const cfg = makeConfig(o);
  let detected = 0;
  let generated = 0;
  let real = 0;
  for (const c of cases) {
    const r = replay(c.inputs, cfg);
    const rel = r.events.filter((e) => e.type.startsWith('PARKING_RELEASED')).length;
    generated += rel;
    real += c.realReleases;
    detected += Math.min(rel, c.realReleases);
  }
  const fp = Math.max(0, generated - detected);
  return {
    config: JSON.stringify(o),
    detectionRate: real ? Math.round((detected / real) * 100) : null,
    falsePositives: fp,
    generated,
  };
});
rows.sort((a, b) => a.falsePositives - b.falsePositives || (b.detectionRate ?? 0) - (a.detectionRate ?? 0));
for (const r of rows.slice(0, 15)) {
  console.log(`rilevati ${String(r.detectionRate ?? '-').padStart(3)}%  falsi positivi ${r.falsePositives}  rilasci ${r.generated}  ${r.config}`);
}
console.log('\nNota: con pochi test i numeri non sono significativi. Servono almeno 20 partenze reali.');

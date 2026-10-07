// Test reali usati come regressione: ogni export in fixtures/real/*.json
// con il relativo *.expected.json deve continuare a dare il risultato atteso.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { replay, inputsFromExport } from '../replay.ts';
import { analyzeTestQuality } from '../analysis.ts';
import { distanceM } from '../geo.ts';
import { trace } from './helpers.ts';

const dir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'real');

interface Expected {
  expect: { type: string; relFromS: number; relToS: number }[];
  forbid: { type: string; relFromS?: number; relToS?: number }[];
  session?: { outcome: string; latitude: number; longitude: number; maxDistanceM: number; quality: string };
  finalState?: string;
  qualityWarnings?: string[];
}

for (const f of readdirSync(dir).filter((x) => x.endsWith('.json') && !x.endsWith('.expected.json'))) {
  const expPath = join(dir, f.replace(/\.json$/, '.expected.json'));
  if (!existsSync(expPath)) continue;
  test(`fixture reale ${f}`, () => {
    const exp = JSON.parse(readFileSync(expPath, 'utf8')) as Expected;
    const data = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    const inputs = inputsFromExport(data);
    const r = replay(inputs);
    const log = trace(r.events, r.t0);
    const rel = (t: number) => (t - r.t0) / 1000;

    for (const e of exp.expect) {
      const hit = r.events.find((x) => x.type === e.type && rel(x.t) >= e.relFromS && rel(x.t) <= e.relToS);
      assert.ok(hit, `atteso ${e.type} tra ${e.relFromS} e ${e.relToS} s\n${log}`);
    }
    for (const fb of exp.forbid) {
      const hit = r.events.find(
        (x) => x.type === fb.type && (fb.relFromS === undefined || (rel(x.t) >= fb.relFromS && rel(x.t) <= (fb.relToS ?? Infinity))),
      );
      assert.ok(!hit, `vietato ${fb.type}${fb.relFromS !== undefined ? ` tra ${fb.relFromS} e ${fb.relToS} s` : ''}\n${log}`);
    }
    if (exp.session) {
      const s = r.sessions.find((x) => x.outcome === exp.session!.outcome);
      assert.ok(s, `sessione ${exp.session.outcome} mancante\n${log}`);
      const d = distanceM(s!.spot.pointFinal, exp.session);
      assert.ok(d <= exp.session.maxDistanceM, `punto a ${d.toFixed(1)} m`);
      assert.equal(s!.spot.pointQuality, exp.session.quality);
    }
    if (exp.finalState) assert.equal(r.final.state, exp.finalState, log);
    if (exp.qualityWarnings) {
      const w = analyzeTestQuality({ inputs, events: r.events, sessions: r.sessions, finalState: r.final.state, stoppedAt: data.exportedAt ?? null });
      for (const code of exp.qualityWarnings) assert.ok(w.some((x) => x.code === code), `avviso ${code} mancante: ${JSON.stringify(w)}`);
    }
  });
}

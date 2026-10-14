// Per ogni partenza vera dopo una sosta a piedi: quanto prima della partenza è arrivato il primo avviso "si libera".
import { readFileSync, readdirSync } from 'node:fs';
import { replay, inputsFromExport } from '../engine/replay.ts';
import { distanceM } from '../engine/geo.ts';
import type { LocationSample } from '../engine/types.ts';
const dir = process.argv[2];
const T = (t: number) => new Date(t).toLocaleTimeString('it-IT', { timeZone: 'Europe/Rome' });
for (const f of readdirSync(dir).filter((x) => x.endsWith('.json') && !x.includes('expected'))) {
  const data = JSON.parse(readFileSync(`${dir}/${f}`, 'utf8'));
  const inputs = inputsFromExport(data);
  const r = replay(inputs);
  const locs = inputs.filter((i) => i.kind === 'location').map((i) => (i as { sample: LocationSample }).sample);
  for (const s of r.sessions) {
    if (!s.exitedOnFoot || s.endT === null || s.parkedT === null) continue;
    const evs = r.events.filter((e) => e.t >= s.parkedT! && e.t <= s.endT! + 60_000);
    const dep = evs.find((e) => e.type === 'VEHICLE_DEPARTED' || e.type === 'PARKING_RELEASED' || e.type === 'LOW_CONFIDENCE');
    const early = evs.filter((e) => e.type === 'RETURN_PREDICTED' || (e.type === 'USER_RETURNING' && e.from !== 'DEPARTURE_CANDIDATE'));
    const depT = dep?.t ?? s.endT;
    const first = early[0];
    // traccia degli ultimi 15 minuti prima della partenza: distanza dall'auto ogni minuto
    const p = s.spot.pointFinal;
    const track: string[] = [];
    for (let k = 15; k >= 0; k--) {
      const t = depT - k * 60_000;
      const near = locs.filter((l) => Math.abs(l.t - t) < 30_000);
      track.push(near.length ? String(Math.round(Math.min(...near.map((l) => distanceM(p, l))))) : '·');
    }
    console.log(`${f.slice(0, 40).padEnd(40)} park ${T(s.parkedT)} dep ${T(depT)} ${s.outcome.padEnd(14)} sosta ${Math.round((depT - s.parkedT) / 60000)}m  primo avviso: ${first ? `${first.type} ${Math.round((depT - first.t) / 1000)} s prima` : 'NESSUNO'}`);
    console.log(`   distanze -15..0 min: ${track.join(' ')}`);
  }
}

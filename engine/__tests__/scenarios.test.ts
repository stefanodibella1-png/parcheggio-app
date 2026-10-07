// Scenari automatici minimi (sezione 15 della specifica).
// Esecuzione: npm run test:engine   (node --test, nessuna dipendenza)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scenario } from '../synthetic.ts';
import { replay, normalizeInputs } from '../replay.ts';
import { DetectionEngine } from '../engine.ts';
import { analyzeTestQuality } from '../analysis.ts';
import { distanceM } from '../geo.ts';
import type { EngineInput } from '../types.ts';
import { has, releases, trace } from './helpers.ts';

function run(s: Scenario) {
  const r = replay(s.inputs);
  return { ...r, log: trace(r.events, r.t0) };
}

test('1. guida → parcheggio → ripartenza in auto → RELEASE', () => {
  const s = new Scenario().drive(300).stopInCar(180).drive(120);
  const r = run(s);
  assert.ok(has(r.events, 'PARKED'), r.log);
  const rel = releases(r.events);
  assert.equal(rel.length, 1, r.log);
  assert.equal(rel[0].type, 'PARKING_RELEASED');
  assert.ok(rel[0].scores.release >= 85, r.log);
  assert.equal(r.sessions[0].outcome, 'RELEASED');
});

test('2. guida → parcheggio → camminata → NO release', () => {
  const s = new Scenario().drive(300).stopInCar(30).walk(400);
  const r = run(s);
  assert.ok(has(r.events, 'PARKED'), r.log);
  assert.ok(has(r.events, 'PARKED_USER_AWAY'), r.log);
  assert.equal(releases(r.events).length, 0, r.log);
  assert.equal(r.sessions[0].outcome, 'OPEN');
});

test('3. guida → stop breve → guida → NO release, NO parcheggio', () => {
  const s = new Scenario().drive(200).stopInCar(30).drive(200);
  const r = run(s);
  assert.ok(has(r.events, 'VEHICLE_STOPPED'), r.log);
  assert.ok(!has(r.events, 'PARKED'), r.log);
  assert.equal(releases(r.events).length, 0, r.log);
});

test('4. parcheggio con GPS rumoroso, nessuna partenza → NO release (anche senza velocità di sistema)', () => {
  for (const noSystemSpeed of [false, true]) {
    const s = new Scenario().drive(200).stopInCar(150).stopInCar(600, { accuracy: 25, noiseM: 25, noSystemSpeed });
    const r = run(s);
    assert.ok(has(r.events, 'PARKED'), r.log);
    assert.equal(releases(r.events).length, 0, r.log);
    assert.ok(!has(r.events, 'VEHICLE_DEPARTED'), r.log);
  }
});

test('5. parcheggio → camminata lenta che si allontana → NO release', () => {
  const s = new Scenario().drive(300).stopInCar(150).walk(600, 45, 2.5);
  const r = run(s);
  assert.equal(releases(r.events).length, 0, r.log);
  assert.ok(has(r.events, 'PARKED_USER_AWAY'), r.log);
});

test('6. flusso B: a piedi via → ritorno dopo un\'ora → partenza dal punto → RELEASE + previsione di ritorno', () => {
  const s = new Scenario().drive(300).stopInCar(150).walk(300, 0).stand(60).silence(3600).walk(300, 180).stopInCar(30).drive(120, 35, 90);
  const r = run(s);
  assert.ok(has(r.events, 'PARKED_USER_AWAY'), r.log);
  assert.ok(has(r.events, 'RETURN_PREDICTED'), r.log);
  assert.ok(has(r.events, 'USER_RETURNING'), r.log);
  const rel = releases(r.events);
  assert.equal(rel.length, 1, r.log);
  assert.equal(rel[0].type, 'PARKING_RELEASED');
  const pred = r.events.find((e) => e.type === 'RETURN_PREDICTED')!;
  assert.ok(rel[0].t - pred.t > 60_000, 'la previsione deve anticipare il rilascio');
});

test('7. flusso C: a piedi via → sale su un veicolo lontano → NO release, LOW_CONFIDENCE', () => {
  const s = new Scenario().drive(300).stopInCar(150).walk(300, 0).stand(120).drive(300, 40, 0);
  const r = run(s);
  assert.equal(releases(r.events).length, 0, r.log);
  const low = r.events.filter((e) => e.type === 'LOW_CONFIDENCE');
  assert.equal(low.length, 1, r.log);
  assert.match(low[0].reason, /lontano dal punto di parcheggio/);
  assert.equal(r.sessions[0].outcome, 'OPEN');
});

test('8. coda con avanzamenti a scatti → NO parcheggio', () => {
  const s = new Scenario().drive(200).stopAndGo(12).drive(100);
  const r = run(s);
  assert.ok(!has(r.events, 'PARKED'), r.log);
  assert.equal(releases(r.events).length, 0, r.log);
});

test('9. GPS perso durante la partenza, poi recuperato lontano → comportamento definito', () => {
  // definito: il rilascio avviene, ma la continuità è penalizzata e annotata
  const s = new Scenario().drive(300).stopInCar(180).drive(3).drive(40, 35, 90, { gpsLost: true }).drive(60);
  const r = run(s);
  const rel = releases(r.events);
  const low = r.events.filter((e) => e.type === 'LOW_CONFIDENCE');
  assert.equal(rel.length + low.length, 1, r.log);
  assert.notEqual(r.sessions[0].outcome, 'OPEN', r.log);
  const ev = rel[0] ?? low[0];
  assert.ok(ev.data.checks?.some((c) => /interruzioni|GPS perso/.test(c)), r.log);
});

test('10. activity errata (IN_VEHICLE mentre si cammina) → nessun veicolo, nessun release', () => {
  const s = new Scenario().walk(600, 0, 4.5, { activity: 'IN_VEHICLE', activityConfidence: 95 });
  const r = run(s);
  assert.ok(!has(r.events, 'IN_VEHICLE'), r.log);
  assert.equal(releases(r.events).length, 0, r.log);
});

test('11. flusso E (cold start): camminata → fermo 50 s → partenza → PARKING_RELEASED_INFERRED', () => {
  const s = new Scenario().walk(120).stopInCar(50);
  const carPoint = s.position;
  s.drive(120);
  const r = run(s);
  const rel = releases(r.events);
  assert.equal(rel.length, 1, r.log);
  assert.equal(rel[0].type, 'PARKING_RELEASED_INFERRED');
  const sess = r.sessions[0];
  assert.equal(sess.outcome, 'RELEASED_INFERRED');
  assert.ok(distanceM(sess.spot.pointFinal, carPoint) < 10, `punto a ${distanceM(sess.spot.pointFinal, carPoint)} m`);
});

test('12. fix a 100–200 m che simulano un salto a 20 km/h → nessun IN_VEHICLE', () => {
  const s = new Scenario().stand(60, { accuracy: 60 }).drive(40, 20, 270, { accuracy: 150, noiseM: 50, activity: 'UNKNOWN', activityConfidence: 40, steps: 0 }).stand(60, { accuracy: 60 });
  const r = run(s);
  assert.ok(!has(r.events, 'IN_VEHICLE'), r.log);
});

test('13. activity alternata IN_VEHICLE / UNKNOWN 40 in guida → resta VEHICLE_MOVING', () => {
  const s = new Scenario().drive(400);
  let k = 0;
  for (const i of s.inputs) {
    if (i.kind === 'activity' && k++ % 2 === 1) {
      i.sample.activity = 'UNKNOWN';
      i.sample.confidence = 40;
    }
  }
  const r = run(s);
  assert.deepEqual(r.events.map((e) => e.to), ['IN_VEHICLE', 'VEHICLE_MOVING'], r.log);
});

test('14. input fuori ordine o duplicati → stesso risultato', () => {
  const s = new Scenario().drive(300).stopInCar(180).drive(120);
  const ordered = replay(s.inputs);
  const messy: EngineInput[] = [...s.inputs];
  for (let i = 0; i + 1 < messy.length; i += 7) [messy[i], messy[i + 1]] = [messy[i + 1], messy[i]];
  for (let i = 0; i < messy.length; i += 11) messy.push(JSON.parse(JSON.stringify(messy[i])));
  const r = replay(messy);
  assert.ok(normalizeInputs(messy).stats.duplicates > 0);
  assert.deepEqual(r.events.map((e) => [e.type, e.t]), ordered.events.map((e) => [e.type, e.t]));
});

test('15. punto di parcheggio: arrivo impreciso (25 m) e partenza precisa (3 m) → entro 5 m, qualità A', () => {
  const s = new Scenario().drive(300).stopInCar(150, { accuracy: 25, noiseM: 15 });
  const truth = s.position;
  s.stopInCar(60, { accuracy: 3, noiseM: 1 }).drive(120);
  const r = run(s);
  const sess = r.sessions[0];
  assert.equal(sess.outcome, 'RELEASED', r.log);
  assert.ok(sess.spot.pointAtPark && sess.spot.pointAtDeparture);
  const d = distanceM(sess.spot.pointFinal, truth);
  assert.ok(d <= 5, `pointFinal a ${d.toFixed(1)} m dal punto vero`);
  assert.equal(sess.spot.pointQuality, 'A');
});

test('16. test fermato 19 s dopo l\'ultima sosta → nessun PARKED, avviso di qualità', () => {
  const s = new Scenario().drive(300).stopInCar(19);
  const r = run(s);
  assert.ok(!has(r.events, 'PARKED'), r.log);
  const w = analyzeTestQuality({ inputs: s.inputs, events: r.events, sessions: r.sessions, finalState: r.final.state, stoppedAt: s.t });
  assert.ok(w.some((x) => x.code === 'SHORT_FINAL_STOP'), JSON.stringify(w));
});

test('stato serializzabile: riavvio a metà test → stesso risultato', () => {
  const s = new Scenario().drive(300).stopInCar(180).drive(120);
  const { inputs } = normalizeInputs(s.inputs);
  const half = Math.floor(inputs.length * 0.55);
  let e = new DetectionEngine();
  const ev1 = [];
  for (const i of inputs.slice(0, half)) ev1.push(...e.process(i));
  e = DetectionEngine.restore(e.serialize());
  for (const i of inputs.slice(half)) ev1.push(...e.process(i));
  const ref = replay(s.inputs, undefined, 'T');
  assert.deepEqual(ev1.map((x) => x.type), ref.events.map((x) => x.type));
});

test('arrivo con direzione di marcia e indirizzo impostabile senza influenzare il rilevamento', () => {
  const s = new Scenario().drive(300, 35, 90).stopInCar(150);
  const e = new DetectionEngine();
  for (const i of normalizeInputs(s.inputs).inputs) e.process(i);
  const sess = e.getOpenSession()!;
  assert.ok(sess.spot.arrivalHeading !== null && Math.abs(sess.spot.arrivalHeading - 90) < 5);
  e.setSpotAddress(sess.parkingId, {
    address: { street: 'Via Etnea', streetNumber: '123', postalCode: '95131', district: null, city: 'Catania', province: 'CT', formatted: 'Via Etnea 123, 95131 Catania' },
    addressSource: 'test',
    addressDistanceM: 8,
    geocodedAt: s.t,
    geocodeStatus: 'OK',
  });
  assert.equal(e.getOpenSession()!.spot.address?.street, 'Via Etnea');
  assert.equal(e.state, 'PARKED');
});

test('17. sceso ed entrato in casa senza camminata riconosciuta (telefono in tasca, GPS indoor) → PARKED_USER_AWAY, nessun rilascio', () => {
  const quiet = { activity: 'UNKNOWN' as const, activityConfidence: 40, steps: 0 };
  const s = new Scenario().drive(300).stopInCar(150).walk(60, 0, 4.5, quiet).stand(300, { ...quiet, accuracy: 20, noiseM: 15 });
  const r = run(s);
  assert.ok(has(r.events, 'PARKED'), r.log);
  assert.equal(r.final.state, 'PARKED_USER_AWAY', r.log);
  assert.equal(releases(r.events).length, 0, r.log);
  // più tardi torna all'auto e riparte: il rilascio deve arrivare
  s.walk(60, 180, 4.5).stopInCar(30).drive(120, 35, 90);
  const r2 = run(s);
  assert.equal(releases(r2.events).length, 1, r2.log);
});

test('18. giri attorno agli isolati prima di parcheggiare → PARKING_SEARCH e durata della ricerca', () => {
  const s = new Scenario().drive(300, 40, 90).circleBlocks(3, 30, 15).stopInCar(150);
  const r = run(s);
  const search = r.events.find((e) => e.type === 'PARKING_SEARCH');
  const parked = r.events.find((e) => e.type === 'PARKED');
  assert.ok(search && parked && search.t < parked.t, r.log);
  const sess = r.sessions[0];
  assert.ok((sess.searchDurationS ?? 0) >= 120, `ricerca di ${sess.searchDurationS} s`);
  assert.ok((sess.searchDistanceM ?? 0) >= 300, `ricerca di ${sess.searchDistanceM} m`);
});

test('19. coda o guida lenta in linea retta → nessuna ricerca di parcheggio', () => {
  for (const s of [new Scenario().drive(200).stopAndGo(15).drive(100), new Scenario().drive(600, 15, 90)]) {
    const r = run(s);
    assert.ok(!has(r.events, 'PARKING_SEARCH'), r.log);
  }
});

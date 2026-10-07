// REVISIONE (a posteriori, solo per il tester) e dettaglio evento.
// Le etichette servono solo alle metriche: il motore non le legge mai.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import type { DetectionEvent, LocationSample, ReviewLabel, ReviewVerdict } from '../../../engine/types.ts';
import { isRelease } from '../../../engine/analysis.ts';
import * as db from '../../storage/db.ts';
import { host } from '../../host/EngineHost.ts';
import { Button, Card, Empty, Label, Row, SectionTitle, Title } from '../components/basics.tsx';
import { MapPanel } from '../components/MapPanel.tsx';
import { addressLine } from '../components/live.tsx';
import { loadTestData, type TestData } from './SummaryScreen.tsx';
import { fmtDate, fmtNum, fmtTime } from '../format.ts';
import { FAMILY_COLORS, STATE_TEXT, familyOf, space, usePalette } from '../theme.ts';
import type { Nav } from '../nav.ts';

interface Item {
  id: string; // targetId
  kind: ReviewLabel['kind'];
  t: number;
  title: string;
  subtitle: string;
  event: DetectionEvent | null;
}

export function ReviewScreen({ testId, nav }: { testId: string; nav: Nav }) {
  const c = usePalette();
  const [d, setD] = useState<TestData | null>(null);
  const [labels, setLabels] = useState<ReviewLabel[]>([]);
  const [idx, setIdx] = useState(0);
  const [addMode, setAddMode] = useState(false);

  const reload = useCallback(async () => {
    setD(await loadTestData(testId));
    setLabels(await db.getLabels(testId));
  }, [testId]);
  useEffect(() => {
    void reload();
  }, [reload]);

  const items: Item[] = useMemo(() => {
    if (!d) return [];
    const out: Item[] = [];
    for (const s of d.sessions) {
      out.push({
        id: s.parkingId,
        kind: 'PARKING',
        t: s.parkedT ?? s.startT,
        title: s.inferred ? 'Parcheggio dedotto (auto già lì)' : 'Parcheggio rilevato',
        subtitle: addressLine(s.spot),
        event: d.events.find((e) => e.parkingId === s.parkingId && (e.type === 'PARKED' || e.type === 'VEHICLE_DEPARTED')) ?? null,
      });
    }
    for (const e of d.events.filter(isRelease)) {
      const s = d.sessions.find((x) => x.parkingId === e.parkingId);
      out.push({
        id: e.id,
        kind: 'RELEASE',
        t: e.t,
        title: STATE_TEXT[e.type].label,
        subtitle: `${s ? addressLine(s.spot) : ''} · confidence ${fmtNum(e.scores.release)}`,
        event: e,
      });
    }
    return out.sort((a, b) => a.t - b.t);
  }, [d]);

  if (!d) return <View style={{ flex: 1, backgroundColor: c.bg }} />;
  const missed = labels.filter((l) => l.verdict === 'MISSED');
  const cur = items[idx] ?? null;
  const curLabel = cur ? labels.find((l) => l.targetId === cur.id) : undefined;
  const spot = cur ? d.sessions.find((s) => s.parkingId === (cur.kind === 'PARKING' ? cur.id : cur.event?.parkingId))?.spot ?? null : null;

  const setVerdict = async (verdict: ReviewVerdict) => {
    if (!cur) return;
    await db.upsertLabel({
      id: `L-${cur.id}`,
      testId,
      targetId: cur.id,
      kind: cur.kind,
      verdict,
      t: cur.t,
      createdAt: Date.now(),
    });
    await reload();
    if (idx < items.length - 1) setIdx(idx + 1);
  };

  const addMissed = async (p: LocationSample) => {
    setAddMode(false);
    Alert.alert('Partenza mancata?', `Alle ${fmtTime(p.t)} in questo punto sei ripartito da un parcheggio e l'app non l'ha rilevato?`, [
      { text: 'No', style: 'cancel' },
      {
        text: 'Sì, aggiungi',
        onPress: async () => {
          await db.upsertLabel({ id: `L-M-${p.t}`, testId, targetId: null, kind: 'RELEASE', verdict: 'MISSED', t: p.t, latitude: p.latitude, longitude: p.longitude, createdAt: Date.now() });
          await reload();
        },
      },
    ]);
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.bg }} contentContainerStyle={{ padding: space.lg, paddingBottom: 60 }}>
      <Pressable onPress={nav.back}><Label color={c.accent}>‹ Indietro</Label></Pressable>
      <Title>Revisione</Title>
      <Label dim>{fmtDate(d.test.startedAt)} · conferma sulla mappa cosa è successo davvero.</Label>

      {items.length === 0 ? <Empty text="Nessun parcheggio o rilascio da rivedere in questo test." /> : null}
      {cur ? (
        <>
          <SectionTitle right={<Label dim size={13}>{idx + 1} di {items.length}</Label>}>{cur.kind === 'RELEASE' ? 'Rilascio' : 'Parcheggio'}</SectionTitle>
          <MapPanel track={d.track} events={d.events} spot={spot} accuracyLimit={d.test.config.GPS_ACCURACY_LIMIT} height={280} highlightT={cur.t} />
          <Card style={{ marginTop: space.md }} accent={FAMILY_COLORS[cur.kind === 'RELEASE' ? 'released' : 'parking']}>
            <Text style={{ color: c.text, fontSize: 18, fontWeight: '700' }}>{cur.title}</Text>
            <Label dim size={13}>{fmtTime(cur.t)} · {cur.subtitle}</Label>
            {cur.event ? <Label size={13} style={{ marginTop: space.sm }}>{cur.event.reason}</Label> : null}
            {curLabel ? (
              <Label size={13} color={curLabel.verdict === 'CORRECT' ? c.ok : c.danger} style={{ marginTop: space.sm }}>
                Già etichettato: {curLabel.verdict === 'CORRECT' ? 'corretto' : 'falso positivo'}
              </Label>
            ) : null}
          </Card>
          <View style={{ flexDirection: 'row', gap: space.md, marginTop: space.md }}>
            <Button title="✓ Corretto" variant="ok" style={{ flex: 1 }} onPress={() => setVerdict('CORRECT')} />
            <Button title="✕ Falso positivo" variant="danger" style={{ flex: 1 }} onPress={() => setVerdict('FALSE_POSITIVE')} />
          </View>
          <View style={{ flexDirection: 'row', gap: space.md, marginTop: space.sm }}>
            <Button small variant="ghost" title="‹ Precedente" disabled={idx === 0} style={{ flex: 1 }} onPress={() => setIdx(idx - 1)} />
            <Button small variant="ghost" title="Successivo ›" disabled={idx >= items.length - 1} style={{ flex: 1 }} onPress={() => setIdx(idx + 1)} />
          </View>
        </>
      ) : null}

      <SectionTitle>Partenze mancate ({missed.length})</SectionTitle>
      <Card>
        <Label dim size={13}>
          Se sei ripartito da un parcheggio e l'app non l'ha segnalato, aggiungilo toccando il punto sulla traccia.
        </Label>
        {missed.map((l) => (
          <View key={l.id} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: space.sm }}>
            <Label>{fmtTime(l.t)}</Label>
            <Button small variant="ghost" title="Rimuovi" onPress={async () => { await db.deleteLabel(l.id); await reload(); }} />
          </View>
        ))}
        {addMode ? (
          <View style={{ marginTop: space.md }}>
            <Label color={c.accent} size={13}>Tocca la traccia nel punto della partenza</Label>
            <View style={{ marginTop: space.sm }}>
              <MapPanel track={d.track} events={d.events} accuracyLimit={d.test.config.GPS_ACCURACY_LIMIT} height={300} onPressPoint={addMissed} />
            </View>
          </View>
        ) : (
          <Button small title="Aggiungi partenza mancata" style={{ marginTop: space.md }} onPress={() => setAddMode(true)} />
        )}
      </Card>
    </ScrollView>
  );
}

export function EventDetailScreen({ eventId, testId, nav }: { eventId: string; testId: string | null; nav: Nav }) {
  const c = usePalette();
  const [e, setE] = useState<DetectionEvent | null>(null);
  const [track, setTrack] = useState<LocationSample[]>([]);
  const [events, setEvents] = useState<DetectionEvent[]>([]);
  useEffect(() => {
    void (async () => {
      await host.flush(false);
      const all = testId ? await db.getEvents(testId) : await db.getEvents();
      const found = all.find((x) => x.id === eventId) ?? null;
      setE(found);
      if (!found) return;
      const tid = testId ?? found.id.split('-E')[0];
      const evs = await db.getEvents(tid);
      setEvents(evs);
      const locs = await db.getLocationInputs(tid);
      setTrack(
        locs
          .map((i) => (i.kind === 'location' ? i.sample : null))
          .filter((x): x is LocationSample => x !== null && Math.abs(x.t - found.t) <= 10 * 60_000),
      );
    })();
  }, [eventId, testId]);
  if (!e) return <View style={{ flex: 1, backgroundColor: c.bg }} />;
  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.bg }} contentContainerStyle={{ padding: space.lg, paddingBottom: 60 }}>
      <Pressable onPress={nav.back}><Label color={c.accent}>‹ Indietro</Label></Pressable>
      <Card accent={FAMILY_COLORS[familyOf(e.type)]} style={{ marginTop: space.md }}>
        <Text style={{ color: c.text, fontSize: 20, fontWeight: '800' }}>{e.type}</Text>
        <Label dim>{fmtTime(e.t)} · {e.from} → {e.to}</Label>
        <Label style={{ marginTop: space.md }}>{e.reason}</Label>
      </Card>
      {e.data.checks && e.data.checks.length ? (
        <>
          <SectionTitle>Motivazioni</SectionTitle>
          <Card>
            {e.data.checks.map((x, i) => (
              <Label key={i} color={x.startsWith('✓') ? c.ok : x.startsWith('✗') ? c.warn : c.textDim} style={{ paddingVertical: 2 }}>{x}</Label>
            ))}
          </Card>
        </>
      ) : null}
      <SectionTitle>Dati</SectionTitle>
      <Card>
        <Row k="Velocità" v={e.data.speedKmh === null ? '–' : `${fmtNum(e.data.speedKmh, 1)} km/h`} />
        <Row k="Distanza dal parcheggio" v={e.data.distanceM === null ? '–' : `${e.data.distanceM} m`} />
        <Row k="GPS" v={e.data.gpsAccuracyM === null ? '–' : `±${fmtNum(e.data.gpsAccuracyM, 1)} m${e.data.gpsValid ? '' : ' (scartato)'} · ${e.data.gpsAgeS ?? '–'} s prima`} />
        <Row k="Activity" v={e.data.activity ?? '–'} />
        <Row k="Coordinate" v={e.data.latitude === null ? '–' : `${e.data.latitude.toFixed(6)}, ${e.data.longitude?.toFixed(6)}`} />
        <Row k="Campioni usati" v={String(e.sampleRefs.length)} />
        <Row k="Parcheggio" v={e.parkingId ?? '–'} />
      </Card>
      <SectionTitle>Score</SectionTitle>
      <Card>
        {Object.entries(e.scores).map(([k, v]) => (
          <Row key={k} k={k} v={fmtNum(v)} />
        ))}
      </Card>
      <SectionTitle>Mappa (±10 min)</SectionTitle>
      <MapPanel track={track} events={events} height={260} highlightT={e.t} />
    </ScrollView>
  );
}

import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import type { DetectionEvent, LocationSample, ParkingSession, ReviewLabel } from '../../../engine/types.ts';
import { host } from '../../host/EngineHost.ts';
import * as db from '../../storage/db.ts';
import { Card, Empty, Label, Pill, Row, SectionTitle, Title } from '../components/basics.tsx';
import { CarCard, addressLine, useHost, useNow } from '../components/live.tsx';
import { MapPanel } from '../components/MapPanel.tsx';
import { fmtDate, fmtDuration, fmtTime } from '../format.ts';
import { FAMILY_COLORS, STATE_TEXT, familyOf, space, usePalette } from '../theme.ts';
import type { Nav } from '../nav.ts';

type S = ParkingSession & { testId: string };

const OUTCOME: Record<ParkingSession['outcome'], { text: string; color: string }> = {
  OPEN: { text: 'aperto', color: FAMILY_COLORS.parking },
  RELEASED: { text: 'liberato', color: FAMILY_COLORS.released },
  RELEASED_INFERRED: { text: 'liberato (dedotto)', color: FAMILY_COLORS.released },
  ABANDONED: { text: 'annullato', color: FAMILY_COLORS.unknown },
  LOW_CONFIDENCE: { text: 'bassa confidence', color: FAMILY_COLORS.unknown },
};

export function ParkingsScreen({ nav }: { nav: Nav }) {
  const c = usePalette();
  const h = useHost();
  const [list, setList] = useState<S[]>([]);
  const [labels, setLabels] = useState<ReviewLabel[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      await host.flush(false);
      const [s, l] = await Promise.all([db.getSessions(), db.getLabels()]);
      setList(s.sort((a, b) => b.startT - a.startT));
      setLabels(l);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load, h.sessions.length]);

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: 40 }} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
      <Title>Parcheggi</Title>
      <Label dim>Tutti i parcheggi rilevati nei test, con indirizzo ed esito.</Label>
      {list.length === 0 ? <Empty text="Nessun parcheggio ancora." /> : null}
      {list.map((s) => {
        const o = OUTCOME[s.outcome];
        const l = labels.find((x) => x.targetId === s.parkingId);
        const review = l ? (l.verdict === 'CORRECT' ? 'confermato' : l.verdict === 'FALSE_POSITIVE' ? 'falso positivo' : 'mancato') : s.outcome === 'OPEN' ? null : 'da rivedere';
        return (
          <Pressable key={s.parkingId} onPress={() => nav.push({ name: 'parking', parkingId: s.parkingId })} style={{ marginTop: space.md }}>
            <Card accent={o.color}>
              <Text style={{ color: c.text, fontSize: 17, fontWeight: '700' }} numberOfLines={2}>{addressLine(s.spot)}</Text>
              <Label dim size={13} style={{ marginTop: 2 }}>
                {fmtDate(s.startT)} · {s.durationS !== null ? fmtDuration(s.durationS * 1000) : 'in corso'} · punto {s.spot.pointQuality} ±{Math.round(s.spot.pointFinal.accuracyM)} m
              </Label>
              <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.sm, flexWrap: 'wrap' }}>
                <Pill text={o.text} color={o.color} />
                {review ? <Pill text={review} color={l ? (l.verdict === 'CORRECT' ? c.ok : c.danger) : c.warn} /> : null}
                {s.spot.recurringSpot ? <Pill text="abituale" color={c.textDim} /> : null}
              </View>
            </Card>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

export function ParkingDetailScreen({ parkingId, nav }: { parkingId: string; nav: Nav }) {
  const c = usePalette();
  const now = useNow(5000);
  const [s, setS] = useState<S | null>(null);
  const [events, setEvents] = useState<DetectionEvent[]>([]);
  const [track, setTrack] = useState<LocationSample[]>([]);
  const [limit, setLimit] = useState(30);
  useEffect(() => {
    void (async () => {
      const all = await db.getSessions();
      const found = all.find((x) => x.parkingId === parkingId) ?? null;
      setS(found);
      if (!found) return;
      const t = await db.getTest(found.testId);
      if (t) setLimit(t.config.GPS_ACCURACY_LIMIT);
      const ev = await db.getEvents(found.testId);
      setEvents(ev);
      const from = found.startT - 5 * 60_000;
      const to = (found.endT ?? Date.now()) + 5 * 60_000;
      const locs = await db.getLocationInputs(found.testId);
      setTrack(locs.map((i) => (i.kind === 'location' ? i.sample : null)).filter((x): x is LocationSample => x !== null && x.t >= from && x.t <= to));
    })();
  }, [parkingId]);
  if (!s) return <View style={{ flex: 1, backgroundColor: c.bg }} />;
  const sp = s.spot;
  const related = events.filter((e) => e.parkingId === parkingId);
  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.bg }} contentContainerStyle={{ padding: space.lg, paddingBottom: 60 }}>
      <Pressable onPress={nav.back}><Label color={c.accent}>‹ Indietro</Label></Pressable>
      <View style={{ marginTop: space.md }}>
        <CarCard session={s} distanceM={null} now={s.endT ?? now} />
      </View>
      <SectionTitle>Mappa</SectionTitle>
      <MapPanel track={track} events={events} spot={sp} accuracyLimit={limit} height={300} />
      <Label dim size={12} style={{ marginTop: 4 }}>🅿️ punto finale · blu: punto all'arrivo · verde: punto alla partenza</Label>
      <SectionTitle>Dettagli del punto</SectionTitle>
      <Card>
        <Row k="Esito" v={OUTCOME[s.outcome].text} />
        <Row k="Coordinate" v={`${sp.pointFinal.latitude.toFixed(6)}, ${sp.pointFinal.longitude.toFixed(6)}`} />
        <Row k="Precisione / qualità" v={`±${sp.pointFinal.accuracyM} m · ${sp.pointQuality}`} />
        <Row k="Punto all'arrivo" v={sp.pointAtPark ? `±${sp.pointAtPark.accuracyM} m (${sp.pointAtPark.fixes} fix)` : '–'} />
        <Row k="Punto alla partenza" v={sp.pointAtDeparture ? `±${sp.pointAtDeparture.accuracyM} m (${sp.pointAtDeparture.fixes} fix)` : '–'} />
        {sp.pointsDisagreeM !== null ? <Row k="Punti discordanti" v={`${sp.pointsDisagreeM} m`} vColor={c.warn} /> : null}
        <Row k="Direzione di arrivo" v={sp.arrivalHeading === null ? '–' : `${sp.arrivalHeading}°`} />
        <Row k="Direzione di partenza" v={sp.departureHeading === null ? '–' : `${sp.departureHeading}°`} />
        <Row k="Indirizzo" v={sp.address?.formatted ?? sp.geocodeStatus} />
        <Row k="Quartiere" v={sp.address?.district ?? '–'} />
        <Row k="Fonte indirizzo" v={sp.addressSource ?? '–'} />
        <Row k="Distanza indirizzo–punto" v={sp.addressDistanceM === null ? '–' : `${sp.addressDistanceM} m`} />
        <Row k="Confidence rilascio" v={s.releaseConfidence === null ? '–' : String(Math.round(s.releaseConfidence))} />
 <Row k="Ricerca del posto prima della sosta" v={s.searchDurationS ? `${fmtDuration(s.searchDurationS * 1000)} · ${s.searchDistanceM ?? '–'} m` : 'non rilevata'} />
        <Row k="Partenza reale (dalla traccia)" v={s.realDepartureT ? fmtTime(s.realDepartureT) : '–'} />
      </Card>
      <SectionTitle>Eventi</SectionTitle>
      <Card>
        {related.length === 0 ? <Label dim>Nessun evento collegato</Label> : null}
        {related.map((e) => (
          <Pressable key={e.id} onPress={() => nav.push({ name: 'event', eventId: e.id, testId: s.testId })} style={{ paddingVertical: 6 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: FAMILY_COLORS[familyOf(e.type)], marginRight: space.md }} />
              <Label dim size={13} style={{ width: 70 }}>{fmtTime(e.t)}</Label>
              <Label style={{ flex: 1 }}>{STATE_TEXT[e.type].label}</Label>
            </View>
          </Pressable>
        ))}
      </Card>
    </ScrollView>
  );
}

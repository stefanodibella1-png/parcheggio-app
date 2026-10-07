import React, { useEffect, useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { distanceM } from '../../../engine/geo.ts';
import type { DetectionEvent, LocationSample, ParkingSession, QualityWarning } from '../../../engine/types.ts';
import { host } from '../../host/EngineHost.ts';
import { shareExport, type ExportKind } from '../../services/exportTest.ts';
import * as db from '../../storage/db.ts';
import { Button, Card, Label, Row, SectionTitle, Title } from '../components/basics.tsx';
import { MapPanel } from '../components/MapPanel.tsx';
import { addressLine } from '../components/live.tsx';
import { fmtDate, fmtDistance, fmtDuration, fmtNum } from '../format.ts';
import { space, usePalette } from '../theme.ts';
import type { Nav } from '../nav.ts';

export interface TestData {
  test: db.TestRow;
  events: DetectionEvent[];
  sessions: ParkingSession[];
  track: LocationSample[];
}

export async function loadTestData(testId: string): Promise<TestData | null> {
  const test = await db.getTest(testId);
  if (!test) return null;
  const [events, sessions, locs] = await Promise.all([db.getEvents(testId), db.getSessions(testId), db.getLocationInputs(testId)]);
  const track = locs.map((i) => (i.kind === 'location' ? i.sample : null)).filter((x): x is LocationSample => x !== null);
  return { test, events, sessions, track };
}

export function ExportButtons({ testId }: { testId: string }) {
  const [busy, setBusy] = useState<ExportKind | null>(null);
  const go = async (k: ExportKind) => {
    setBusy(k);
    try {
      await shareExport(testId, k);
    } catch (e) {
      Alert.alert('Esportazione non riuscita', String(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <View style={{ gap: space.sm }}>
      <Button title="Esporta JSON completo" busy={busy === 'json'} onPress={() => go('json')} />
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        <Button small variant="ghost" title="CSV campioni" busy={busy === 'csv'} style={{ flex: 1 }} onPress={() => go('csv')} />
        <Button small variant="ghost" title="CSV parcheggi" busy={busy === 'parkings'} style={{ flex: 1 }} onPress={() => go('parkings')} />
      </View>
    </View>
  );
}

export function WarningsCard({ warnings }: { warnings: QualityWarning[] }) {
  const c = usePalette();
  if (warnings.length === 0) {
    return (
      <Card>
        <Label color={c.ok}>✓ Nessun problema di qualità rilevato</Label>
      </Card>
    );
  }
  return (
    <Card>
      {warnings.map((w) => (
        <View key={w.code} style={{ flexDirection: 'row', paddingVertical: 5 }}>
          <Label color={w.severity === 'warning' ? c.warn : c.textDim} style={{ width: 22 }}>{w.severity === 'warning' ? '⚠︎' : 'ℹ︎'}</Label>
          <Label style={{ flex: 1 }} size={14}>{w.message}</Label>
        </View>
      ))}
    </Card>
  );
}

export function SummaryScreen({ testId, nav }: { testId: string; nav: Nav }) {
  const c = usePalette();
  const [d, setD] = useState<TestData | null>(null);
  useEffect(() => {
    void loadTestData(testId).then(setD);
  }, [testId]);
  if (!d) return <View style={{ flex: 1, backgroundColor: c.bg }} />;

  const { test, events, sessions, track } = d;
  const valid = track.filter((p) => p.accuracy <= test.config.GPS_ACCURACY_LIMIT);
  let km = 0;
  for (let i = 1; i < valid.length; i++) {
    const dd = distanceM(valid[i - 1], valid[i]);
    if (dd < 200) km += dd;
  }
  const releases = events.filter((e) => e.type === 'PARKING_RELEASED' || e.type === 'PARKING_RELEASED_INFERRED');
  const lows = events.filter((e) => e.type === 'LOW_CONFIDENCE');
  const parked = events.filter((e) => e.type === 'PARKED').length + sessions.filter((s) => s.inferred).length;
  const avgAcc = track.length ? track.reduce((s, p) => s + p.accuracy, 0) / track.length : null;
  const dur = (test.stoppedAt ?? Date.now()) - test.startedAt;
  const mainSpot = sessions[0]?.spot ?? null;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.bg }} contentContainerStyle={{ padding: space.lg, paddingBottom: 60 }}>
      <Title>Riepilogo test</Title>
      <Label dim>{fmtDate(test.startedAt)} · {test.meta.deviceModel ?? test.platform}</Label>

      <SectionTitle>Numeri</SectionTitle>
      <Card>
        <Row k="Durata" v={fmtDuration(dur)} />
        <Row k="Distanza percorsa" v={fmtDistance(km)} />
        <Row k="Parcheggi rilevati" v={String(parked)} />
        <Row k="Posti probabilmente liberati" v={String(releases.length)} vColor={releases.length ? c.ok : undefined} />
        <Row k="Eventi a bassa confidence" v={String(lows.length)} />
        <Row k="Precisione GPS media" v={avgAcc === null ? '–' : `±${fmtNum(avgAcc)} m`} />
      </Card>

      <SectionTitle>Mappa</SectionTitle>
      <MapPanel track={track} events={events} spot={mainSpot} accuracyLimit={test.config.GPS_ACCURACY_LIMIT} height={300} />

      {sessions.length > 0 ? (
        <>
          <SectionTitle>Parcheggi</SectionTitle>
          {sessions.map((s) => (
            <View key={s.parkingId} style={{ marginBottom: space.sm }}>
              <Button variant="ghost" title={`${s.outcome === 'OPEN' ? '🅿️' : '✅'} ${addressLine(s.spot)}`} onPress={() => nav.push({ name: 'parking', parkingId: s.parkingId })} />
            </View>
          ))}
        </>
      ) : null}

      <SectionTitle>Qualità del test</SectionTitle>
      <WarningsCard warnings={test.quality} />

      <View style={{ gap: space.sm, marginTop: space.xl }}>
        <Button title="Rivedi ora" variant="ok" onPress={() => nav.push({ name: 'review', testId })} />
        <ExportButtons testId={testId} />
        <Button
          title="Chiudi"
          variant="ghost"
          onPress={async () => {
            nav.back();
            await host.afterSummary();
          }}
        />
      </View>
    </ScrollView>
  );
}

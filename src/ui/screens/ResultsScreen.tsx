import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { computeMetrics, type Metrics, type TestRecord } from '../../../engine/analysis.ts';
import * as db from '../../storage/db.ts';
import { Button, Card, Empty, Label, Pill, Row, SectionTitle, Title } from '../components/basics.tsx';
import { SCENARIOS } from '../scenarios.ts';
import { fmtDate, fmtDuration, fmtNum } from '../format.ts';
import { space, usePalette } from '../theme.ts';
import type { Nav } from '../nav.ts';

export function ResultsScreen({ nav }: { nav: Nav }) {
  const c = usePalette();
  const [tests, setTests] = useState<db.TestRow[]>([]);
  const [m, setM] = useState<{ all: Metrics; byPlatform: Record<string, Metrics> } | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const ts = (await db.listTests()).filter((t) => t.stoppedAt !== null);
      const evByTest = await db.getEventsByTest();
      const sessions = await db.getSessions();
      const labels = await db.getLabels();
      const records: TestRecord[] = ts.map((t) => ({
        testId: t.id,
        platform: t.platform,
        events: evByTest.get(t.id) ?? [],
        sessions: sessions.filter((s) => s.testId === t.id),
        labels: labels.filter((l) => l.testId === t.id),
      }));
      const byPlatform: Record<string, Metrics> = {};
      for (const p of ['ios', 'android']) {
        const r = records.filter((x) => x.platform === p);
        if (r.length) byPlatform[p] = computeMetrics(r);
      }
      setTests(ts);
      setM({ all: computeMetrics(records), byPlatform });
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const coverage = SCENARIOS.map((s) => ({ ...s, n: tests.filter((t) => t.meta.scenarios?.includes(s.id)).length }));

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: 40 }} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
      <Title>Risultati</Title>
      <Label dim>La domanda del prototipo: su N parcheggi liberati davvero, quanti ne rileva e quanti falsi positivi genera?</Label>

      {m ? (
        <>
          <View style={{ flexDirection: 'row', gap: space.md, marginTop: space.lg }}>
            <BigStat label="Rilevamento" value={m.all.detectionRate} sub={`${m.all.releasesCorrect} su ${m.all.realDepartures} partenze reali`} good />
            <BigStat label="Falsi positivi" value={m.all.falsePositiveRate} sub={`${m.all.falsePositives} su ${m.all.releasesCorrect + m.all.falsePositives} rilasci rivisti`} />
          </View>
          {m.all.toReview > 0 ? (
            <Card style={{ marginTop: space.md, borderColor: c.warn }}>
              <Label color={c.warn}>{m.all.toReview} rilasci da rivedere: senza revisione le percentuali non sono complete.</Label>
            </Card>
          ) : null}
          <SectionTitle>Dettaglio</SectionTitle>
          <MetricsCard m={m.all} />
          {Object.entries(m.byPlatform).map(([p, mm]) => (
            <View key={p}>
              <SectionTitle>{p === 'ios' ? 'iPhone' : 'Android'}</SectionTitle>
              <MetricsCard m={mm} compact />
            </View>
          ))}
        </>
      ) : null}

      <SectionTitle>Copertura della matrice dei test</SectionTitle>
      <Card>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {coverage.map((s) => (
            <Pill key={s.id} text={`${s.label} · ${s.n}`} color={s.n === 0 ? c.textDim : s.n < 3 ? c.warn : c.ok} />
          ))}
        </View>
        <Label dim size={12} style={{ marginTop: space.sm }}>Grigio = mai provato · giallo = meno di 3 prove · verde = 3 o più</Label>
      </Card>

      <SectionTitle>Test</SectionTitle>
      {tests.length === 0 ? <Empty text="Nessun test completato." /> : null}
      {tests.map((t) => (
        <Card key={t.id} style={{ marginBottom: space.sm }}>
          <Pressable onPress={() => nav.push({ name: 'summary', testId: t.id })}>
            <Text style={{ color: c.text, fontSize: 16, fontWeight: '700' }}>{fmtDate(t.startedAt)} · {t.platform === 'ios' ? 'iPhone' : 'Android'}</Text>
            <Label dim size={13}>
              {fmtDuration((t.stoppedAt ?? t.startedAt) - t.startedAt)} · {t.quality.filter((q) => q.severity === 'warning').length} avvisi · {t.meta.deviceModel ?? ''}
            </Label>
          </Pressable>
          <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.sm }}>
            <Button small variant="ghost" title="Rivedi" style={{ flex: 1 }} onPress={() => nav.push({ name: 'review', testId: t.id })} />
            <Button
              small
              variant="ghost"
              title="Elimina"
              style={{ flex: 1 }}
              onPress={() =>
                Alert.alert('Eliminare il test?', 'Dati, eventi e revisione verranno cancellati.', [
                  { text: 'Annulla', style: 'cancel' },
                  {
                    text: 'Elimina',
                    style: 'destructive',
                    onPress: async () => {
                      await db.deleteTest(t.id);
                      await load();
                    },
                  },
                ])
              }
            />
          </View>
        </Card>
      ))}
    </ScrollView>
  );
}

function BigStat({ label, value, sub, good }: { label: string; value: number | null; sub: string; good?: boolean }) {
  const c = usePalette();
  const color = value === null ? c.textDim : good ? (value >= 85 ? c.ok : value >= 60 ? c.warn : c.danger) : value <= 5 ? c.ok : value <= 15 ? c.warn : c.danger;
  return (
    <Card style={{ flex: 1 }}>
      <Label dim size={13} bold>{label.toUpperCase()}</Label>
      <Text style={{ color, fontSize: 40, fontWeight: '800', marginTop: 4 }}>{value === null ? '–' : `${fmtNum(value)}%`}</Text>
      <Label dim size={12}>{sub}</Label>
    </Card>
  );
}

function MetricsCard({ m, compact }: { m: Metrics; compact?: boolean }) {
  return (
    <Card>
      <Row k="Test effettuati" v={String(m.tests)} />
      <Row k="Parcheggi rilevati" v={String(m.parkingsDetected)} />
      {!compact ? <Row k="Partenze in auto rilevate" v={String(m.departuresVehicle)} /> : null}
      {!compact ? <Row k="Partenze a piedi (non rilascio)" v={String(m.departuresWalking)} /> : null}
      <Row k="Rilasci generati (di cui dedotti)" v={`${m.releasesGenerated} (${m.releasesInferred})`} />
      <Row k="Corretti / falsi positivi / mancati" v={`${m.releasesCorrect} / ${m.falsePositives} / ${m.falseNegatives}`} />
      <Row k="Confidence media rilascio" v={fmtNum(m.avgReleaseConfidence)} />
      <Row k="Tempo medio di rilevamento" v={m.avgDetectionDelayS === null ? '–' : `${fmtNum(m.avgDetectionDelayS)} s`} />
      {!compact ? <Row k="Precisione GPS media" v={m.avgGpsAccuracy === null ? '–' : `±${fmtNum(m.avgGpsAccuracy)} m`} /> : null}
      {!compact ? <Row k="Precisione media del punto" v={m.avgPointAccuracy === null ? '–' : `±${fmtNum(m.avgPointAccuracy, 1)} m`} /> : null}
      {!compact ? <Row k="Indirizzi risolti" v={m.addressResolvedPct === null ? '–' : `${m.addressResolvedPct}%`} /> : null}
      <Row k="Previsioni di ritorno (seguite da partenza)" v={`${m.returnPredictions} (${m.returnPredictionsFollowed})`} />
      <Row k="Anticipo medio della previsione" v={m.avgReturnLeadS === null ? '–' : fmtDuration(m.avgReturnLeadS * 1000)} />
      <Row k="Ricerche di parcheggio riconosciute" v={String(m.searchesDetected)} />
      <Row k="Tempo medio per trovare posto" v={m.avgSearchTimeS === null ? '–' : fmtDuration(m.avgSearchTimeS * 1000)} />
    </Card>
  );
}

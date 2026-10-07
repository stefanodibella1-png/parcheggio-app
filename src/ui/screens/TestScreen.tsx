import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { host } from '../../host/EngineHost.ts';
import { readiness, type CheckItem } from '../../services/permissions.ts';
import { updatePending } from '../../services/updates.ts';
import { Button, Card, Label, SectionTitle, Title } from '../components/basics.tsx';
import { CarCard, Checklist, SensorLine, StateCard, Timeline, useHost, useNow } from '../components/live.tsx';
import { SCENARIOS } from '../scenarios.ts';
import { fmtDuration } from '../format.ts';
import { space, usePalette } from '../theme.ts';
import type { Nav } from '../nav.ts';

export function TestScreen({ nav }: { nav: Nav }) {
  const c = usePalette();
  const s = useHost();
  const now = useNow();
  const [items, setItems] = useState<CheckItem[]>([]);
  const [scenarios, setScenarios] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    readiness().then(setItems).catch(() => setItems([]));
  }, []);
  useEffect(() => {
    if (!s.active) refresh();
  }, [s.active, refresh]);

  const blocking = items.filter((i) => i.level === 'bad' && (i.key === 'locationFg' || i.key === 'gps'));
  const missing = items.filter((i) => i.level !== 'ok');

  const start = async () => {
    setBusy(true);
    try {
      await host.startTest(scenarios);
    } finally {
      setBusy(false);
    }
  };

  const stop = () => {
    const st = s.snapshot?.state;
    const doStop = async () => {
      setBusy(true);
      try {
        const id = await host.stopTest();
        if (id) nav.push({ name: 'summary', testId: id });
      } finally {
        setBusy(false);
      }
    };
    if (st === 'VEHICLE_STOPPED' || st === 'POSSIBLE_PARKING') {
      const since = s.snapshot ? Math.round((now - s.snapshot.stateSinceT) / 1000) : 0;
      Alert.alert(
        'Parcheggio non ancora confermato',
        `Sei fermo da ${since} s: per confermare un parcheggio servono almeno ${Math.ceil(s.config.MIN_PARKING_DURATION_S / 60)} minuti. Fermare comunque?`,
        [
          { text: 'Aspetto', style: 'cancel' },
          { text: 'Ferma', style: 'destructive', onPress: () => void doStop() },
        ],
      );
    } else {
      Alert.alert('Fermare il test?', 'Il rilevamento automatico si interrompe.', [
        { text: 'Annulla', style: 'cancel' },
        { text: 'Ferma', style: 'destructive', onPress: () => void doStop() },
      ]);
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: 140 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Title>PARCHEGGIO</Title>
          {updatePending() ? <Label size={12} color={c.ok}>aggiornamento pronto</Label> : null}
        </View>
        {s.error ? (
          <Card style={{ marginTop: space.md, borderColor: c.danger }}>
            <Label color={c.danger}>{s.error}</Label>
          </Card>
        ) : null}

        {!s.active ? (
          <>
            <Label dim style={{ marginTop: space.sm }}>
              Dopo l'avvio non devi toccare nulla: guida, parcheggia, riparti. Il telefono può restare bloccato in tasca.
            </Label>
            <SectionTitle right={<Pressable onPress={refresh}><Label size={13} color={c.accent}>Aggiorna</Label></Pressable>}>
              Prima del test
            </SectionTitle>
            <Checklist items={items} onChanged={refresh} />
            {missing.length > 0 && blocking.length === 0 ? (
              <Label dim size={13} style={{ marginTop: space.sm }}>
                Puoi partire lo stesso: ciò che manca non verrà misurato.
              </Label>
            ) : null}
            <SectionTitle>Cosa provi oggi? (facoltativo)</SectionTitle>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
              {SCENARIOS.map((sc) => {
                const on = scenarios.includes(sc.id);
                return (
                  <Pressable
                    key={sc.id}
                    onPress={() => setScenarios(on ? scenarios.filter((x) => x !== sc.id) : [...scenarios, sc.id])}
                    style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: on ? c.accent : c.border, backgroundColor: on ? c.accent + '22' : 'transparent' }}
                  >
                    <Text style={{ color: on ? c.accent : c.textDim, fontSize: 14 }}>{sc.label}</Text>
                  </Pressable>
                );
              })}
            </View>
            {s.lastStopped ? (
              <Button variant="ghost" title="Apri il riepilogo dell'ultimo test" style={{ marginTop: space.lg }} onPress={() => nav.push({ name: 'summary', testId: s.lastStopped!.testId })} />
            ) : null}
          </>
        ) : (
          <>
            <View style={{ marginTop: space.md }}>
              <StateCard snap={s.snapshot} now={now} />
            </View>
            {s.session ? (
              <View style={{ marginTop: space.md }}>
                <CarCard session={s.session} distanceM={s.snapshot?.distanceFromParkingM ?? null} now={now} />
              </View>
            ) : null}
            {s.events.length > 0 ? (
              <>
                <SectionTitle>Ultimi eventi</SectionTitle>
                <Timeline events={s.events} onOpen={() => nav.tab('debug')} />
              </>
            ) : null}
            <View style={{ marginTop: space.md }}>
              <SensorLine rates={s.rates} now={now} />
            </View>
          </>
        )}
      </ScrollView>

      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: space.lg, backgroundColor: c.bg, borderTopWidth: 1, borderTopColor: c.border }}>
        {s.active ? (
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ flex: 1 }}>
              <Label size={13} dim>TEST ATTIVO</Label>
              <Text style={{ color: c.text, fontSize: 24, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{fmtDuration(now - (s.startedAt ?? now))}</Text>
            </View>
            <Button title="FERMA TEST" variant="danger" busy={busy} onPress={stop} style={{ paddingHorizontal: space.xl }} />
          </View>
        ) : (
          <Button title="AVVIA TEST" busy={busy} disabled={!s.ready || blocking.length > 0} onPress={start} style={{ minHeight: 64 }} />
        )}
      </View>
    </View>
  );
}

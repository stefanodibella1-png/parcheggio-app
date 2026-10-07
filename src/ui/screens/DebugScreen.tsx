import React, { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { DEFAULT_CONFIG, type DetectionConfig } from '../../../engine/config.ts';
import type { DetectionEvent } from '../../../engine/types.ts';
import { host } from '../../host/EngineHost.ts';
import { currentUpdateLabel } from '../../services/updates.ts';
import * as db from '../../storage/db.ts';
import { Button, Card, Empty, Label, Row, ScoreBar, SectionTitle, Title } from '../components/basics.tsx';
import { MapPanel } from '../components/MapPanel.tsx';
import { useHost, useNow } from '../components/live.tsx';
import { ago, fmtNum, fmtTime } from '../format.ts';
import { FAMILY_COLORS, STATE_TEXT, familyOf, space, usePalette } from '../theme.ts';
import type { Nav } from '../nav.ts';

type Tab = 'live' | 'log' | 'map' | 'config';

export function DebugScreen({ nav }: { nav: Nav }) {
  const c = usePalette();
  const [tab, setTab] = useState<Tab>('live');
  return (
    <View style={{ flex: 1 }}>
      <View style={{ padding: space.lg, paddingBottom: 0 }}>
        <Title>Debug</Title>
        <View style={{ flexDirection: 'row', marginTop: space.md, backgroundColor: c.cardAlt, borderRadius: 10, padding: 3 }}>
          {(['live', 'log', 'map', 'config'] as Tab[]).map((t) => (
            <Pressable key={t} onPress={() => setTab(t)} style={{ flex: 1, paddingVertical: 9, borderRadius: 8, backgroundColor: tab === t ? c.card : 'transparent', alignItems: 'center' }}>
              <Text style={{ color: tab === t ? c.text : c.textDim, fontWeight: '700' }}>{{ live: 'Live', log: 'Log', map: 'Mappa', config: 'Parametri' }[t]}</Text>
            </Pressable>
          ))}
        </View>
      </View>
      {tab === 'live' ? <Live /> : tab === 'log' ? <Log nav={nav} /> : tab === 'map' ? <DebugMap /> : <ConfigEditor />}
    </View>
  );
}

function Live() {
  const s = useHost();
  const now = useNow();
  const snap = s.snapshot;
  if (!s.active || !snap) {
    return (
      <ScrollView contentContainerStyle={{ padding: space.lg }}>
        <Empty text="Avvia un test per vedere i dati in tempo reale." />
        <VersionCard />
      </ScrollView>
    );
  }
  const r = s.rates;
  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: 40 }}>
      <Card accent={FAMILY_COLORS[familyOf(snap.state)]}>
        <Row k="Stato" v={`${snap.state} · ${Math.round((now - snap.stateSinceT) / 1000)} s`} />
        <Row k="Activity" v={snap.activity ? `${snap.activity} ${snap.activityConfidence ?? ''}` : '–'} />
        <Row k="Velocità" v={snap.speedKmh === null ? '–' : `${fmtNum(snap.speedKmh, 1)} km/h`} />
        <Row k="GPS" v={snap.gpsAccuracyM === null ? '–' : `±${fmtNum(snap.gpsAccuracyM, 1)} m · ${snap.lastFixAgeS ?? '–'} s fa`} />
        <Row k="Distanza dal parcheggio" v={snap.distanceFromParkingM === null ? '–' : `${snap.distanceFromParkingM} m`} />
        {snap.returnInfo ? <Row k="Ritorno: avvicinamento / ETA" v={`${snap.returnInfo.approachSpeedMs ?? '–'} m/s · ${snap.returnInfo.etaS ?? '–'} s`} /> : null}
        <Row k="Modalità posizione" v={s.locationMode ?? '–'} />
      </Card>
      <SectionTitle>Score</SectionTitle>
      <Card>
        <ScoreBar label="Vehicle" value={snap.scores.vehicle} color={FAMILY_COLORS.vehicle} />
        <ScoreBar label="Walking" value={snap.scores.walking} color={FAMILY_COLORS.walking} />
        <ScoreBar label="Parking" value={snap.scores.parking} color={FAMILY_COLORS.parking} />
        <ScoreBar label="Departure" value={snap.scores.departure} color={FAMILY_COLORS.vehicle} />
        <ScoreBar label="Release" value={snap.scores.release} color={FAMILY_COLORS.released} />
        <ScoreBar label="Return (sperimentale)" value={snap.scores.return} color={FAMILY_COLORS.walking} />
        <ScoreBar label="Ricerca posto (sperimentale)" value={snap.scores.search ?? 0} color={FAMILY_COLORS.parking} />
      </Card>
      <SectionTitle>Ultima decisione</SectionTitle>
      <Card>
        <Label>{snap.lastReason ?? '–'}</Label>
      </Card>
      <SectionTitle>Sensori (campioni nell'ultimo minuto)</SectionTitle>
      <Card>
        <Row k="Posizione" v={`${r.location}/min · ${ago(r.lastLocationT, now)}`} />
        <Row k="Activity recognition" v={`${r.activity}/min · ${ago(r.lastActivityT, now)}`} />
        <Row k="Accelerometro (finestre 2 s)" v={`${r.motion}/min · ${ago(r.lastMotionT, now)}`} />
      </Card>
      <VersionCard />
    </ScrollView>
  );
}

function VersionCard() {
  return (
    <>
      <SectionTitle>Versione</SectionTitle>
      <Card>
        <Row k="Aggiornamento" v={currentUpdateLabel()} />
      </Card>
    </>
  );
}

function Log({ nav }: { nav: Nav }) {
  const c = usePalette();
  const s = useHost();
  const [past, setPast] = useState<DetectionEvent[] | null>(null);
  useEffect(() => {
    if (!s.active) void db.getEvents().then((e) => setPast(e.slice(-300)));
  }, [s.active]);
  const events = (s.active ? s.events : past ?? []).slice().reverse();
  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: 40 }}>
      {!s.active ? <Label dim size={13}>Ultimi eventi di tutti i test</Label> : null}
      {events.length === 0 ? <Empty text="Nessun evento." /> : null}
      {events.map((e) => (
        <Pressable key={e.id} onPress={() => nav.push({ name: 'event', eventId: e.id, testId: s.active ? s.testId : null })}>
          <View style={{ flexDirection: 'row', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: c.border }}>
            <View style={{ width: 4, borderRadius: 2, backgroundColor: FAMILY_COLORS[familyOf(e.type)], marginRight: space.md }} />
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ color: c.text, fontWeight: '700' }}>{e.type}</Text>
                <Text style={{ color: c.textDim, fontVariant: ['tabular-nums'] }}>{fmtTime(e.t)}</Text>
              </View>
              <Label dim size={13}>
                {e.data.speedKmh === null ? '–' : `${fmtNum(e.data.speedKmh)} km/h`} · d {e.data.distanceM ?? '–'} m · GPS {e.data.gpsAccuracyM === null ? '–' : `±${Math.round(e.data.gpsAccuracyM)}`}
                {e.data.gpsValid ? '' : ' (non valido)'}
              </Label>
              <Label size={13} style={{ marginTop: 2 }}>{e.reason}</Label>
            </View>
          </View>
        </Pressable>
      ))}
    </ScrollView>
  );
}

function DebugMap() {
  const s = useHost();
  return (
    <ScrollView contentContainerStyle={{ padding: space.lg }}>
      <MapPanel track={s.track} events={s.events} spot={s.session?.spot ?? null} accuracyLimit={s.config.GPS_ACCURACY_LIMIT} height={460} showRejected />
      <Label dim size={12} style={{ marginTop: space.sm }}>
        Colori: blu veicolo · ambra sosta · viola a piedi · verde liberato · grigio fix scartati (precisione oltre {s.config.GPS_ACCURACY_LIMIT} m)
      </Label>
    </ScrollView>
  );
}

function ConfigEditor() {
  const c = usePalette();
  const s = useHost();
  const [overrides, setOverrides] = useState<Partial<DetectionConfig>>({});
  const [draft, setDraft] = useState<Record<string, string>>({});
  useEffect(() => {
    void host.getConfigOverrides().then(setOverrides);
  }, []);
  const keys = (Object.keys(DEFAULT_CONFIG) as (keyof DetectionConfig)[]).filter((k) => typeof DEFAULT_CONFIG[k] === 'number');
  const save = async () => {
    const next: Partial<DetectionConfig> = { ...overrides };
    for (const [k, v] of Object.entries(draft)) {
      const n = Number(v.replace(',', '.'));
      if (v.trim() === '' || Number.isNaN(n)) delete (next as Record<string, unknown>)[k];
      else (next as Record<string, number>)[k] = n;
    }
    await host.setConfigOverrides(next);
    setOverrides(next);
    setDraft({});
    Alert.alert('Parametri salvati', 'Valgono dal prossimo test.');
  };
  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
      <Label dim size={13}>
        Modifiche valide dal prossimo test (ogni export contiene i parametri usati). I pesi degli score si cambiano in engine/config.ts.
      </Label>
      {s.active ? <Label color={c.warn} size={13}>Test in corso: usa ancora i parametri con cui è partito.</Label> : null}
      <Card style={{ marginTop: space.md }}>
        {keys.map((k) => {
          const val = (overrides[k] as number | undefined) ?? (DEFAULT_CONFIG[k] as number);
          const changed = overrides[k] !== undefined;
          return (
            <View key={k} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 4 }}>
              <Text style={{ color: changed ? c.accent : c.text, fontSize: 13, flex: 1 }}>{k}</Text>
              <TextInput
                keyboardType="decimal-pad"
                placeholder={String(val)}
                placeholderTextColor={c.textDim}
                value={draft[k] ?? ''}
                onChangeText={(t) => setDraft({ ...draft, [k]: t })}
                style={{ color: c.text, borderWidth: 1, borderColor: c.border, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, width: 90, textAlign: 'right' }}
              />
            </View>
          );
        })}
      </Card>
      <View style={{ gap: space.sm, marginTop: space.lg }}>
        <Button title="Salva parametri" onPress={save} />
        <Button
          variant="ghost"
          title="Ripristina default"
          onPress={async () => {
            await host.setConfigOverrides({});
            setOverrides({});
            setDraft({});
          }}
        />
      </View>
    </ScrollView>
  );
}

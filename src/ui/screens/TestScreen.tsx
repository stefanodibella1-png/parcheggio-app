import React, { useCallback, useEffect, useState } from 'react';
import { Alert, AppState, BackHandler, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { host } from '../../host/EngineHost.ts';
import { readiness, type CheckItem } from '../../services/permissions.ts';
import { fmtWhen, latestPublished, updateAvailable, updateNow, updatePending } from '../../services/updates.ts';
import { Button, Card, Label, SectionTitle, Title } from '../components/basics.tsx';
import { CarCard, Checklist, CommunityCard, SensorLine, StateCard, Timeline, useHost, useNow } from '../components/live.tsx';
import { SCENARIOS } from '../scenarios.ts';
import { fmtDuration } from '../format.ts';
import { space, usePalette } from '../theme.ts';
import { VersionNote } from '../components/VersionNote.tsx';
import { simulateSpot, type SimStep } from '../../services/simulateSpot.ts';
import type { Nav } from '../nav.ts';

export function TestScreen({ nav }: { nav: Nav }) {
  const c = usePalette();
  const s = useHost();
  const now = useNow();
  const [items, setItems] = useState<CheckItem[]>([]);
  const [scenarios, setScenarios] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [updAvail, setUpdAvail] = useState(false);
  const [updBusy, setUpdBusy] = useState(false);
  const [pub, setPub] = useState<{ at: number; note: string } | null>(null);
  const [sim, setSim] = useState<{ step: SimStep; info?: string } | null>(null);
  const hasUpd = updAvail || updatePending();
  useEffect(() => {
    if (hasUpd) void latestPublished().then(setPub);
  }, [hasUpd]);

  const refresh = useCallback(() => {
    readiness().then(setItems).catch(() => setItems([]));
  }, []);
  useEffect(() => {
    if (!s.active) refresh();
  }, [s.active, refresh]);
  // di ritorno dalle impostazioni del telefono: ricontrolla
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') refresh();
    });
    return () => sub.remove();
  }, [refresh]);
  // aggiornamenti: controllo silenzioso, il pulsante compare solo se ce n'è uno
  useEffect(() => {
    const check = () => void updateAvailable().then(setUpdAvail);
    check();
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') check();
    });
    return () => sub.remove();
  }, []);

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
          {Platform.OS === 'android' ? (
            <Button
              small
              variant="ghost"
              title="Esci ✕"
              onPress={() => {
                if (s.active) {
                  Alert.alert('Uscire dall\'app?', 'Il test continua a funzionare in background.', [
                    { text: 'Annulla', style: 'cancel' },
                    { text: 'Esci', onPress: () => BackHandler.exitApp() },
                  ]);
                } else BackHandler.exitApp();
              }}
            />
          ) : null}
        </View>
        {s.active && (updAvail || updatePending()) ? (
          <Card style={{ marginTop: space.md, borderColor: c.ok }}>
            <Label color={c.ok} bold>
              Aggiornamento pronto{pub ? ` del ${fmtWhen(pub.at)}` : ''}
            </Label>
            {pub?.note ? (
              <Label size={14} style={{ marginTop: 4 }}>
                Novità: {pub.note}
              </Label>
            ) : null}
            <Button
              small
              title={updBusy ? 'Installazione…' : 'Installa ora (il test continua)'}
              style={{ marginTop: space.sm }}
              disabled={updBusy}
              onPress={async () => {
                setUpdBusy(true);
                await host.flush(true).catch(() => {}); // tutti i dati già nel registro: il test riprende da solo
                const r = await updateNow();
                if (r !== 'reloading') {
                  setUpdBusy(false);
                  setUpdAvail(false);
                }
              }}
            />
          </Card>
        ) : null}
        {!s.active && (updAvail || updatePending()) ? (
          <Button
            title={updBusy ? 'Installazione…' : '⬇️ Installa aggiornamento'}
            style={{ marginTop: space.md }}
            disabled={updBusy}
            onPress={async () => {
              setUpdBusy(true);
              const r = await updateNow();
              if (r !== 'reloading') {
                setUpdBusy(false);
                setUpdAvail(false);
              }
            }}
          />
        ) : null}
        <VersionNote pending={updAvail || updatePending()} style={{ marginTop: space.xs }} />
        <Card style={{ marginTop: space.md, borderColor: c.accent }}>
          <Label bold>🔊 Simulazione: posto che si libera</Label>
          <Label dim size={13} style={{ marginTop: 2 }}>
            Fa sentire cosa riceve chi cerca parcheggio: subito «si libera tra 2 minuti», dopo 20 secondi «è libero». Lo ricevono anche gli altri telefoni di prova vicini.
          </Label>
          <Button
            small
            title={
              sim === null || sim.step === 'fine' || sim.step === 'errore'
                ? 'Avvia simulazione'
                : sim.step === 'cerco'
                  ? 'Preparo…'
                  : sim.step === 'soon'
                    ? 'Si libera tra 2 min… (attendi 20 s)'
                    : 'Libero!'
            }
            disabled={sim !== null && sim.step !== 'fine' && sim.step !== 'errore'}
            style={{ marginTop: space.sm }}
            onPress={() => {
              const t = s.track;
              void simulateSpot((step, info) => setSim({ step, info }), t.length ? t[t.length - 1] : null);
            }}
          />
          {sim?.step === 'errore' ? <Label color={c.danger} size={13} style={{ marginTop: 4 }}>{sim.info}</Label> : null}
          {sim?.info && sim.step !== 'errore' ? <Label dim size={13} style={{ marginTop: 4 }}>Posto: {sim.info}</Label> : null}
        </Card>
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
            <Card style={{ marginTop: space.md, borderColor: host.searchRole ? c.accent : c.border }}>
              <Label bold>🔍 Questo telefono CERCA parcheggio</Label>
              <Label dim size={13} style={{ marginTop: 2 }}>
                Per la prova a due telefoni (es. il tablet): ascolta sempre i posti entro 800 m, con voce e notifica anche da fermo. Il rilevamento non cambia. Tienilo in carica con il test attivo.
              </Label>
              <Button
                small
                variant={host.searchRole ? undefined : 'ghost'}
                title={host.searchRole ? '✓ CERCA acceso · tocca per spegnere' : 'Accendi il ruolo CERCA'}
                style={{ marginTop: space.sm }}
                onPress={() => void host.setSearchRole(!host.searchRole)}
              />
              {host.searchRole ? <SearchAlive community={s.community} now={now} /> : null}
            </Card>
            <View style={{ marginTop: space.md }}>
              <CommunityCard community={s.community} now={now} />
            </View>
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

/** Ruolo CERCA: a colpo d'occhio se il tablet è vivo e cosa ha ricevuto per ultimo. */
function SearchAlive({ community, now }: { community: ReturnType<typeof useHost>['community']; now: number }) {
  const c = usePalette();
  const ago = community.lastSyncT ? Math.max(0, Math.round((now - community.lastSyncT) / 1000)) : null;
  const alive = community.listening && ago !== null && ago <= 60;
  const last = community.lastReceived ?? null;
  const lastAgo = last ? Math.max(0, Math.round((now - last.t) / 60000)) : null;
  return (
    <View style={{ marginTop: space.md }}>
      <Text style={{ color: alive ? c.ok : c.danger, fontSize: 24, fontWeight: '800' }}>
        {alive
          ? `In ascolto ✓ · ultimo controllo ${ago} s fa`
          : !community.listening
            ? '⚠️ Non in ascolto'
            : ago === null
              ? 'Primo controllo in corso…'
              : `⚠️ Fermo · ultimo controllo ${ago} s fa`}
      </Text>
      {community.error ? <Label color={c.danger} size={14} style={{ marginTop: 4 }}>{community.error}</Label> : null}
      <Text style={{ color: c.text, fontSize: 20, fontWeight: '700', marginTop: space.sm }}>
        {last
          ? `Ultimo avviso: ${last.kind === 'FREED' ? '✅ LIBERO' : '⏱️ SI LIBERA'} · ${last.distanceM} m · ${lastAgo === 0 ? 'adesso' : `${lastAgo} min fa`}`
          : 'Nessun avviso ricevuto finora'}
      </Text>
      {last?.address ? <Label size={15} style={{ marginTop: 2 }}>🅿️ {last.address}</Label> : null}
    </View>
  );
}

// ParkingCT: l'app per gli utenti. Stesso motore del laboratorio PARCHEGGIO,
// interfaccia semplice: nessun "test", nessun termine tecnico.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  AppState,
  BackHandler,
  Dimensions,
  Easing,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  Share,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as Location from 'expo-location';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { host } from '../host/EngineHost.ts';
import { readiness, type CheckItem } from '../services/permissions.ts';
import { shortVersion, updateAvailable, updateNow } from '../services/updates.ts';
import { Button, Card, Label } from '../ui/components/basics.tsx';
import { Checklist, CommunityCard, useHost, useNow } from '../ui/components/live.tsx';
import { fmtDistance, fmtDuration, fmtTime } from '../ui/format.ts';
import { space, usePalette } from '../ui/theme.ts';
import type { ParkingSession } from '../../engine/types.ts';
import { kvGet, kvSet } from '../storage/db.ts';
import { founderInfo, getConfig, redeemCode, registerDevice, zoneCount, type PublicConfig } from './server.ts';

const RED = '#E53935';

type Screen = 'home' | 'founder' | 'info';

// ---------------------------------------------------------------------------------------
// radice

export function PublicApp() {
  const c = usePalette();
  const [ready, setReady] = useState(false);
  const [onboarded, setOnboarded] = useState(false);
  const [screen, setScreen] = useState<Screen>('home');
  const [cfg, setCfg] = useState<PublicConfig | null>(null);
  const [founder, setFounder] = useState<{ code: string; t: number } | null>(null);
  const [party, setParty] = useState<null | 'launch' | 'founder'>(null);

  const refreshCfg = useCallback(async () => {
    const conf = await getConfig();
    setCfg(conf);
    const launched = Date.now() >= conf.launchAt;
    host.setCommunityAllowed(launched);
    if (launched && (await kvGet('pc:launchParty').catch(() => null)) !== '1') {
      await kvSet('pc:launchParty', '1').catch(() => {});
      setParty('launch');
    }
  }, []);

  useEffect(() => {
    void (async () => {
      await host.ensureInit();
      setOnboarded((await kvGet('pc:onboarded').catch(() => null)) === '1');
      setFounder(await founderInfo());
      setReady(true);
      void refreshCfg();
      void updateAvailable();
    })();
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') {
        void host.onForeground();
        void host.ensureAlwaysOn();
        void refreshCfg();
        void updateAvailable();
      } else if (st === 'background') void host.onBackground();
    });
    return () => sub.remove();
  }, [refreshCfg]);

  useEffect(() => {
    if (ready && onboarded) void host.ensureAlwaysOn();
  }, [ready, onboarded]);

  useEffect(() => {
    const back = BackHandler.addEventListener('hardwareBackPress', () => {
      if (screen !== 'home') {
        setScreen('home');
        return true;
      }
      return false;
    });
    return () => back.remove();
  }, [screen]);

  let body: React.ReactNode = null;
  if (!ready) body = null;
  else if (!onboarded)
    body = (
      <Onboarding
        onDone={async () => {
          await kvSet('pc:onboarded', '1').catch(() => {});
          setOnboarded(true);
        }}
      />
    );
  else if (screen === 'founder')
    body = (
      <FounderScreen
        cfg={cfg}
        founder={founder}
        onBack={() => setScreen('home')}
        onRedeemed={async () => {
          setFounder(await founderInfo());
          setParty('founder');
          setScreen('home');
        }}
      />
    );
  else if (screen === 'info') body = <InfoScreen onBack={() => setScreen('home')} />;
  else body = <Home cfg={cfg} founder={founder} go={setScreen} />;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top', 'left', 'right', 'bottom']}>
      <StatusBar style={c.isDark ? 'light' : 'dark'} />
      {body}
      <Celebration kind={party} founder={!!founder} onClose={() => setParty(null)} />
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------------------
// benvenuto e permessi

const INTRO = [
  { icon: '🚗', title: 'Ricordo io dove hai parcheggiato', text: 'Quando parcheggi, ParkingCT salva da solo la via e il punto esatto. Non devi toccare niente.' },
  { icon: '🅿️', title: 'Posti che si liberano, prima degli altri', text: "Quando qualcuno torna alla sua auto vicino a te, ricevi l'avviso qualche minuto prima che il posto si liberi." },
  { icon: '🔒', title: 'La tua posizione resta tua', text: 'Non mostriamo mai a nessuno dove sei. Condividiamo solo i posti che si liberano, in forma anonima.' },
];

function Onboarding({ onDone }: { onDone: () => void }) {
  const c = usePalette();
  const [step, setStep] = useState(0);
  const [consent, setConsent] = useState(false);
  const [items, setItems] = useState<CheckItem[]>([]);
  const refresh = useCallback(() => {
    readiness()
      .then((all) => setItems(all.filter((i) => ['locationFg', 'locationBg', 'motion', 'notifications'].includes(i.key))))
      .catch(() => setItems([]));
  }, []);
  useEffect(() => {
    if (step === INTRO.length) refresh();
    const sub = AppState.addEventListener('change', (st) => st === 'active' && refresh());
    return () => sub.remove();
  }, [step, refresh]);

  if (step < INTRO.length) {
    const s = INTRO[step];
    return (
      <View style={{ flex: 1, padding: space.xl, justifyContent: 'center' }}>
        <Text style={{ fontSize: 72, textAlign: 'center' }}>{s.icon}</Text>
        <Text style={{ color: c.text, fontSize: 26, fontWeight: '800', textAlign: 'center', marginTop: space.lg }}>{s.title}</Text>
        <Label dim size={17} style={{ textAlign: 'center', marginTop: space.md, lineHeight: 24 }}>
          {s.text}
        </Label>
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 8, marginTop: space.xl }}>
          {INTRO.map((_, i) => (
            <View key={i} style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: i === step ? RED : c.border }} />
          ))}
        </View>
        <Button title={step === INTRO.length - 1 ? 'Inizia' : 'Avanti'} style={{ marginTop: space.xl, backgroundColor: RED }} onPress={() => setStep(step + 1)} />
      </View>
    );
  }

  const LABELS: Record<string, { title: string; why: string }> = {
    locationFg: { title: 'Posizione', why: 'Per sapere dove hai parcheggiato.' },
    locationBg: { title: 'Posizione "Consenti sempre"', why: 'Così funziona anche a telefono in tasca, senza aprire l\'app.' },
    motion: { title: 'Attività fisica', why: 'Per capire se sei in auto o a piedi, consumando meno batteria.' },
    notifications: { title: 'Notifiche', why: 'Per avvisarti dei posti che si liberano vicino a te.' },
  };
  const allOk = items.length > 0 && items.every((i) => i.level === 'ok');
  return (
    <ScrollView contentContainerStyle={{ padding: space.xl }}>
      <Text style={{ color: c.text, fontSize: 26, fontWeight: '800' }}>Ultimo passo</Text>
      <Label dim size={16} style={{ marginTop: space.sm }}>
        Servono quattro permessi. Tocca ogni pulsante e scegli l'opzione indicata.
      </Label>
      {items.map((i) => (
        <Card key={i.key} style={{ marginTop: space.md }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text style={{ fontSize: 22, marginRight: space.md }}>{i.level === 'ok' ? '✅' : '⬜️'}</Text>
            <View style={{ flex: 1 }}>
              <Label bold>{LABELS[i.key]?.title ?? i.label}</Label>
              <Label dim size={14}>{LABELS[i.key]?.why}</Label>
            </View>
          </View>
          {i.level !== 'ok' && i.action ? (
            <Button
              small
              title={i.key === 'locationBg' ? 'Apri e scegli "Consenti sempre"' : 'Consenti'}
              style={{ marginTop: space.md, backgroundColor: RED }}
              onPress={async () => {
                await i.action!();
                refresh();
              }}
            />
          ) : null}
        </Card>
      ))}
      <Pressable onPress={() => setConsent(!consent)} style={{ flexDirection: 'row', alignItems: 'flex-start', marginTop: space.lg }}>
        <Text style={{ fontSize: 22, marginRight: space.sm }}>{consent ? '☑️' : '⬜️'}</Text>
        <Label size={14} style={{ flex: 1 }}>
          Accetto che ParkingCT usi la posizione del telefono per ricordare i miei parcheggi e condivida in forma anonima i posti che si
          liberano. Posso disinstallare l'app in qualsiasi momento.
        </Label>
      </Pressable>
      <Button title="Fatto" style={{ marginTop: space.lg, backgroundColor: RED }} disabled={!consent} onPress={onDone} />
      {!allOk ? (
        <Label dim size={13} style={{ marginTop: space.sm, textAlign: 'center' }}>
          Puoi continuare anche senza tutti i permessi: alcune funzioni saranno limitate.
        </Label>
      ) : null}
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------------------
// schermata principale

function Home({ cfg, founder, go }: { cfg: PublicConfig | null; founder: { code: string } | null; go: (s: Screen) => void }) {
  const c = usePalette();
  const s = useHost();
  const now = useNow();
  const [zone, setZone] = useState<{ n: number | null } | null>(null);
  const [upd, setUpd] = useState(false);

  useEffect(() => {
    void updateAvailable().then(setUpd);
    void (async () => {
      const last = (await kvGet('pc:zoneT').catch(() => null)) ?? '0';
      let z = await kvGet('pc:zone').catch(() => null);
      if (!z || Date.now() - Number(last) > 24 * 3600_000) {
        const pos = await Location.getLastKnownPositionAsync().catch(() => null);
        if (pos) {
          z = await registerDevice(pos.coords.latitude, pos.coords.longitude, !!founder);
          await kvSet('pc:zoneT', String(Date.now())).catch(() => {});
        }
      }
      if (z) setZone({ n: await zoneCount(z) });
    })();
  }, [founder]);

  const launched = cfg ? now >= cfg.launchAt : false;
  const session = s.session;
  const st = s.snapshot?.state;
  const driving = st === 'IN_VEHICLE' || st === 'VEHICLE_MOVING' || st === 'VEHICLE_STOPPED' || st === 'POSSIBLE_PARKING' || st === 'VEHICLE_DEPARTED';
  const stale = s.active && s.rates.lastLocationT !== null && now - s.rates.lastLocationT > 10 * 60_000 && driving;

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: space.xl }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text style={{ fontSize: 30 }}>🚗</Text>
          <Text style={{ color: c.text, fontSize: 28, fontWeight: '800', marginLeft: space.sm }}>
            Parking<Text style={{ color: RED }}>CT</Text>
          </Text>
        </View>
        <Pressable onPress={() => go('info')} hitSlop={12}>
          <Text style={{ fontSize: 24 }}>ⓘ</Text>
        </Pressable>
      </View>
      {founder ? (
        <Label size={13} color={RED} bold style={{ marginTop: 2 }}>
          ⭐ Sostenitore fondatore
        </Label>
      ) : null}

      {upd ? (
        <Button
          title="⬇️ Installa aggiornamento"
          style={{ marginTop: space.md }}
          onPress={async () => {
            const r = await updateNow();
            if (r !== 'reloading') setUpd(false);
          }}
        />
      ) : null}

      {/* auto */}
      <View style={{ marginTop: space.lg }}>
        {driving ? (
          <Card accent={RED}>
            <Label size={13} dim bold>
              IN AUTO
            </Label>
            <Text style={{ color: c.text, fontSize: 20, fontWeight: '700', marginTop: 4 }}>Buon viaggio!</Text>
            <Label dim style={{ marginTop: 4 }}>
              Quando parcheggi, ricordo io dove.
            </Label>
          </Card>
        ) : session ? (
          <CarHere session={session} distanceM={s.snapshot?.distanceFromParkingM ?? null} now={now} />
        ) : (
          <Card>
            <Text style={{ color: c.text, fontSize: 18, fontWeight: '700' }}>Nessun parcheggio salvato</Text>
            <Label dim style={{ marginTop: 4 }}>
              Al prossimo parcheggio lo salvo da solo. Tieni il telefono con te, anche in tasca.
            </Label>
          </Card>
        )}
      </View>

      {stale ? (
        <Card style={{ marginTop: space.md, borderColor: c.warn }}>
          <Label color={c.warn}>Il telefono ha messo in pausa ParkingCT. Apri le impostazioni consigliate per evitarlo.</Label>
          <Button small variant="ghost" title="Impostazioni consigliate" style={{ marginTop: space.sm }} onPress={() => go('info')} />
        </Card>
      ) : null}

      {/* lancio e community */}
      {launched ? (
        <View style={{ marginTop: space.md }}>
          <CommunityCard community={s.community} now={now} />
        </View>
      ) : cfg ? (
        <LaunchCard cfg={cfg} now={now} count={zone?.n ?? null} />
      ) : null}

      {/* sostenitore */}
      {!founder ? (
        <Card style={{ marginTop: space.md }}>
          <Text style={{ color: c.text, fontSize: 18, fontWeight: '700' }}>⭐ Diventa sostenitore fondatore</Text>
          <Label dim style={{ marginTop: 4 }}>
            Con pochi euro aiuti ParkingCT a nascere a Catania. In cambio: titolo di fondatore per sempre, nome nel muro dei fondatori e
            l'adesivo per l'auto.
          </Label>
          <Button title="Scopri di più" variant="ghost" style={{ marginTop: space.md }} onPress={() => go('founder')} />
        </Card>
      ) : null}
    </ScrollView>
  );
}

function CarHere({ session, distanceM, now }: { session: ParkingSession; distanceM: number | null; now: number }) {
  const c = usePalette();
  const p = session.spot.pointFinal;
  const a = session.spot.address;
  const where = a?.street ? `${a.street}${a.streetNumber ? ` ${a.streetNumber}` : ''}` : a?.formatted ?? 'Posizione salvata';
  const since = session.parkedT ?? session.startT;
  const nav = `https://www.google.com/maps/dir/?api=1&destination=${p.latitude},${p.longitude}&travelmode=walking`;
  return (
    <Card accent={RED}>
      <Label size={13} dim bold>
        LA TUA AUTO
      </Label>
      <Text style={{ color: c.text, fontSize: 24, fontWeight: '800', marginTop: 4 }}>{where}</Text>
      {a?.city ? <Label dim>{a.city}</Label> : null}
      <Label dim style={{ marginTop: 6 }}>
        Parcheggiata alle {fmtTime(since)} · da {fmtDuration(now - since)}
        {distanceM !== null && distanceM > 30 ? ` · sei a ${fmtDistance(distanceM)}` : ''}
      </Label>
      {session.gpsLostAtPark ? (
        <Label dim size={13} style={{ marginTop: 4 }}>
          Posizione approssimata (garage o zona coperta)
        </Label>
      ) : null}
      <Button title="🚶 Portami all'auto" style={{ marginTop: space.md, backgroundColor: RED }} onPress={() => Linking.openURL(nav).catch(() => {})} />
      <Button
        small
        variant="ghost"
        title="Condividi posizione auto"
        style={{ marginTop: space.sm }}
        onPress={() => Share.share({ message: `La mia auto è in ${a?.formatted ?? where}: https://maps.google.com/?q=${p.latitude},${p.longitude}` })}
      />
    </Card>
  );
}

function LaunchCard({ cfg, now, count }: { cfg: PublicConfig; now: number; count: number | null }) {
  const c = usePalette();
  const days = Math.max(0, Math.ceil((cfg.launchAt - now) / 86_400_000));
  const date = new Date(cfg.launchAt).toLocaleDateString('it-IT', { day: 'numeric', month: 'long' });
  const pct = count === null ? 0 : Math.min(100, (count / cfg.zoneTarget) * 100);
  return (
    <Card style={{ marginTop: space.md }}>
      <Label size={13} dim bold>
        POSTI CHE SI LIBERANO
      </Label>
      <Text style={{ color: c.text, fontSize: 20, fontWeight: '800', marginTop: 4 }}>
        Si attiva il {date}
        {days > 0 ? ` · tra ${days} giorn${days === 1 ? 'o' : 'i'}` : ''}
      </Text>
      <Label dim style={{ marginTop: 4 }}>
        Fino ad allora ParkingCT impara i parcheggi della città. Più siamo nella tua zona, più posti vedrai.
      </Label>
      <View style={{ marginTop: space.md }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Label size={14}>{cfg.zoneName ? `Nella zona ${cfg.zoneName}` : 'Nella tua zona'}</Label>
          <Label size={14} bold>
            {count === null ? '…' : count} su {cfg.zoneTarget}
          </Label>
        </View>
        <View style={{ height: 10, backgroundColor: c.cardAlt, borderRadius: 5, marginTop: 6, overflow: 'hidden' }}>
          <View style={{ width: `${pct}%`, height: 10, backgroundColor: RED }} />
        </View>
      </View>
      <Button
        small
        variant="ghost"
        title="Invita chi parcheggia vicino a te"
        style={{ marginTop: space.md }}
        onPress={() =>
          Share.share({
            message: 'Sto usando ParkingCT: ricorda dove parcheggi e avvisa quando un posto si libera vicino a te. Scaricala gratis: https://github.com/stefanodibella1-png/parcheggio-app/releases/latest/download/ParkingCT.apk',
          })
        }
      />
    </Card>
  );
}

// ---------------------------------------------------------------------------------------
// sostenitore fondatore

function FounderScreen({
  cfg,
  founder,
  onBack,
  onRedeemed,
}: {
  cfg: PublicConfig | null;
  founder: { code: string } | null;
  onBack: () => void;
  onRedeemed: () => void;
}) {
  const c = usePalette();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <ScrollView contentContainerStyle={{ padding: space.lg }} keyboardShouldPersistTaps="handled">
      <Pressable onPress={onBack} hitSlop={12}>
        <Label color={RED}>‹ Indietro</Label>
      </Pressable>
      <Text style={{ fontSize: 56, textAlign: 'center', marginTop: space.md }}>⭐</Text>
      <Text style={{ color: c.text, fontSize: 26, fontWeight: '800', textAlign: 'center' }}>Sostenitore fondatore</Text>
      <Label dim size={16} style={{ textAlign: 'center', marginTop: space.sm }}>
        ParkingCT nasce a Catania, da un catanese. Se ti piace l'idea, aiutala a partire con un piccolo contributo.
      </Label>
      <Card style={{ marginTop: space.lg }}>
        <Label bold>Cosa ricevi</Label>
        <Label style={{ marginTop: 6 }}>⭐ Il titolo di fondatore, per sempre, nell'app</Label>
        <Label style={{ marginTop: 4 }}>🧱 Il tuo nome nel muro dei fondatori</Label>
        <Label style={{ marginTop: 4 }}>🚗 L'adesivo ParkingCT per l'auto</Label>
        <Label dim size={13} style={{ marginTop: 8 }}>
          ParkingCT resta gratuita: il contributo è un sostegno facoltativo.
        </Label>
      </Card>
      {founder ? (
        <Card style={{ marginTop: space.md }}>
          <Label bold color={RED}>
            Sei già sostenitore fondatore. Grazie! 🎉
          </Label>
          <Label dim style={{ marginTop: 4 }}>Codice: {founder.code}</Label>
        </Card>
      ) : (
        <>
          <Button
            title="Sostieni ParkingCT"
            style={{ marginTop: space.lg, backgroundColor: RED }}
            onPress={() => {
              if (cfg?.supportUrl) void Linking.openURL(cfg.supportUrl);
              else Alert.alert('Quasi pronto', 'La raccolta dei sostenitori apre a breve: ti avviseremo nell\'app.');
            }}
          />
          <Card style={{ marginTop: space.lg }}>
            <Label bold>Hai già il codice?</Label>
            <Label dim size={14} style={{ marginTop: 4 }}>
              Dopo il contributo ricevi un codice come ABCD-EFGH-JKLM.
            </Label>
            <TextInput
              value={code}
              onChangeText={(t) => {
                setCode(t.toUpperCase());
                setMsg(null);
              }}
              autoCapitalize="characters"
              autoCorrect={false}
              placeholder="XXXX-XXXX-XXXX"
              placeholderTextColor={c.textDim}
              style={{
                marginTop: space.md,
                borderWidth: 1,
                borderColor: c.border,
                borderRadius: 12,
                padding: space.md,
                color: c.text,
                fontSize: 20,
                letterSpacing: 2,
                textAlign: 'center',
              }}
            />
            {msg ? (
              <Label color={c.warn} style={{ marginTop: space.sm }}>
                {msg}
              </Label>
            ) : null}
            <Button
              title="Attiva"
              busy={busy}
              style={{ marginTop: space.md, backgroundColor: RED }}
              onPress={async () => {
                setBusy(true);
                const r = await redeemCode(code);
                setBusy(false);
                if (r === 'ok') onRedeemed();
                else
                  setMsg(
                    r === 'invalid'
                      ? 'Codice non valido: controlla le lettere.'
                      : r === 'used'
                        ? 'Questo codice è già stato usato su un altro telefono.'
                        : 'Connessione assente: riprova tra poco.',
                  );
              }}
            />
          </Card>
        </>
      )}
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------------------
// informazioni, privacy, impostazioni consigliate

function InfoScreen({ onBack }: { onBack: () => void }) {
  const c = usePalette();
  const [items, setItems] = useState<CheckItem[]>([]);
  const refresh = useCallback(() => {
    readiness().then(setItems).catch(() => setItems([]));
  }, []);
  useEffect(() => {
    refresh();
    const sub = AppState.addEventListener('change', (st) => st === 'active' && refresh());
    return () => sub.remove();
  }, [refresh]);
  return (
    <ScrollView contentContainerStyle={{ padding: space.lg }}>
      <Pressable onPress={onBack} hitSlop={12}>
        <Label color={RED}>‹ Indietro</Label>
      </Pressable>
      <Text style={{ color: c.text, fontSize: 26, fontWeight: '800', marginTop: space.md }}>Impostazioni consigliate</Text>
      <Label dim style={{ marginTop: 4, marginBottom: space.md }}>
        Alcuni telefoni mettono in pausa le app per risparmiare batteria. Con queste impostazioni ParkingCT non perde i tuoi parcheggi.
      </Label>
      <Checklist items={items} onChanged={refresh} />
      <Text style={{ color: c.text, fontSize: 20, fontWeight: '800', marginTop: space.xl }}>La tua privacy</Text>
      <Label style={{ marginTop: space.sm, lineHeight: 22 }}>
        • La posizione del telefono resta sul telefono: serve a ricordare dove parcheggi.{'\n'}• Al server inviamo solo, in forma anonima, i
        parcheggi conclusi e i posti che si liberano, senza nome né numero di telefono.{'\n'}• Per il contatore usiamo solo la tua zona (circa
        5 km).{'\n'}• Nessuno vede mai dove sei tu.
      </Label>
      <Label dim size={13} style={{ marginTop: space.xl }}>
        ParkingCT · versione {shortVersion()}
      </Label>
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------------------
// festa: lancio e sostenitore

const CONFETTI = ['🎉', '🎊', '✨', '🚗', '🅿️', '⭐', '🎈'];

function Celebration({ kind, founder, onClose }: { kind: null | 'launch' | 'founder'; founder: boolean; onClose: () => void }) {
  const c = usePalette();
  const { width, height } = Dimensions.get('window');
  const pieces = useRef(
    Array.from({ length: 28 }, (_, i) => ({
      x: Math.random() * width,
      emoji: CONFETTI[i % CONFETTI.length],
      delay: Math.random() * 900,
      dur: 2200 + Math.random() * 1600,
      y: new Animated.Value(-60),
    })),
  ).current;
  const scale = useRef(new Animated.Value(0.6)).current;
  useEffect(() => {
    if (!kind) return;
    for (const p of pieces) {
      p.y.setValue(-60);
      Animated.loop(
        Animated.sequence([
          Animated.delay(p.delay),
          Animated.timing(p.y, { toValue: height + 60, duration: p.dur, easing: Easing.linear, useNativeDriver: true }),
        ]),
      ).start();
    }
    scale.setValue(0.6);
    Animated.spring(scale, { toValue: 1, friction: 4, useNativeDriver: true }).start();
  }, [kind, pieces, scale, height]);
  if (!kind) return null;
  const title = kind === 'launch' ? 'ParkingCT è attivo! 🎉' : 'Benvenuto tra i fondatori! ⭐';
  const text =
    kind === 'launch'
      ? `Da oggi ricevi gli avvisi dei posti che si liberano vicino a te.${founder ? ' Grazie per averci sostenuto fin dall\'inizio!' : ''}`
      : 'Grazie per il tuo contributo: ParkingCT nasce anche grazie a te. Il titolo di fondatore è tuo per sempre.';
  return (
    <Modal transparent animationType="fade" visible onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', padding: space.xl }}>
        {pieces.map((p, i) => (
          <Animated.Text key={i} style={{ position: 'absolute', left: p.x, top: 0, fontSize: 28, transform: [{ translateY: p.y }] }}>
            {p.emoji}
          </Animated.Text>
        ))}
        <Animated.View style={{ transform: [{ scale }], backgroundColor: c.card, borderRadius: 24, padding: space.xl, alignItems: 'center' }}>
          <Text style={{ fontSize: 64 }}>{kind === 'launch' ? '🎉' : '⭐'}</Text>
          <Text style={{ color: c.text, fontSize: 24, fontWeight: '800', textAlign: 'center', marginTop: space.md }}>{title}</Text>
          <Label dim size={16} style={{ textAlign: 'center', marginTop: space.sm }}>
            {text}
          </Label>
          <Button title="Fantastico!" style={{ marginTop: space.lg, alignSelf: 'stretch', backgroundColor: RED }} onPress={onClose} />
        </Animated.View>
      </View>
    </Modal>
  );
}

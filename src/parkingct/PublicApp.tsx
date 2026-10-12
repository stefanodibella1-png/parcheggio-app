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
  Image,
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
import { getSessions, kvGet, kvSet } from '../storage/db.ts';
import {
  APK_URL,
  euro,
  cardFee,
  testerLeftMs,
  collectPurchase,
  formatCodeInput,
  pendingPurchase,
  startPurchase,
  type Pending,
  TIER_LABEL,
  claimInvite,
  fetchAds,
  founderInfo,
  getConfig,
  giftStatus,
  logAdEvent,
  myInviteCode,
  myInviteCount,
  pickAd,
  redeemCode,
  registerDevice,
  TIER_BADGE,
  fetchWall,
  myWallEntry,
  verifyFounder,
  wallShows,
  WALL_MAX_NAMES,
  MAX_CODE_MOVES,
  type MyWall,
  saveWallEntry,
  type Ad,
  type FounderInfo,
  type Tier,
  type WallEntry,
  type PublicConfig,
} from './server.ts';
import { ControlCenter } from './ControlCenter.tsx';

const RED = '#E53935';

type Screen = 'home' | 'founder' | 'info' | 'admin' | 'wall';

// ---------------------------------------------------------------------------------------
// radice

export function PublicApp() {
  const c = usePalette();
  const [ready, setReady] = useState(false);
  const [onboarded, setOnboarded] = useState(false);
  const [screen, setScreen] = useState<Screen>('home');
  const [cfg, setCfg] = useState<PublicConfig | null>(null);
  const [founder, setFounder] = useState<FounderInfo | null>(null);
  const [party, setParty] = useState<null | 'launch' | 'founder'>(null);

  const refreshCfg = useCallback(async () => {
    const conf = await getConfig();
    setCfg(conf);
    if ((await verifyFounder()) === 'moved') {
      setFounder(null);
      Alert.alert('Codice attivo su un altro telefono', 'Il tuo codice ParkingCT è stato inserito su un altro telefono. Per usarlo di nuovo qui, inseriscilo nella pagina Fondatori.');
    }
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
          // resta sulla pagina Fondatori: lì sceglie se comparire nel muro
        }}
      />
    );
  else if (screen === 'info') body = <InfoScreen onBack={() => setScreen('home')} />;
  else if (screen === 'wall') body = <WallScreen founder={founder} onBack={() => setScreen('home')} onJoin={() => setScreen('founder')} />;
  else if (screen === 'admin') body = <ControlCenter cfg={cfg} onBack={() => setScreen('home')} />;
  else
    body = (
      <Home
        cfg={cfg}
        founder={founder}
        go={setScreen}
        onInviteReward={async () => {
          const info: FounderInfo = { code: 'INVITI', t: Date.now(), tier: 'amici', gifts: [] };
          await kvSet('pc:founder', JSON.stringify(info)).catch(() => {});
          setFounder(info);
          setParty('founder');
        }}
      />
    );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top', 'left', 'right', 'bottom']}>
      <StatusBar style={c.isDark ? 'light' : 'dark'} />
      {body}
      <Celebration
        kind={party}
        founder={!!founder}
        onClose={(next) => {
          setParty(null);
          if (next === 'code') setScreen('founder');
        }}
      />
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------------------
// benvenuto e permessi

const INTRO = [
  { icon: '🚗', title: 'Ricordo io dove hai parcheggiato', text: 'Quando parcheggi, ParkingCT salva da solo la via e il punto esatto. Non devi toccare niente.' },
  { icon: '🅿️', title: 'Basta girare a vuoto', text: "Quando cerchi parcheggio, ParkingCT ti avvisa da solo dei posti che stanno per liberarsi vicino a te, qualche minuto prima che l'auto se ne vada." },
  { icon: '🔒', title: 'La tua posizione resta tua', text: 'Non mostriamo mai a nessuno dove sei. Condividiamo solo i posti che si liberano, in forma anonima.' },
];

function Onboarding({ onDone }: { onDone: () => void }) {
  const c = usePalette();
  const [step, setStep] = useState(0);
  const [consent, setConsent] = useState(false);
  const [friend, setFriend] = useState('');
  const [friendMsg, setFriendMsg] = useState<string | null>(null);
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
      <Card style={{ marginTop: space.lg }}>
        <Label bold>Ti ha invitato un amico?</Label>
        <Label dim size={14}>
          Scrivi il suo codice amico (facoltativo): lo aiuti ad avere ParkingCT gratis per sempre.
        </Label>
        <TextInput
          value={friend}
          onChangeText={(t) => {
            setFriend(t.toUpperCase());
            setFriendMsg(null);
          }}
          autoCapitalize="characters"
          autoCorrect={false}
          placeholder="es. K7PX3M"
          placeholderTextColor={c.textDim}
          style={{ marginTop: space.sm, borderWidth: 1, borderColor: c.border, borderRadius: 12, padding: space.md, color: c.text, fontSize: 18, letterSpacing: 2, textAlign: 'center' }}
        />
        {friendMsg ? (
          <Label size={14} style={{ marginTop: 6 }} color={RED}>
            {friendMsg}
          </Label>
        ) : null}
      </Card>
      <Pressable onPress={() => setConsent(!consent)} style={{ flexDirection: 'row', alignItems: 'flex-start', marginTop: space.lg }}>
        <Text style={{ fontSize: 22, marginRight: space.sm }}>{consent ? '☑️' : '⬜️'}</Text>
        <Label size={14} style={{ flex: 1 }}>
          Accetto che ParkingCT usi la posizione del telefono per ricordare i miei parcheggi e condivida in forma anonima i posti che si
          liberano. Posso disinstallare l'app in qualsiasi momento.
        </Label>
      </Pressable>
      <Button
        title="Fatto"
        style={{ marginTop: space.lg, backgroundColor: RED }}
        disabled={!consent}
        onPress={async () => {
          if (friend.trim()) {
            const r = await claimInvite(friend);
            if (r === 'invalid' || r === 'self') {
              setFriendMsg(r === 'self' ? 'Questo è il tuo codice: serve quello del tuo amico.' : 'Codice amico non valido.');
              return;
            }
            if (r === 'offline') await kvSet('pc:pendingInvite', friend).catch(() => {});
          }
          onDone();
        }}
      />
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

function Home({
  cfg,
  founder,
  go,
  onInviteReward,
}: {
  cfg: PublicConfig | null;
  founder: FounderInfo | null;
  go: (s: Screen) => void;
  onInviteReward: () => void;
}) {
  const c = usePalette();
  const s = useHost();
  const now = useNow();
  const [zone, setZone] = useState<string | null>(null);
  const [upd, setUpd] = useState(false);
  const [ad, setAd] = useState<Ad | null>(null);
  const [invites, setInvites] = useState<number | null>(null);
  const [parks, setParks] = useState<number | null>(null);
  const taps = useRef<{ n: number; t: number }>({ n: 0, t: 0 });

  useEffect(() => {
    void updateAvailable().then(setUpd);
    void (async () => {
      const last = (await kvGet('pc:zoneT').catch(() => null)) ?? '0';
      let z = await kvGet('pc:zone').catch(() => null);
      if (!z || Date.now() - Number(last) > 12 * 3600_000) {
        const pos = await Location.getLastKnownPositionAsync().catch(() => null);
        if (pos) {
          z = (await registerDevice(pos.coords.latitude, pos.coords.longitude, !!founder, founder?.tier ?? '', shortVersion())) ?? z;
          await kvSet('pc:zoneT', String(Date.now())).catch(() => {});
        }
      }
      setZone(z);
      const ads = await fetchAds(z);
      const a = pickAd(ads);
      setAd(a);
      if (a) void logAdEvent(a, 'view', z);
      // invito rimasto in sospeso (offline durante il benvenuto)
      const pending = await kvGet('pc:pendingInvite').catch(() => null);
      if (pending) {
        const r = await claimInvite(pending);
        if (r !== 'offline') await kvSet('pc:pendingInvite', '').catch(() => {});
      }
      const n = await myInviteCount();
      setInvites(n);
    })();
  }, [founder]);

  // parcheggi ricordati da questo telefono (i test vecchi si cancellano: si tiene un contatore)
  const sessionId = s.session?.parkingId ?? null;
  useEffect(() => {
    void (async () => {
      const seen = new Set<string>(JSON.parse((await kvGet('pc:parkIds').catch(() => null)) || '[]') as string[]);
      let total = Number((await kvGet('pc:parkCount').catch(() => null)) ?? 0);
      const all = await getSessions().catch(() => []);
      for (const x of all) {
        if (x.parkedT === null || seen.has(x.parkingId)) continue;
        seen.add(x.parkingId);
        total++;
      }
      await kvSet('pc:parkIds', JSON.stringify([...seen].slice(-300))).catch(() => {});
      await kvSet('pc:parkCount', String(total)).catch(() => {});
      setParks(total);
    })();
  }, [sessionId]);

  useEffect(() => {
    if (!founder && cfg && cfg.inviteFreeAt > 0 && invites !== null && invites >= cfg.inviteFreeAt) onInviteReward();
  }, [founder, cfg, invites, onInviteReward]);

  const launched = cfg ? now >= cfg.launchAt : false;
  const testerLeft = testerLeftMs(founder, cfg, now);
  if (testerLeft !== null && testerLeft <= 0) return <TesterExpired cfg={cfg} go={go} />;
  const session = s.session;
  const st = s.snapshot?.state;
  const driving = st === 'IN_VEHICLE' || st === 'VEHICLE_MOVING' || st === 'VEHICLE_STOPPED' || st === 'POSSIBLE_PARKING' || st === 'VEHICLE_DEPARTED';
  const stale = s.active && s.rates.lastLocationT !== null && now - s.rates.lastLocationT > 10 * 60_000 && driving;

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: space.xl }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Pressable
          onPress={() => {
            // accesso segreto: 7 tocchi sul logo entro 4 secondi
            const t = Date.now();
            taps.current = t - taps.current.t > 4000 ? { n: 1, t } : { n: taps.current.n + 1, t: taps.current.t };
            if (taps.current.n >= 7) {
              taps.current = { n: 0, t: 0 };
              go('admin');
            }
          }}
          style={{ flexDirection: 'row', alignItems: 'center' }}
        >
          <Text style={{ fontSize: 30 }}>🚗</Text>
          <Text style={{ color: c.text, fontSize: 28, fontWeight: '800', marginLeft: space.sm }}>
            Parking<Text style={{ color: RED }}>CT</Text>
          </Text>
        </Pressable>
        <Pressable onPress={() => go('info')} hitSlop={12}>
          <Text style={{ fontSize: 24, color: c.text }}>ⓘ</Text>
        </Pressable>
      </View>
      {founder ? (
        <Pressable onPress={() => go('founder')}>
          <Label size={13} color={RED} bold style={{ marginTop: 2 }}>
            {TIER_BADGE[founder.tier]} {TIER_LABEL[founder.tier]}
            {founder.tier === 'tester' && testerLeft !== null && testerLeft > 0
              ? ` · ancora ${Math.ceil(testerLeft / 86_400_000)} giorni ›`
              : founder.gifts.length
                ? ` · ${founder.gifts.length} codici regalo da donare ›`
                : ''}
          </Label>
        </Pressable>
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
        <CountdownHero cfg={cfg} now={now} />
      ) : null}

      {!launched ? <MyMap parks={parks} /> : null}

      {ad ? <AdCard ad={ad} zone={zone} /> : null}

      {!launched ? <ComingSoon /> : null}

      {/* sostenitore */}
      {!founder && !launched ? (
        <Card style={{ marginTop: space.md }}>
          <Text style={{ color: c.text, fontSize: 18, fontWeight: '700' }}>⭐ Fondatori: gratis per sempre</Text>
          <Label dim style={{ marginTop: 4 }}>
            Da {euro(cfg?.priceBase ?? 3.9)} ParkingCT è tua per sempre. Con Oro e Platino ricevi anche codici regalo: gratis per sempre anche per i tuoi
            amici.
          </Label>
          <Label bold size={14} color={RED} style={{ marginTop: 6 }}>
            ⏳ Solo fino al {cfg ? fmtLaunch(cfg.launchAt) : '1° dicembre'}: dopo non si potrà più diventare fondatori.
          </Label>
          <Button title="Diventa fondatore" style={{ marginTop: space.md, backgroundColor: RED }} onPress={() => go('founder')} />
        </Card>
      ) : null}

      <InviteCard cfg={cfg} count={invites} founder={!!founder} />

      <Pressable onPress={() => go('wall')} style={{ marginTop: space.md }}>
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text style={{ fontSize: 28, marginRight: space.md }}>🧱</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ color: c.text, fontSize: 17, fontWeight: '700' }}>Il muro dei fondatori</Text>
              <Label dim size={14}>
                {founder ? 'Scegli se comparire con il tuo nome' : 'Chi ha creduto in ParkingCT fin dall\'inizio'} ›
              </Label>
            </View>
          </View>
        </Card>
      </Pressable>
    </ScrollView>
  );
}

/** fine del periodo Tester: l'app si blocca e chiede di continuare come Fondatore */
function fmtLaunch(t: number): string {
  const d = new Date(t);
  return `${d.getDate()}${d.getDate() === 1 ? '°' : ''} ${d.toLocaleDateString('it-IT', { month: 'long' })}`;
}

function TesterExpired({ cfg, go }: { cfg: PublicConfig | null; go: (s: Screen) => void }) {
  const c = usePalette();
  const founderOpen = !cfg || Date.now() < cfg.launchAt;
  return (
    <ScrollView contentContainerStyle={{ padding: space.xl, flexGrow: 1, justifyContent: 'center' }}>
      <Text style={{ fontSize: 64, textAlign: 'center' }}>🧪</Text>
      <Text style={{ color: c.text, fontSize: 26, fontWeight: '800', textAlign: 'center', marginTop: space.md }}>Grazie, Tester!</Text>
      <Label dim size={16} style={{ textAlign: 'center', marginTop: space.sm, lineHeight: 23 }}>
        Il tuo periodo di prova di {Math.round((cfg?.testerDays ?? 90) / 30)} mesi è finito. Il tuo aiuto è stato prezioso.
        {founderOpen
          ? ' Per continuare a usare ParkingCT diventa Fondatore: per te resta gratis per sempre.'
          : ' Per continuare a usare ParkingCT serve un abbonamento: le condizioni arrivano a breve, ti avviseremo qui.'}
      </Label>
      {founderOpen ? (
        <Button title={`⭐ Diventa Fondatore · ${euro(cfg?.priceBase ?? 3.9)}`} style={{ marginTop: space.xl, backgroundColor: RED }} onPress={() => go('founder')} />
      ) : null}
      <Button title="Ho già un codice" variant="ghost" style={{ marginTop: space.md }} onPress={() => go('founder')} />
    </ScrollView>
  );
}

function CarHere({ session, distanceM, now }: { session: ParkingSession; distanceM: number | null; now: number }) {
  const c = usePalette();
  const p = session.spot.pointFinal;
  const a = session.spot.address;
  const streetLine = a?.street ? `${a.street}${a.streetNumber ? `, ${a.streetNumber}` : ''}` : null;
  const where = streetLine ?? a?.place ?? (a?.formatted || 'Posizione salvata');
  const sub = [streetLine && a?.place ? a.place : null, a?.district && a.district !== a?.city ? a.district : null, a?.city]
    .filter(Boolean)
    .join(' · ');
  const since = session.parkedT ?? session.startT;
  const nav = `https://www.google.com/maps/dir/?api=1&destination=${p.latitude},${p.longitude}&travelmode=walking`;
  return (
    <Card accent={RED}>
      <Label size={13} dim bold>
        LA TUA AUTO
      </Label>
      <Text style={{ color: c.text, fontSize: 24, fontWeight: '800', marginTop: 4 }}>{where}</Text>
      {sub ? <Label dim>{sub}</Label> : null}
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

// --- conto alla rovescia "a palette" in 3D (solo Animated, nessuna libreria nativa) ---

const TILE_W = 30;
const TILE_H = 46;
const TILE_TOP = '#262E3F';
const TILE_BOTTOM = '#1C2230';

function FlipDigit({ value }: { value: string }) {
  // cifra che "rotola": la vecchia esce verso l'alto, la nuova entra dal basso (affidabile su ogni telefono)
  const [cur, setCur] = useState(value);
  const [prev, setPrev] = useState(value);
  const anim = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (value === cur) return;
    setPrev(cur);
    setCur(value);
    anim.setValue(0);
    Animated.timing(anim, { toValue: 1, duration: 380, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const txt = {
    width: TILE_W,
    height: TILE_H,
    lineHeight: TILE_H,
    textAlign: 'center' as const,
    color: '#FFFFFF',
    fontSize: 32,
    fontWeight: '800' as const,
    fontVariant: ['tabular-nums' as const],
    includeFontPadding: false,
  };
  return (
    <View
      style={{
        width: TILE_W,
        height: TILE_H,
        borderRadius: 7,
        overflow: 'hidden',
        backgroundColor: TILE_BOTTOM,
        elevation: 6,
      }}
    >
      <View style={{ position: 'absolute', left: 0, right: 0, top: 0, height: TILE_H / 2, backgroundColor: TILE_TOP }} />
      <Animated.View style={{ transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [0, -TILE_H] }) }] }}>
        <Text style={txt}>{prev}</Text>
        <Text style={txt}>{cur}</Text>
      </Animated.View>
      {/* riflesso e cerniera */}
      <View style={{ position: 'absolute', left: 0, right: 0, top: 0, height: TILE_H / 2, backgroundColor: 'rgba(255,255,255,0.04)' }} />
      <View style={{ position: 'absolute', left: 0, right: 0, top: TILE_H / 2 - 0.5, height: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} />
    </View>
  );
}

function FlipGroup({ value, label }: { value: number; label: string }) {
  const s = String(Math.max(0, value)).padStart(2, '0');
  return (
    <View style={{ alignItems: 'center' }}>
      <View style={{ flexDirection: 'row', gap: 3 }}>
        {s.split('').map((d, i) => (
          <FlipDigit key={`${s.length}-${i}`} value={d} />
        ))}
      </View>
      <Text style={{ color: '#AEB9CC', fontSize: 10, fontWeight: '800', letterSpacing: 1.4, marginTop: 8 }}>{label}</Text>
    </View>
  );
}

// --- scena animata giorno/notte (ciclo continuo di 24 s) ---
// In alto la scena (cielo, sole/luna, palazzi, strada); sotto, su un pannello pieno, le scritte
// e il conto alla rovescia: sole e luna non passano mai dietro al testo.

const CYCLE_MS = 24_000;
const SCENE_H = 230;
const ROAD_H = 46;
const HORIZON = SCENE_H - ROAD_H; // base dei palazzi
const STARS = Array.from({ length: 22 }, (_, i) => ({ x: (i * 53 + 17) % 100, y: 6 + ((i * 37 + 11) % 48), s: i % 4 === 0 ? 3 : 2 }));
const BUILDINGS = [46, 72, 56, 94, 62, 80, 50, 104, 66, 76, 54, 88, 60, 48];

function useCycle(): Animated.Value {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(v, { toValue: 1, duration: CYCLE_MS, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [v]);
  return v;
}

/**
 * Luna a spicchio come nel disegno di riferimento: disco bianco meno un disco uguale spostato
 * in alto a destra (30% del raggio). Disegnata a righe sottili: nessuna maschera, nessun cerchio scuro.
 */
const MOON_R = 17;
const CRESCENT: { top: number; left: number; width: number }[] = (() => {
  const out: { top: number; left: number; width: number }[] = [];
  const ox = 0.3 * MOON_R;
  const oy = -0.29 * MOON_R;
  for (let i = 0; i < MOON_R * 4; i++) {
    const y = i * 0.5 + 0.25 - MOON_R; // rispetto al centro
    const h = Math.sqrt(Math.max(0, MOON_R * MOON_R - y * y));
    if (h <= 0) continue;
    const o1 = -h;
    const o2 = h;
    const yi = y - oy;
    const hi = Math.abs(yi) < MOON_R ? Math.sqrt(MOON_R * MOON_R - yi * yi) : -1;
    const segs: [number, number][] = [];
    if (hi < 0) segs.push([o1, o2]);
    else {
      const i1 = ox - hi;
      const i2 = ox + hi;
      if (i1 > o1) segs.push([o1, Math.min(o2, i1)]);
      if (i2 < o2) segs.push([Math.max(o1, i2), o2]);
    }
    for (const [a, b] of segs) if (b - a > 0.05) out.push({ top: i * 0.5, left: MOON_R + a, width: b - a });
  }
  return out;
})();

function Crescent() {
  return (
    <View style={{ width: MOON_R * 2, height: MOON_R * 2 }}>
      {CRESCENT.map((r, i) => (
        <View key={i} style={{ position: 'absolute', top: r.top, left: r.left, width: r.width, height: 0.6, backgroundColor: '#FFFFFF' }} />
      ))}
    </View>
  );
}

/** sfumatura verso il basso (strisce sovrapposte: nessuna libreria di gradienti) */
function Fade({ color, top, height, max }: { color: string; top: number; height: number; max: number }) {
  const n = 10;
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top, height }}>
      {Array.from({ length: n }, (_, i) => (
        <View key={i} style={{ height: height / n, backgroundColor: color, opacity: (max * (i + 1)) / n }} />
      ))}
    </View>
  );
}

/** 0–0.42 giorno · 0.42–0.52 tramonto · 0.52–0.9 notte · 0.9–1 alba */
function Scene({ cycle, width }: { cycle: Animated.Value; width: number }) {
  const day = cycle.interpolate({ inputRange: [0, 0.42, 0.52, 0.9, 1], outputRange: [1, 1, 0, 0, 1] });
  const dusk = cycle.interpolate({ inputRange: [0, 0.38, 0.46, 0.54, 0.88, 0.95, 1], outputRange: [0, 0, 0.65, 0, 0, 0.55, 0] });
  const night = cycle.interpolate({ inputRange: [0, 0.46, 0.56, 0.86, 0.96, 1], outputRange: [0, 0, 1, 1, 0, 0] });
  // arco realistico: sorge da dietro i palazzi, sale in alto nel cielo, tramonta dall'altra parte
  const arc = (from: number, to: number, size: number) => {
    const mid = (from + to) / 2;
    return {
      x: cycle.interpolate({ inputRange: [0, from, to, 1], outputRange: [-size, -size, width, width], extrapolate: 'clamp' }),
      y: cycle.interpolate({
        inputRange: [0, from, from + (mid - from) * 0.5, mid, to - (to - mid) * 0.5, to, 1],
        outputRange: [HORIZON + 10, HORIZON + 10, 40, 14, 40, HORIZON + 10, HORIZON + 10],
        extrapolate: 'clamp',
      }),
    };
  };
  const sun = arc(0, 0.48, 40);
  const moon = arc(0.5, 0.98, 30);
  return (
    <View style={{ height: SCENE_H, overflow: 'hidden' }}>
      {/* notte (base) */}
      <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: '#16224A' }} />
      <Fade color="#2C3F75" top={HORIZON - 110} height={110} max={0.8} />
      {/* giorno */}
      <Animated.View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, opacity: day }}>
        <View style={{ flex: 1, backgroundColor: '#3A8BDB' }} />
        <Fade color="#A9D4F5" top={HORIZON - 110} height={110} max={0.75} />
      </Animated.View>
      {/* tramonto / alba */}
      <Animated.View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, opacity: dusk }}>
        <Fade color="#F4874B" top={HORIZON - 150} height={150} max={1} />
      </Animated.View>
      {/* stelle */}
      <Animated.View style={{ position: 'absolute', left: 0, right: 0, top: 0, height: HORIZON, opacity: night }}>
        {STARS.map((s, i) => (
          <View key={i} style={{ position: 'absolute', left: `${s.x}%`, top: `${s.y}%`, width: s.s, height: s.s, borderRadius: 2, backgroundColor: '#FFFFFF', opacity: 0.9 }} />
        ))}
      </Animated.View>
      {/* sole */}
      <Animated.View style={{ position: 'absolute', left: 0, top: 0, transform: [{ translateX: sun.x }, { translateY: sun.y }] }}>
        <View style={{ position: 'absolute', left: -14, top: -14, width: 68, height: 68, borderRadius: 34, backgroundColor: '#FFE082', opacity: 0.35 }} />
        <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: '#FFD54F' }} />
      </Animated.View>
      {/* luna */}
      <Animated.View style={{ position: 'absolute', left: 0, top: 0, width: 34, height: 34, transform: [{ translateX: moon.x }, { translateY: moon.y }] }}>
        <Crescent />
      </Animated.View>
      {/* palazzi: pieni, coprono sole e luna quando sorgono e tramontano */}
      <View style={{ position: 'absolute', left: 0, right: 0, top: HORIZON - 110, height: 110, flexDirection: 'row', alignItems: 'flex-end', zIndex: 5, elevation: 1 }}>
        {BUILDINGS.map((h, i) => (
          <View
            key={i}
            style={{
              flex: 1,
              height: h,
              marginHorizontal: 1,
              backgroundColor: i % 2 ? '#0B1226' : '#0F1830',
              borderTopLeftRadius: 2,
              borderTopRightRadius: 2,
              borderTopWidth: 2,
              borderLeftWidth: 1,
              borderRightWidth: 1,
              borderColor: '#4A5E92',
            }}
          >
            <Animated.View style={{ flexDirection: 'row', flexWrap: 'wrap', padding: 4, gap: 4, opacity: night }}>
              {Array.from({ length: Math.floor(h / 13) * 2 }, (_, k) => (
                <View key={k} style={{ width: 4, height: 5, backgroundColor: (k * 7 + i) % 3 === 0 ? '#FFE08A' : 'transparent' }} />
              ))}
            </Animated.View>
          </View>
        ))}
      </View>
      <Road />
    </View>
  );
}

function ParkingSign() {
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 800, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 800, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return (
    <View style={{ position: 'absolute', right: 14, bottom: 10, alignItems: 'center', zIndex: 10, elevation: 9 }}>
      <Animated.View
        style={{
          position: 'absolute',
          top: -8,
          width: 64,
          height: 64,
          borderRadius: 32,
          backgroundColor: '#42A5F5',
          opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.1, 0.45] }),
          transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1.15] }) }],
        }}
      />
      <View
        style={{
          width: 48,
          height: 48,
          borderRadius: 9,
          backgroundColor: '#1565C0',
          borderWidth: 3,
          borderColor: '#FFFFFF',
          alignItems: 'center',
          justifyContent: 'center',
          elevation: 8,
        }}
      >
        <Text style={{ color: '#FFFFFF', fontWeight: '900', fontSize: 32, lineHeight: 36, includeFontPadding: false }}>P</Text>
      </View>
      <View style={{ width: 5, height: 34, backgroundColor: '#B0BEC5', borderRadius: 2 }} />
    </View>
  );
}

function Road() {
  const move = useRef(new Animated.Value(0)).current;
  const bob = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const a = Animated.loop(Animated.timing(move, { toValue: 1, duration: 700, easing: Easing.linear, useNativeDriver: true }));
    const b = Animated.loop(
      Animated.sequence([
        Animated.timing(bob, { toValue: 1, duration: 180, useNativeDriver: true }),
        Animated.timing(bob, { toValue: 0, duration: 180, useNativeDriver: true }),
      ]),
    );
    a.start();
    b.start();
    return () => (a.stop(), b.stop());
  }, [move, bob]);
  return (
    <>
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: ROAD_H, backgroundColor: '#2B3242', overflow: 'hidden', justifyContent: 'center' }}>
        <View style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 3, backgroundColor: '#5B6578' }} />
        {/* strisce verso sinistra: l'auto va verso destra */}
        <Animated.View style={{ flexDirection: 'row', position: 'absolute', left: 0, transform: [{ translateX: move.interpolate({ inputRange: [0, 1], outputRange: [0, -40] }) }] }}>
          {Array.from({ length: 18 }, (_, i) => (
            <View key={i} style={{ width: 22, height: 3, borderRadius: 2, backgroundColor: '#E8EAED', opacity: 0.7, marginRight: 18 }} />
          ))}
        </Animated.View>
      </View>
      <Animated.Text
        style={{
          position: 'absolute',
          left: '30%',
          bottom: 12,
          zIndex: 10,
          fontSize: 34,
          transform: [{ scaleX: -1 }, { translateY: bob.interpolate({ inputRange: [0, 1], outputRange: [0, -1.5] }) }],
        }}
      >
        🚗
      </Animated.Text>
      <ParkingSign />
    </>
  );
}

/** entrata pezzo per pezzo: sale, si ingrandisce e compare */
function Piece({ delay, children, punch }: { delay: number; children: React.ReactNode; punch?: boolean }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    v.setValue(0);
    Animated.sequence([
      Animated.delay(delay),
      Animated.spring(v, { toValue: 1, friction: punch ? 4 : 6, tension: punch ? 70 : 60, useNativeDriver: true }),
    ]).start();
  }, [v, delay, punch]);
  return (
    <Animated.View
      style={{
        opacity: v.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0, 1, 1], extrapolate: 'clamp' }),
        transform: [
          { translateY: v.interpolate({ inputRange: [0, 1], outputRange: [punch ? 0 : 24, 0] }) },
          { scale: v.interpolate({ inputRange: [0, 1], outputRange: [punch ? 1.8 : 0.6, 1] }) },
        ],
      }}
    >
      {children}
    </Animated.View>
  );
}

function CountdownHero({ cfg, now }: { cfg: PublicConfig; now: number }) {
  const cycle = useCycle();
  const [w, setW] = useState(320);
  const left = Math.max(0, cfg.launchAt - now);
  const d = Math.floor(left / 86_400_000);
  const h = Math.floor((left % 86_400_000) / 3_600_000);
  const m = Math.floor((left % 3_600_000) / 60_000);
  const sec = Math.floor((left % 60_000) / 1000);
  const ld = new Date(cfg.launchAt);
  const date = `${ld.getDate()}${ld.getDate() === 1 ? '°' : ''} ${ld.toLocaleDateString('it-IT', { month: 'long' })}`;
  return (
    <View onLayout={(e) => setW(e.nativeEvent.layout.width)} style={{ marginTop: space.md, borderRadius: 24, overflow: 'hidden', backgroundColor: '#101828' }}>
      <Scene cycle={cycle} width={w} />
      <View style={{ padding: space.lg, alignItems: 'center' }}>
        <Piece delay={150}>
          <Text style={{ color: '#FFD54F', fontSize: 15, fontWeight: '900', letterSpacing: 2, textAlign: 'center' }}>IL {date.toUpperCase()}</Text>
        </Piece>
        <Piece delay={650}>
          <Text style={{ color: '#FFFFFF', fontSize: 44, fontWeight: '900', letterSpacing: -0.5, textAlign: 'center', lineHeight: 50 }}>
            Parking<Text style={{ color: '#FF4B47' }}>CT</Text>
          </Text>
        </Piece>
        <Piece delay={1150}>
          <Text style={{ color: '#FFFFFF', fontSize: 22, fontWeight: '800', textAlign: 'center' }}>si sveglia ⏰</Text>
        </Piece>
        <Piece delay={1800} punch>
          <View style={{ marginTop: space.md, backgroundColor: RED, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 6, transform: [{ rotate: '-2deg' }] }}>
            <Text style={{ color: '#FFFFFF', fontSize: 22, fontWeight: '900', textAlign: 'center' }}>Basta girare a vuoto.</Text>
          </View>
        </Piece>
        <View style={{ alignSelf: 'stretch', marginTop: space.lg }}>
          <Piece delay={2300}>
            <Text style={{ color: '#FFFFFF', fontSize: 19, fontWeight: '800' }}>Cerchi parcheggio?</Text>
            {[
              'ParkingCT trova un posto libero per te e ti informa pochi istanti prima che si\u00A0liberi.',
              'Perché chi sta andando via avvisa sempre in automatico, prima di andare\u00A0via.',
            ].map((t) => (
              <Text key={t} style={{ color: '#D7DEEA', fontSize: 15, lineHeight: 22, marginTop: 8, textAlign: 'justify' }}>
                {t}
              </Text>
            ))}
          </Piece>
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignSelf: 'stretch', marginTop: space.lg, transform: [{ perspective: 700 }, { rotateX: '16deg' }] }}>
          <FlipGroup value={d} label="GIORNI" />
          <FlipGroup value={h} label="ORE" />
          <FlipGroup value={m} label="MINUTI" />
          <FlipGroup value={sec} label="SECONDI" />
        </View>
      </View>
    </View>
  );
}

const BADGES = [
  { n: 1, name: 'Primo parcheggio', icon: '🚗' },
  { n: 5, name: 'Abitudinario', icon: '🅿️' },
  { n: 20, name: 'Conoscitore di Catania', icon: '🗺️' },
  { n: 50, name: 'Leggenda del parcheggio', icon: '🏆' },
];

function MyMap({ parks }: { parks: number | null }) {
  const c = usePalette();
  const n = parks ?? 0;
  const got = BADGES.filter((b) => n >= b.n);
  const next = BADGES.find((b) => n < b.n);
  const prev = got.length ? got[got.length - 1].n : 0;
  return (
    <Card style={{ marginTop: space.md }}>
      <Label size={13} dim bold>
        LA TUA PARTE DELLA MAPPA
      </Label>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', marginTop: 4 }}>
        <Text style={{ color: RED, fontSize: 34, fontWeight: '800' }}>{parks === null ? '–' : n}</Text>
        <Text style={{ color: c.text, fontSize: 16, fontWeight: '700', marginLeft: 8 }}>parcheggi ricordati</Text>
      </View>
      <Label dim style={{ marginTop: 2 }}>
        Ogni tuo parcheggio insegna a ParkingCT dove sono i posti veri di Catania. Al lancio sarai tra quelli che l'hanno costruita.
      </Label>
      <View style={{ flexDirection: 'row', gap: 8, marginTop: space.md }}>
        {BADGES.map((b) => {
          const on = n >= b.n;
          return (
            <View key={b.n} style={{ flex: 1, alignItems: 'center', opacity: on ? 1 : 0.35 }}>
              <Text style={{ fontSize: 26 }}>{on ? b.icon : '🔒'}</Text>
              <Text style={{ color: c.text, fontSize: 11, textAlign: 'center', marginTop: 2 }} numberOfLines={2}>
                {b.name}
              </Text>
            </View>
          );
        })}
      </View>
      {next ? (
        <>
          <View style={{ height: 8, backgroundColor: c.cardAlt, borderRadius: 4, marginTop: space.md, overflow: 'hidden' }}>
            <View style={{ width: `${Math.min(100, ((n - prev) / (next.n - prev)) * 100)}%`, height: 8, backgroundColor: RED }} />
          </View>
          <Label dim size={13} style={{ marginTop: 4 }}>
            Ancora {next.n - n} parcheggi per «{next.name}»
          </Label>
        </>
      ) : null}
    </Card>
  );
}

function ComingSoon() {
  const c = usePalette();
  const items = [
    { icon: '⏱️', title: 'Posti che si liberano tra pochi minuti', text: 'Sai in anticipo che un posto vicino a te sta per liberarsi.' },
    { icon: '🔊', title: 'Avviso a voce mentre guidi', text: 'Niente telefono in mano: te lo dice ParkingCT.' },
    { icon: '🤝', title: 'Quando parti, aiuti chi cerca', text: 'Il tuo posto passa in automatico a chi è lì vicino.' },
  ];
  return (
    <Card style={{ marginTop: space.md }}>
      <Label size={13} dim bold>
        SI SBLOCCA AL LANCIO
      </Label>
      {items.map((i) => (
        <View key={i.title} style={{ flexDirection: 'row', alignItems: 'flex-start', marginTop: space.md }}>
          <Text style={{ fontSize: 24, marginRight: space.md }}>{i.icon}</Text>
          <View style={{ flex: 1 }}>
            <Text style={{ color: c.text, fontSize: 16, fontWeight: '700' }}>{i.title}</Text>
            <Label dim size={14}>
              {i.text}
            </Label>
          </View>
          <Text style={{ fontSize: 16 }}>🔒</Text>
        </View>
      ))}
      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: space.md, padding: space.md, borderRadius: 14, backgroundColor: c.cardAlt }}>
        <Text style={{ fontSize: 28, marginRight: space.md }}>🎁</Text>
        <Label size={14} style={{ flex: 1 }}>
          <Label bold size={14}>
            E una sorpresa
          </Label>{' '}
          per chi c'è già prima del lancio. Tieni ParkingCT sul telefono.
        </Label>
      </View>
    </Card>
  );
}

function inviteMessage(cfg: PublicConfig | null, code: string): string {
  return (
    `Uso ParkingCT: ricorda dove parcheggi e ti avvisa quando un posto si libera vicino a te, senza girare a vuoto. È gratis.\n\n` +
    `Scaricala: ${cfg?.landingUrl || APK_URL}\n` +
    `Al primo avvio inserisci il mio codice amico: ${code}`
  );
}

function InviteCard({ cfg, count, founder }: { cfg: PublicConfig | null; count: number | null; founder: boolean }) {
  const c = usePalette();
  const [code, setCode] = useState('');
  useEffect(() => {
    void myInviteCode().then(setCode);
  }, []);
  const goal = cfg?.inviteFreeAt ?? 10;
  const n = count ?? 0;
  const level = n >= goal ? 'Fondatore ad honorem' : n >= 3 ? 'Ambasciatore' : n >= 1 ? 'Apripista' : null;
  return (
    <Card style={{ marginTop: space.md }}>
      <Text style={{ color: c.text, fontSize: 18, fontWeight: '700' }}>🤝 Invita i tuoi amici</Text>
      <Label dim style={{ marginTop: 4 }}>
        {founder || goal <= 0
          ? 'Più amici nella tua zona = più posti segnalati per tutti.'
          : `Porta ${goal} amici su ParkingCT e per te è gratis per sempre, senza pagare nulla.`}
      </Label>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.md }}>
        <View>
          <Label size={13} dim>
            Il tuo codice amico
          </Label>
          <Text selectable style={{ color: c.text, fontSize: 24, fontWeight: '800', letterSpacing: 3 }}>
            {code || '……'}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={{ color: RED, fontSize: 24, fontWeight: '800' }}>{count === null ? '–' : n}</Text>
          <Label size={13} dim>
            amici invitati
          </Label>
        </View>
      </View>
      {!founder && goal > 0 ? (
        <View style={{ height: 8, backgroundColor: c.cardAlt, borderRadius: 4, marginTop: space.sm, overflow: 'hidden' }}>
          <View style={{ width: `${Math.min(100, (n / goal) * 100)}%`, height: 8, backgroundColor: RED }} />
        </View>
      ) : null}
      {level ? (
        <Label size={14} bold color={RED} style={{ marginTop: space.sm }}>
          🏅 {level}
        </Label>
      ) : null}
      <Label dim size={13} style={{ marginTop: space.sm }}>
        1 amico: Apripista · 3 amici: Ambasciatore{goal > 0 ? ` · ${goal} amici: gratis per sempre` : ''}
      </Label>
      <Button title="Invita su WhatsApp o altro" style={{ marginTop: space.md, backgroundColor: RED }} onPress={() => Share.share({ message: inviteMessage(cfg, code) })} />
    </Card>
  );
}

function AdCard({ ad, zone }: { ad: Ad; zone: string | null }) {
  const c = usePalette();
  const open = () => {
    void logAdEvent(ad, 'click', zone);
    if (ad.url) void Linking.openURL(ad.url).catch(() => {});
  };
  return (
    <Pressable onPress={open} style={{ marginTop: space.md }}>
      <Card>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Label size={12} dim bold>
            SPONSORIZZATO{ad.sponsor ? ` · ${ad.sponsor.toUpperCase()}` : ''}
          </Label>
        </View>
        {ad.image ? <Image source={{ uri: ad.image }} style={{ width: '100%', height: 140, borderRadius: 12, marginTop: space.sm }} resizeMode="cover" /> : null}
        <Text style={{ color: c.text, fontSize: 18, fontWeight: '700', marginTop: space.sm }}>{ad.title}</Text>
        {ad.text ? (
          <Label dim style={{ marginTop: 4 }}>
            {ad.text}
          </Label>
        ) : null}
        {ad.url ? <Button small variant="ghost" title={ad.cta || 'Scopri'} style={{ marginTop: space.md }} onPress={open} /> : null}
      </Card>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------------------
// sostenitore fondatore

function TierCard({
  title,
  price,
  perks,
  highlight,
  onPress,
  priceLabel,
  note,
}: {
  title: string;
  price: number;
  perks: string[];
  highlight?: boolean;
  onPress: () => void;
  priceLabel?: string;
  note?: string;
}) {
  const c = usePalette();
  return (
    <Pressable onPress={onPress}>
      <Card style={{ marginTop: space.md, borderColor: highlight ? RED : c.border, borderWidth: highlight ? 2 : 1 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <Text style={{ color: c.text, fontSize: 19, fontWeight: '800' }}>{title}</Text>
          <Text style={{ color: RED, fontSize: 19, fontWeight: '800' }}>{priceLabel ?? euro(price)}</Text>
        </View>
        {highlight ? (
          <Label size={12} bold color={RED}>
            IL PIÙ SCELTO
          </Label>
        ) : null}
        {perks.map((p) => (
          <Label key={p} style={{ marginTop: 4 }}>
            {p}
          </Label>
        ))}
        {note ? (
          <Label dim size={13} style={{ marginTop: 6 }}>
            {note}
          </Label>
        ) : null}
        <Button
          title={`Scegli ${title}${priceLabel ? '' : ` · ${euro(price)}`}`}
          small
          style={{ marginTop: space.md, backgroundColor: highlight ? RED : '#37474F' }}
          onPress={onPress}
        />
      </Card>
    </Pressable>
  );
}

function FounderScreen({
  cfg,
  founder,
  onBack,
  onRedeemed,
}: {
  cfg: PublicConfig | null;
  founder: FounderInfo | null;
  onBack: () => void;
  onRedeemed: () => void;
}) {
  const c = usePalette();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [used, setUsed] = useState<Record<string, boolean>>({});
  useEffect(() => {
    if (founder?.gifts.length) void giftStatus(founder.gifts).then(setUsed);
  }, [founder]);
  const [pending, setPending] = useState<Pending | null>(null);
  const buy = async (tier: Tier) => {
    const url = await startPurchase(cfg, tier);
    if (!url) {
      if (cfg?.supportUrl) void Linking.openURL(cfg.supportUrl);
      else Alert.alert('Quasi pronto', "I pagamenti aprono a breve: ti avviseremo nell'app.");
      return;
    }
    setPending(await pendingPurchase());
    void Linking.openURL(url);
  };
  // pagamento fatto? il codice arriva qui da solo (controllo ogni 10 s mentre la pagina è aperta)
  const redeemedRef = useRef(onRedeemed);
  redeemedRef.current = onRedeemed;
  useEffect(() => {
    let stop = false;
    const check = async () => {
      const p = await pendingPurchase();
      if (stop) return;
      setPending(p);
      if (!p) return;
      const got = await collectPurchase();
      if (stop || !got) return;
      if (got.result === 'ok' || got.result === 'moved') {
        setPending(null);
        Alert.alert('Pagamento ricevuto! 🎉', `Il tuo codice personale è ${got.code}. È già attivo su questo telefono: conservalo, ti serve se cambi telefono.`);
        redeemedRef.current();
      }
    };
    void check();
    const id = setInterval(() => void check(), 10_000);
    const sub = AppState.addEventListener('change', (st) => st === 'active' && void check());
    return () => {
      stop = true;
      clearInterval(id);
      sub.remove();
    };
  }, []);
  const support = () => void buy('oro');
  const gold = cfg?.giftsGold ?? 3;
  const plat = cfg?.giftsPlat ?? 7;
  // dopo il lancio non si può più diventare fondatori (i codici già comprati restano validi)
  const founderOpen = !cfg || Date.now() < cfg.launchAt;
  return (
    <ScrollView contentContainerStyle={{ padding: space.lg }} keyboardShouldPersistTaps="handled">
      <Pressable onPress={onBack} hitSlop={12}>
        <Label color={RED}>‹ Indietro</Label>
      </Pressable>
      <Text style={{ fontSize: 56, textAlign: 'center', marginTop: space.md }}>⭐</Text>
      <Text style={{ color: c.text, fontSize: 26, fontWeight: '800', textAlign: 'center' }}>Sostenitore fondatore</Text>
      <Label dim size={16} style={{ textAlign: 'center', marginTop: space.sm }}>
        ParkingCT nasce a Catania, da un catanese. Con un piccolo contributo l'aiuti a partire e la usi gratis per sempre.
      </Label>
      {pending ? (
        <Card accent={RED} style={{ marginTop: space.lg }}>
          <Label bold>⏳ Pagamento in verifica</Label>
          <Label dim size={14} style={{ marginTop: 4 }}>
            Appena il pagamento è confermato il tuo codice compare qui e si attiva da solo (di solito entro pochi minuti). Puoi chiudere l'app:
            lo ritroverai quando la riapri.
          </Label>
        </Card>
      ) : null}

      {founder ? (
        <>
          <Card accent={RED} style={{ marginTop: space.lg }}>
            <Label bold color={RED}>
              Sei {TIER_LABEL[founder.tier]}. Grazie! 🎉
            </Label>
            {founder.tier !== 'amici' ? <Label dim style={{ marginTop: 4 }}>Codice: {founder.code}</Label> : null}
          </Card>
          {founder.tier !== 'amici' ? (
            <Card style={{ marginTop: space.md }}>
              <Label bold>🔑 Conserva il tuo codice</Label>
              <Text selectable style={{ color: c.text, fontSize: 22, fontWeight: '800', letterSpacing: 1, marginTop: 4 }}>
                {founder.code}
              </Text>
              <Label dim size={14} style={{ marginTop: 4 }}>
                Se cambi telefono o reinstalli l'app, inserisci di nuovo questo codice: ParkingCT torna attivo gratis, con il tuo livello e il tuo
                nome nel muro. Vale per un telefono alla volta.
              </Label>
              <Button
                small
                variant="ghost"
                title="Salvalo (WhatsApp, note, email…)"
                style={{ marginTop: space.md }}
                onPress={() =>
                  Share.share({
                    message: `Il mio codice ParkingCT (${TIER_LABEL[founder.tier]}): ${founder.code}\nConservalo: serve per riattivare l'app gratis se cambi telefono o la reinstalli.`,
                  })
                }
              />
            </Card>
          ) : null}
          <WallChoice founder={founder} />
          {founder.gifts.length ? (
            <Card style={{ marginTop: space.md }}>
              <Label bold>🎁 I tuoi codici regalo</Label>
              <Label dim size={14} style={{ marginTop: 4 }}>
                Regalali a chi vuoi: per loro ParkingCT è gratis per sempre. Ogni codice vale per un telefono.
              </Label>
              {founder.gifts.map((g) => (
                <View key={g} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.md }}>
                  <View>
                    <Text selectable style={{ color: c.text, fontSize: 18, fontWeight: '800', letterSpacing: 1 }}>
                      {g}
                    </Text>
                    <Label dim size={13}>
                      {used[g] ? '✅ già usato da un amico' : 'disponibile'}
                    </Label>
                  </View>
                  {!used[g] ? (
                    <Button
                      small
                      title="Regala"
                      style={{ backgroundColor: RED, paddingHorizontal: space.lg }}
                      onPress={() =>
                        Share.share({
                          message: `Ti regalo ParkingCT gratis per sempre! 🎁\nTrova parcheggio senza girare a vuoto.\n\nScaricala: ${cfg?.landingUrl || APK_URL}\nPoi in "Fondatori" inserisci il codice: ${g}`,
                        })
                      }
                    />
                  ) : null}
                </View>
              ))}
            </Card>
          ) : null}
          {founderOpen && (founder.tier === 'base' || founder.tier === 'regalo' || founder.tier === 'amici' || founder.tier === 'tester') ? (
            <Card style={{ marginTop: space.md }}>
              <Label bold>Vuoi regalarla anche ai tuoi amici?</Label>
              <Label dim size={14} style={{ marginTop: 4 }}>
                Con Fondatore Oro ricevi {gold} codici regalo, con Platino {plat}.
              </Label>
              <Button small title="Passa a Oro o Platino" style={{ marginTop: space.md, backgroundColor: RED }} onPress={support} />
            </Card>
          ) : null}
        </>
      ) : null}

      {!founderOpen ? (
        <Card style={{ marginTop: space.lg }}>
          <Label bold>Le iscrizioni dei fondatori sono chiuse</Label>
          <Label dim size={14} style={{ marginTop: 4 }}>
            Si poteva diventare fondatori fino al {cfg ? fmtLaunch(cfg.launchAt) : '1° dicembre'}. Se hai già un codice, inseriscilo qui sotto: resta
            valido per sempre.
          </Label>
        </Card>
      ) : null}
      {founderOpen && (!founder || founder.tier === 'base' || founder.tier === 'regalo' || founder.tier === 'amici' || founder.tier === 'tester') ? (
        <>
          {!founder ? (
            <TierCard
              title="Tester"
              price={cfg?.testerMin ?? 1}
              priceLabel="offerta libera"
              perks={[
                `🧪 ParkingCT completa per ${Math.round((cfg?.testerDays ?? 90) / 30)} mesi dall'attivazione`,
                '🚗 Ricorda dove parcheggi e, dal lancio, ti avvisa dei posti che si liberano',
                '🛠️ Partecipi allo sviluppo: le tue segnalazioni contano',
              ]}
              note="Scegli tu quanto dare: è un'offerta libera."
              onPress={() => void buy('tester')}
            />
          ) : null}
          <TierCard
            title="Fondatore"
            price={cfg?.priceBase ?? 3.9}
            perks={['🎁 ParkingCT gratis per sempre', '⭐ Il titolo di fondatore nell\'app', '🧱 Il tuo nome nel muro dei fondatori']}
            onPress={() => void buy('base')}
          />
          <TierCard
            title="Fondatore Oro"
            price={cfg?.priceGold ?? 9.9}
            highlight
            perks={[
              '🎁 ParkingCT gratis per sempre',
              `🎟️ In più ${gold} codici regalo: gratis per sempre anche per ${gold} amici`,
              '🚗 L\'adesivo ParkingCT per l\'auto',
              '🧱 Nome nel muro dei fondatori, in evidenza',
            ]}
            onPress={() => void buy('oro')}
          />
          <TierCard
            title="Fondatore Platino"
            price={cfg?.pricePlat ?? 19.9}
            perks={[
              '🎁 ParkingCT gratis per sempre',
              `🎟️ In più ${plat} codici regalo per ${plat} tra famiglia e amici`,
              '🚗 L\'adesivo ParkingCT per l\'auto',
              '🏆 Nome in cima al muro dei fondatori',
            ]}
            onPress={() => void buy('platino')}
          />
          <Label bold size={14} color={RED} style={{ marginTop: space.md, textAlign: 'center' }}>
            ⏳ Si può diventare fondatori solo fino al {cfg ? fmtLaunch(cfg.launchAt) : '1° dicembre'}.
          </Label>
          <Label dim size={13} style={{ marginTop: space.sm, textAlign: 'center' }}>
            Paghi in modo sicuro con Stripe (carta, Apple Pay, Google Pay). Il codice personale arriva qui nell'app entro pochi minuti e si attiva da
            solo: conservalo.
          </Label>
        </>
      ) : null}

      <Card style={{ marginTop: space.lg }}>
        <Label bold>{founder ? 'Hai un altro codice?' : 'Hai già il codice?'}</Label>
        <Label dim size={14} style={{ marginTop: 4 }}>
          Il codice è come ABCD-EFGH-JKLM: arriva dopo il contributo o in regalo da un amico. Hai cambiato telefono o reinstallato l'app? Inserisci
          qui lo stesso codice.
        </Label>
        <TextInput
          value={code}
          onChangeText={(t) => {
            setCode(formatCodeInput(t));
            setMsg(null);
          }}
          autoCapitalize="characters"
          autoCorrect={false}
          placeholder="XXXX-XXXX-XXXX"
          maxLength={14}
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
            if (r === 'ok' || r === 'moved') {
              if (r === 'moved')
                Alert.alert('Codice spostato su questo telefono', 'Bentornato! Sul telefono precedente ParkingCT non risulta più attivo con questo codice.');
              onRedeemed();
            } else
              setMsg(
                r === 'invalid'
                  ? 'Codice non valido: controlla le lettere.'
                  : r === 'limit'
                    ? `Questo codice è già stato spostato ${MAX_CODE_MOVES} volte: scrivici per riattivarlo.`
                    : 'Connessione assente: riprova tra poco.',
              );
          }}
        />
      </Card>
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------------------
// muro dei fondatori

const TIER_LEGEND: { tier: Tier; text: string }[] = [
  { tier: 'platino', text: 'Platino' },
  { tier: 'oro', text: 'Oro' },
  { tier: 'base', text: 'Fondatore' },
  { tier: 'regalo', text: 'Regalo di un amico' },
  { tier: 'amici', text: 'Ha portato i suoi amici' },
  { tier: 'tester', text: 'Tester' },
];

function WallChoice({ founder, onSaved }: { founder: FounderInfo; onSaved?: () => void }) {
  const c = usePalette();
  const [visible, setVisible] = useState(true);
  const [name, setName] = useState('');
  const [saved, setSaved] = useState<MyWall | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    void myWallEntry(founder).then((w) => {
      setSaved(w);
      if (w) {
        setVisible(w.visible);
        setName(w.name);
      }
    });
  }, []);
  return (
    <Card style={{ marginTop: space.md }} accent={saved ? undefined : RED}>
      <Label bold>🧱 Il muro dei fondatori</Label>
      <Label dim size={14} style={{ marginTop: 4 }}>
        Vuoi che il tuo nome compaia nel muro dei fondatori, visibile a tutti gli utenti di ParkingCT? Accanto al nome c'è il simbolo del tuo
        livello {TIER_BADGE[founder.tier]}.
      </Label>
      <View style={{ flexDirection: 'row', gap: 8, marginTop: space.md }}>
        {[
          { v: true, t: 'Sì, mostra il nome' },
          { v: false, t: 'No, resto anonimo' },
        ].map((o) => (
          <Pressable
            key={o.t}
            onPress={() => setVisible(o.v)}
            style={{
              flex: 1,
              minHeight: 44,
              borderRadius: 12,
              alignItems: 'center',
              justifyContent: 'center',
              paddingHorizontal: 6,
              backgroundColor: visible === o.v ? RED : c.cardAlt,
            }}
          >
            <Text style={{ color: visible === o.v ? '#FFFFFF' : c.text, fontWeight: '700', textAlign: 'center' }}>{o.t}</Text>
          </Pressable>
        ))}
      </View>
      {visible ? (
        <TextInput
          value={name}
          editable={(saved?.edits ?? 0) < WALL_MAX_NAMES || !saved?.name}
          onChangeText={(t) => (setName(t), setMsg(null))}
          maxLength={24}
          placeholder="Come vuoi comparire? es. Mario R."
          placeholderTextColor={c.textDim}
          style={{ marginTop: space.md, borderWidth: 1, borderColor: c.border, borderRadius: 12, padding: space.md, color: c.text, fontSize: 17 }}
        />
      ) : null}
      <Label dim size={13} style={{ marginTop: space.sm }}>
        🔒 Pubblichiamo solo il nome che scrivi tu (puoi usare un soprannome o le iniziali). Puoi toglierlo quando vuoi. Niente parolacce, link o
        numeri: i nomi sono controllati.
      </Label>
      <Label size={13} bold style={{ marginTop: 4 }} color={(saved?.edits ?? 0) >= WALL_MAX_NAMES ? RED : undefined}>
        {!saved || (saved.edits ?? 0) === 0
          ? '✍️ Controlla bene: dopo, il nome si può correggere una sola volta.'
          : (saved.edits ?? 0) < WALL_MAX_NAMES
            ? '✍️ Ti resta una sola correzione del nome.'
            : '✍️ Hai già usato la correzione: il nome non si può più cambiare (puoi sempre tornare anonimo).'}
      </Label>
      {msg ? (
        <Label size={14} color={RED} style={{ marginTop: space.sm }}>
          {msg}
        </Label>
      ) : null}
      <Button
        title={saved ? 'Aggiorna' : 'Conferma'}
        busy={busy}
        style={{ marginTop: space.md, backgroundColor: RED }}
        onPress={async () => {
          if (visible && !name.trim()) {
            setMsg('Scrivi come vuoi comparire, oppure scegli "resto anonimo".');
            return;
          }
          setBusy(true);
          const r = await saveWallEntry(founder, name, visible);
          setBusy(false);
          if (r === 'blocked') {
            setMsg('Questo nome non è ammesso: niente parolacce, link o numeri di telefono.');
            return;
          }
          if (r === 'limit') {
            setMsg('Hai già corretto il nome una volta: non si può più cambiare. Puoi solo restare anonimo.');
            return;
          }
          if (r === 'locked') {
            setMsg('Il tuo nome è stato nascosto dalla moderazione: non si può più modificare.');
            return;
          }
          if (r === 'offline') {
            setMsg('Connessione assente: riprova tra poco.');
            return;
          }
          setSaved(await myWallEntry(founder));
          setMsg(
            !visible
              ? 'Fatto: resti anonimo, ma conti tra i fondatori.'
              : r === 'review'
                ? 'Ricevuto: il nome comparirà nel muro dopo un controllo.'
                : 'Fatto: sei nel muro dei fondatori!',
          );
          onSaved?.();
        }}
      />
    </Card>
  );
}

function WallScreen({ founder, onBack, onJoin }: { founder: FounderInfo | null; onBack: () => void; onJoin: () => void }) {
  const c = usePalette();
  const [list, setList] = useState<WallEntry[] | null | undefined>(undefined);
  useEffect(() => {
    void fetchWall().then(setList);
  }, []);
  const shown = (list ?? []).filter(wallShows);
  const anon = (list ?? []).length - shown.length;
  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: space.xl }}>
      <Pressable onPress={onBack} hitSlop={12}>
        <Label color={RED}>‹ Indietro</Label>
      </Pressable>
      <Text style={{ fontSize: 48, textAlign: 'center', marginTop: space.md }}>🧱</Text>
      <Text style={{ color: c.text, fontSize: 26, fontWeight: '800', textAlign: 'center' }}>Il muro dei fondatori</Text>
      <Label dim size={15} style={{ textAlign: 'center', marginTop: 4 }}>
        Chi ha creduto in ParkingCT fin dall'inizio. Grazie!
      </Label>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 10, marginTop: space.md }}>
        {TIER_LEGEND.map((l) => (
          <Label key={l.tier} size={13} dim>
            {TIER_BADGE[l.tier]} {l.text}
          </Label>
        ))}
      </View>
      {list === undefined ? <Label dim style={{ marginTop: space.lg, textAlign: 'center' }}>Carico…</Label> : null}
      {list === null ? <Label dim style={{ marginTop: space.lg, textAlign: 'center' }}>Connessione assente: riprova tra poco.</Label> : null}
      {list && shown.length === 0 ? (
        <Card style={{ marginTop: space.lg }}>
          <Label bold>Il muro si sta riempiendo</Label>
          <Label dim style={{ marginTop: 4 }}>
            I primi nomi stanno per arrivare. Il tuo può essere tra questi.
          </Label>
        </Card>
      ) : null}
      {shown.length ? (
        <Card style={{ marginTop: space.lg }}>
          {shown.map((w, i) => (
            <View
              key={w.id}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                paddingVertical: 10,
                borderTopWidth: i === 0 ? 0 : 1,
                borderColor: c.border,
              }}
            >
              <Text style={{ width: 34, fontSize: w.tier === 'platino' ? 22 : 18 }}>{TIER_BADGE[w.tier]}</Text>
              <Text
                style={{
                  flex: 1,
                  color: c.text,
                  fontSize: w.tier === 'platino' ? 19 : w.tier === 'oro' ? 17 : 16,
                  fontWeight: w.tier === 'platino' || w.tier === 'oro' ? '800' : '600',
                }}
              >
                {w.name}
              </Text>
            </View>
          ))}
        </Card>
      ) : null}
      {list && anon > 0 ? (
        <Label dim style={{ marginTop: space.md, textAlign: 'center' }}>
          …e altri {anon} fondator{anon === 1 ? 'e' : 'i'} che preferiscono restare anonim{anon === 1 ? 'o' : 'i'}.
        </Label>
      ) : null}
      {founder ? (
        <WallChoice founder={founder} onSaved={() => void fetchWall().then(setList)} />
      ) : (
        <Button title="⭐ Entra anche tu nel muro" style={{ marginTop: space.lg, backgroundColor: RED }} onPress={onJoin} />
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
        parcheggi conclusi e i posti che si liberano, senza nome né numero di telefono.{'\n'}• Per statistiche anonime usiamo solo la tua zona (circa
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

function Celebration({ kind, founder, onClose }: { kind: null | 'launch' | 'founder'; founder: boolean; onClose: (next?: 'code') => void }) {
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
      : 'ParkingCT nasce anche grazie a te. Per te è attiva gratis, per sempre.';
  return (
    <Modal transparent animationType="fade" visible onRequestClose={() => onClose()}>
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
          {kind === 'launch' && !founder ? (
            <>
              <Label size={15} style={{ textAlign: 'center', marginTop: space.md }}>
                Hai sostenuto ParkingCT? Inserisci ora il tuo codice: per te resta gratis per sempre.
              </Label>
              <Button title="Inserisci il codice" style={{ marginTop: space.md, alignSelf: 'stretch', backgroundColor: RED }} onPress={() => onClose('code')} />
              <Button title="Più tardi" variant="ghost" style={{ marginTop: space.sm, alignSelf: 'stretch' }} onPress={() => onClose()} />
            </>
          ) : (
            <Button title="Fantastico!" style={{ marginTop: space.lg, alignSelf: 'stretch', backgroundColor: RED }} onPress={() => onClose()} />
          )}
        </Animated.View>
      </View>
    </Modal>
  );
}

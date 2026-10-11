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
  type Ad,
  type FounderInfo,
  type PublicConfig,
} from './server.ts';
import { ControlCenter } from './ControlCenter.tsx';

const RED = '#E53935';

type Screen = 'home' | 'founder' | 'info' | 'admin';

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
            ⭐ {TIER_LABEL[founder.tier]}
            {founder.gifts.length ? ` · ${founder.gifts.length} codici regalo da donare ›` : ''}
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
      {!founder ? (
        <Card style={{ marginTop: space.md }}>
          <Text style={{ color: c.text, fontSize: 18, fontWeight: '700' }}>⭐ Fondatori: gratis per sempre</Text>
          <Label dim style={{ marginTop: 4 }}>
            Da {cfg?.priceBase ?? 3} € ParkingCT è tua per sempre. Con Oro e Platino ricevi anche codici regalo: gratis per sempre anche per i tuoi
            amici.
          </Label>
          <Button title="Diventa fondatore" style={{ marginTop: space.md, backgroundColor: RED }} onPress={() => go('founder')} />
        </Card>
      ) : null}

      <InviteCard cfg={cfg} count={invites} founder={!!founder} />
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

// --- conto alla rovescia "a palette" in 3D (solo Animated, nessuna libreria nativa) ---

const TILE_W = 30;
const TILE_H = 46;
const TILE_TOP = '#262E3F';
const TILE_BOTTOM = '#1C2230';

function Half({ digit, top }: { digit: string; top: boolean }) {
  return (
    <View
      style={{
        height: TILE_H / 2,
        width: TILE_W,
        overflow: 'hidden',
        backgroundColor: top ? TILE_TOP : TILE_BOTTOM,
        borderTopLeftRadius: top ? 7 : 0,
        borderTopRightRadius: top ? 7 : 0,
        borderBottomLeftRadius: top ? 0 : 7,
        borderBottomRightRadius: top ? 0 : 7,
      }}
    >
      <Text
        style={{
          position: 'absolute',
          top: top ? 0 : -TILE_H / 2,
          width: TILE_W,
          height: TILE_H,
          lineHeight: TILE_H,
          textAlign: 'center',
          color: '#FFFFFF',
          fontSize: 32,
          fontWeight: '800',
          fontVariant: ['tabular-nums'],
          includeFontPadding: false,
        }}
      >
        {digit}
      </Text>
    </View>
  );
}

function FlipDigit({ value }: { value: string }) {
  const [cur, setCur] = useState(value);
  const [prev, setPrev] = useState(value);
  const anim = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (value === cur) return;
    setPrev(cur);
    setCur(value);
    anim.setValue(0);
    Animated.timing(anim, { toValue: 1, duration: 520, easing: Easing.inOut(Easing.quad), useNativeDriver: true }).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const topRot = anim.interpolate({ inputRange: [0, 0.5, 1], outputRange: ['0deg', '-90deg', '-90deg'] });
  const botRot = anim.interpolate({ inputRange: [0, 0.5, 1], outputRange: ['90deg', '90deg', '0deg'] });
  const shade = anim.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, 0.45, 0] });
  return (
    <View
      style={{
        width: TILE_W,
        height: TILE_H,
        borderRadius: 7,
        shadowColor: '#000',
        shadowOpacity: 0.5,
        shadowRadius: 6,
        shadowOffset: { width: 0, height: 5 },
        elevation: 8,
        backgroundColor: TILE_BOTTOM,
      }}
    >
      {/* dietro: metà alta nuova, metà bassa vecchia */}
      <Half digit={cur} top />
      <Half digit={prev} top={false} />
      {/* palette che cade */}
      <Animated.View
        style={{ position: 'absolute', top: 0, transformOrigin: 'bottom', transform: [{ perspective: 300 }, { rotateX: topRot }], backfaceVisibility: 'hidden' }}
      >
        <Half digit={prev} top />
      </Animated.View>
      <Animated.View
        style={{ position: 'absolute', top: TILE_H / 2, transformOrigin: 'top', transform: [{ perspective: 300 }, { rotateX: botRot }], backfaceVisibility: 'hidden' }}
      >
        <Half digit={cur} top={false} />
      </Animated.View>
      {/* ombra mentre gira */}
      <Animated.View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: TILE_H / 2, height: TILE_H / 2, backgroundColor: '#000', opacity: shade, borderBottomLeftRadius: 7, borderBottomRightRadius: 7 }} />
      {/* cerniera */}
      <View style={{ position: 'absolute', left: 0, right: 0, top: TILE_H / 2 - 0.5, height: 1, backgroundColor: 'rgba(0,0,0,0.6)' }} />
      <View style={{ position: 'absolute', left: -2, top: TILE_H / 2 - 3, width: 3, height: 6, borderRadius: 1, backgroundColor: '#0B0E15' }} />
      <View style={{ position: 'absolute', right: -2, top: TILE_H / 2 - 3, width: 3, height: 6, borderRadius: 1, backgroundColor: '#0B0E15' }} />
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
      <Text style={{ color: '#FFFFFF', fontSize: 10, fontWeight: '800', letterSpacing: 1.4, marginTop: 8, backgroundColor: 'rgba(8,14,32,0.55)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, overflow: 'hidden' }}>{label}</Text>
    </View>
  );
}

// --- cielo animato giorno/notte (ciclo continuo di 24 s) ---

const CYCLE_MS = 24_000;
const STARS = Array.from({ length: 16 }, (_, i) => ({ x: (i * 53 + 17) % 100, y: (i * 37 + 11) % 55, s: i % 3 === 0 ? 3 : 2 }));
const BUILDINGS = [38, 62, 48, 80, 54, 70, 44, 90, 58, 66, 46, 76, 52, 40];

function useCycle(): Animated.Value {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(v, { toValue: 1, duration: CYCLE_MS, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [v]);
  return v;
}

/** 0–0.42 giorno · 0.42–0.52 tramonto · 0.52–0.9 notte · 0.9–1 alba */
function Sky({ cycle, width }: { cycle: Animated.Value; width: number }) {
  const day = cycle.interpolate({ inputRange: [0, 0.42, 0.52, 0.9, 1], outputRange: [1, 1, 0, 0, 1] });
  const dusk = cycle.interpolate({ inputRange: [0, 0.38, 0.46, 0.54, 0.88, 0.95, 1], outputRange: [0, 0, 0.6, 0, 0, 0.5, 0] });
  const night = cycle.interpolate({ inputRange: [0, 0.46, 0.56, 0.86, 0.96, 1], outputRange: [0, 0, 1, 1, 0, 0] });
  const arc = (from: number, to: number) => ({
    x: cycle.interpolate({ inputRange: [0, from, to, 1], outputRange: [-40, -40, width, width], extrapolate: 'clamp' }),
    y: cycle.interpolate({ inputRange: [0, from, (from + to) / 2, to, 1], outputRange: [300, 300, 215, 300, 300], extrapolate: 'clamp' }),
  });
  const sun = arc(0, 0.48);
  const moon = arc(0.5, 0.98);
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }}>
      {/* notte (base) */}
      <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: '#1B2747' }} />
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: '55%', backgroundColor: '#2A3B66', opacity: 0.6 }} />
      {/* giorno */}
      <Animated.View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, opacity: day }}>
        <View style={{ flex: 1, backgroundColor: '#2E78C7' }} />
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: '55%', backgroundColor: '#5FA2E3', opacity: 0.55 }} />
      </Animated.View>
      {/* tramonto e alba */}
      <Animated.View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: '70%', backgroundColor: '#F08A4B', opacity: dusk }} />
      {/* stelle */}
      <Animated.View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, opacity: night }}>
        {STARS.map((s, i) => (
          <View key={i} style={{ position: 'absolute', left: `${s.x}%`, top: `${s.y}%`, width: s.s, height: s.s, borderRadius: 2, backgroundColor: '#FFFFFF', opacity: 0.85 }} />
        ))}
      </Animated.View>
      {/* sole */}
      <Animated.View
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: 34,
          height: 34,
          borderRadius: 17,
          backgroundColor: '#FFD54F',
          shadowColor: '#FFD54F',
          shadowOpacity: 0.9,
          shadowRadius: 16,
          elevation: 6,
          transform: [{ translateX: sun.x }, { translateY: sun.y }],
        }}
      />
      {/* luna */}
      <Animated.View style={{ position: 'absolute', left: 0, top: 0, width: 26, height: 26, transform: [{ translateX: moon.x }, { translateY: moon.y }] }}>
        <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: '#F4F1DE' }} />
        <View style={{ position: 'absolute', left: 8, top: -3, width: 24, height: 24, borderRadius: 12, backgroundColor: '#1B2747' }} />
      </Animated.View>
      {/* città */}
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 44, height: 92, flexDirection: 'row', alignItems: 'flex-end' }}>
        {BUILDINGS.map((h, i) => (
          <View key={i} style={{ flex: 1, height: h, marginHorizontal: 1, backgroundColor: '#0F1830', opacity: 0.55, borderTopLeftRadius: 2, borderTopRightRadius: 2 }}>
            <Animated.View style={{ flexDirection: 'row', flexWrap: 'wrap', padding: 3, gap: 3, opacity: night }}>
              {Array.from({ length: Math.floor(h / 14) * 2 }, (_, k) => (
                <View key={k} style={{ width: 3, height: 4, backgroundColor: (k + i) % 3 === 0 ? '#FFE08A' : 'transparent' }} />
              ))}
            </Animated.View>
          </View>
        ))}
      </View>
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
    <View style={{ position: 'absolute', right: 14, bottom: 8, alignItems: 'center' }}>
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
          shadowColor: '#000',
          shadowOpacity: 0.5,
          shadowRadius: 6,
          shadowOffset: { width: 0, height: 3 },
          elevation: 8,
        }}
      >
        <Text style={{ color: '#FFFFFF', fontWeight: '900', fontSize: 32, lineHeight: 36, includeFontPadding: false }}>P</Text>
      </View>
      <View style={{ width: 5, height: 30, backgroundColor: '#B0BEC5', borderRadius: 2 }} />
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
    <View style={{ height: 88, marginTop: space.md, marginHorizontal: -space.lg, marginBottom: -space.lg }}>
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 44, backgroundColor: '#2B3242', overflow: 'hidden', justifyContent: 'center' }}>
        <View style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 3, backgroundColor: '#5B6578' }} />
        {/* strisce: scorrono verso sinistra, quindi l'auto va verso destra */}
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
          bottom: 14,
          fontSize: 34,
          transform: [{ scaleX: -1 }, { translateY: bob.interpolate({ inputRange: [0, 1], outputRange: [0, -1.5] }) }],
        }}
      >
        🚗
      </Animated.Text>
      <ParkingSign />
    </View>
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
  const shadow = { textShadowColor: 'rgba(0,0,0,0.45)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4 };
  return (
    <View
      onLayout={(e) => setW(e.nativeEvent.layout.width)}
      style={{ marginTop: space.md, borderRadius: 24, padding: space.lg, overflow: 'hidden', backgroundColor: '#1B2747' }}
    >
      <Sky cycle={cycle} width={w} />
      {/* velo scuro dietro le scritte: leggibili anche quando passano sole e luna */}
      <View style={{ alignItems: 'center', backgroundColor: 'rgba(8,14,32,0.42)', borderRadius: 18, paddingVertical: space.md, paddingHorizontal: space.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', justifyContent: 'center' }}>
          <Text style={{ color: '#FFFFFF', fontSize: 15, fontWeight: '700', ...shadow }}>Il {date} </Text>
          <Text style={{ color: '#FFFFFF', fontSize: 19, fontWeight: '800', ...shadow }}>
            Parking<Text style={{ color: '#FF4B47' }}>CT</Text>
          </Text>
          <Text style={{ color: '#FFFFFF', fontSize: 15, fontWeight: '700', ...shadow }}> si sveglia</Text>
        </View>
        <Text style={{ color: '#FFFFFF', fontSize: 30, fontWeight: '800', marginTop: 10, lineHeight: 34, textAlign: 'center', ...shadow }}>
          Basta girare a vuoto.
        </Text>
        <Text style={{ color: '#FFFFFF', fontSize: 15, marginTop: 6, lineHeight: 21, textAlign: 'center', ...shadow }}>
          Ti avviserà dei posti che stanno per liberarsi vicino a te, qualche minuto prima che l'auto se ne vada.
        </Text>
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: space.lg, transform: [{ perspective: 700 }, { rotateX: '16deg' }] }}>
        <FlipGroup value={d} label="GIORNI" />
        <FlipGroup value={h} label="ORE" />
        <FlipGroup value={m} label="MINUTI" />
        <FlipGroup value={sec} label="SECONDI" />
      </View>
      <Road />
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
}: {
  title: string;
  price: number;
  perks: string[];
  highlight?: boolean;
  onPress: () => void;
}) {
  const c = usePalette();
  return (
    <Pressable onPress={onPress}>
      <Card style={{ marginTop: space.md, borderColor: highlight ? RED : c.border, borderWidth: highlight ? 2 : 1 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <Text style={{ color: c.text, fontSize: 19, fontWeight: '800' }}>{title}</Text>
          <Text style={{ color: RED, fontSize: 19, fontWeight: '800' }}>da {price} €</Text>
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
  const support = () => {
    if (cfg?.supportUrl) void Linking.openURL(cfg.supportUrl);
    else Alert.alert('Quasi pronto', "La raccolta dei sostenitori apre a breve: ti avviseremo nell'app.");
  };
  const gold = cfg?.giftsGold ?? 2;
  const plat = cfg?.giftsPlat ?? 5;
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

      {founder ? (
        <>
          <Card accent={RED} style={{ marginTop: space.lg }}>
            <Label bold color={RED}>
              Sei {TIER_LABEL[founder.tier]}. Grazie! 🎉
            </Label>
            {founder.tier !== 'amici' ? <Label dim style={{ marginTop: 4 }}>Codice: {founder.code}</Label> : null}
          </Card>
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
          {founder.tier === 'base' || founder.tier === 'regalo' || founder.tier === 'amici' ? (
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

      {!founder || founder.tier === 'base' || founder.tier === 'regalo' || founder.tier === 'amici' ? (
        <>
          <TierCard
            title="Fondatore"
            price={cfg?.priceBase ?? 3}
            perks={['🎁 ParkingCT gratis per sempre', '⭐ Il titolo di fondatore nell\'app', '🧱 Il tuo nome nel muro dei fondatori']}
            onPress={support}
          />
          <TierCard
            title="Fondatore Oro"
            price={cfg?.priceGold ?? 10}
            highlight
            perks={[
              '🎁 ParkingCT gratis per sempre',
              `🎟️ ${gold} codici regalo: gratis per sempre anche per i tuoi amici`,
              '🚗 L\'adesivo ParkingCT per l\'auto',
              '🧱 Nome nel muro dei fondatori, in evidenza',
            ]}
            onPress={support}
          />
          <TierCard
            title="Fondatore Platino"
            price={cfg?.pricePlat ?? 25}
            perks={[
              '🎁 ParkingCT gratis per sempre',
              `🎟️ ${plat} codici regalo per famiglia e amici`,
              '🚗 L\'adesivo ParkingCT per l\'auto',
              '🏆 Nome in cima al muro dei fondatori',
            ]}
            onPress={support}
          />
          <Label dim size={13} style={{ marginTop: space.md, textAlign: 'center' }}>
            Dopo il contributo ricevi il tuo codice personale. Al lancio ParkingCT te lo chiede: lo inserisci una volta e resta attiva per sempre.
          </Label>
          {!founder ? <Button title="Sostieni ParkingCT" style={{ marginTop: space.lg, backgroundColor: RED }} onPress={support} /> : null}
        </>
      ) : null}

      <Card style={{ marginTop: space.lg }}>
        <Label bold>{founder ? 'Hai un altro codice?' : 'Hai già il codice?'}</Label>
        <Label dim size={14} style={{ marginTop: 4 }}>
          Il codice è come ABCD-EFGH-JKLM: arriva dopo il contributo o in regalo da un amico.
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

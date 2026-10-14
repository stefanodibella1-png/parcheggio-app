// ParkingCT — MODALITÀ PROVA (si attiva dal control center, solo su questo telefono).
// Fa funzionare l'app come dopo il lancio del 1° dicembre e separa i due ruoli:
//   🚗 LIBERO IL POSTO  = il telefono che parcheggia e riparte (in tasca);
//   🔍 CERCO PARCHEGGIO = il telefono che riceve gli avvisi (es. il tablet a casa).
// Il rilevamento resta quello vero; i pulsanti "Simula" servono a provare il passaggio
// senza aspettare un parcheggio reale. Nessun dato finto entra nel motore di rilevamento.
import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { host } from '../host/EngineHost.ts';
import { publishSpot, withdrawSpot } from '../community/community.ts';
import { simulateSpot, type SimStep } from '../services/simulateSpot.ts';
import { kvGet, kvSet } from '../storage/db.ts';
import { Button, Card, Label } from '../ui/components/basics.tsx';
import { navigateTo, useHost, useNow } from '../ui/components/live.tsx';
import { space, usePalette } from '../ui/theme.ts';

export type TestRole = 'libera' | 'cerca';

const GREEN = '#16A34A';
const BLUE = '#2563EB';

export async function getTestMode(): Promise<{ on: boolean; role: TestRole | null }> {
  const on = (await kvGet('pc:testMode').catch(() => null)) === '1';
  const r = await kvGet('pc:testRole').catch(() => null);
  return { on, role: r === 'libera' || r === 'cerca' ? r : null };
}

/** Applica al motore la modalità prova: community accesa; chi cerca ascolta sempre. */
export async function applyTestMode(launched: boolean): Promise<boolean> {
  const t = await getTestMode();
  if (t.on) host.setCommunityAllowed(true, t.role === 'cerca');
  else host.setCommunityAllowed(launched, false);
  return t.on;
}

export async function setTestMode(on: boolean): Promise<void> {
  await kvSet('pc:testMode', on ? '1' : '').catch(() => {});
  if (!on) await kvSet('pc:testRole', '').catch(() => {});
}

export function TestBadge({ role, onPress }: { role: TestRole | null; onPress: () => void }) {
  const color = role === 'libera' ? GREEN : role === 'cerca' ? BLUE : '#7C3AED';
  return (
    <Pressable onPress={onPress} style={{ marginTop: space.md, backgroundColor: color, borderRadius: 16, padding: space.md, flexDirection: 'row', alignItems: 'center' }}>
      <Text style={{ fontSize: 26, marginRight: space.md }}>🧪</Text>
      <View style={{ flex: 1 }}>
        <Text style={{ color: '#fff', fontWeight: '800', fontSize: 17 }}>MODALITÀ PROVA · come dopo il 1° dicembre</Text>
        <Text style={{ color: '#fff', fontSize: 14, marginTop: 2 }}>
          {role === 'libera' ? 'Questo telefono: 🚗 LIBERA IL POSTO' : role === 'cerca' ? 'Questo telefono: 🔍 CERCA PARCHEGGIO' : 'Tocca per scegliere il ruolo di questo telefono'}
        </Text>
      </View>
      <Text style={{ color: '#fff', fontSize: 22 }}>›</Text>
    </Pressable>
  );
}

export function TestScreen({ onBack, onRoleChanged }: { onBack: () => void; onRoleChanged: () => void }) {
  const c = usePalette();
  const [role, setRole] = useState<TestRole | null>(null);
  useEffect(() => {
    void getTestMode().then((t) => setRole(t.role));
  }, []);
  const choose = async (r: TestRole) => {
    await kvSet('pc:testRole', r).catch(() => {});
    setRole(r);
    host.setCommunityAllowed(true, r === 'cerca');
    onRoleChanged();
  };
  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: space.xl }}>
      <Pressable onPress={onBack} hitSlop={12}>
        <Label color="#7C3AED">‹ Indietro</Label>
      </Pressable>
      <Text style={{ color: c.text, fontSize: 26, fontWeight: '800', marginTop: space.md }}>🧪 Modalità prova</Text>
      <Label dim style={{ marginTop: 4 }}>
        L'app funziona come dopo il lancio. Usa due telefoni: uno <Label bold>libera</Label> il posto (lo tieni in tasca), l'altro lo <Label bold>cerca</Label> (es. il tablet a casa).
      </Label>

      <Text style={{ color: c.text, fontSize: 16, fontWeight: '700', marginTop: space.lg }}>Questo telefono è…</Text>
      <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.sm }}>
        <RoleCard title="🚗 LIBERA IL POSTO" sub="in tasca, parcheggia e riparte" color={GREEN} on={role === 'libera'} onPress={() => void choose('libera')} />
        <RoleCard title="🔍 CERCA PARCHEGGIO" sub="riceve voce e notifiche" color={BLUE} on={role === 'cerca'} onPress={() => void choose('cerca')} />
      </View>

      {role === 'libera' ? <LiberaPanel /> : role === 'cerca' ? <CercaPanel /> : null}
    </ScrollView>
  );
}

function RoleCard({ title, sub, color, on, onPress }: { title: string; sub: string; color: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={{ flex: 1, borderRadius: 16, padding: space.md, borderWidth: 3, borderColor: color, backgroundColor: on ? color : 'transparent', minHeight: 96, justifyContent: 'center' }}
    >
      <Text style={{ color: on ? '#fff' : color, fontWeight: '800', fontSize: 16, textAlign: 'center' }}>{title}</Text>
      <Text style={{ color: on ? '#fff' : color, fontSize: 13, textAlign: 'center', marginTop: 4 }}>{sub}</Text>
      {on ? <Text style={{ color: '#fff', fontSize: 13, textAlign: 'center', marginTop: 4, fontWeight: '700' }}>✓ SCELTO</Text> : null}
    </Pressable>
  );
}

// ---------------------------------------------------------------------------------------
// 🚗 chi libera

function LiberaPanel() {
  const c = usePalette();
  const s = useHost();
  const now = useNow();
  const [msg, setMsg] = useState<string | null>(null);
  const sess = s.session;
  const shared = s.community.shared;
  const a = sess?.spot.address;
  const where = a?.street ? `${a.street}${a.streetNumber ? ` ${a.streetNumber}` : ''}` : (a?.formatted ?? null);
  const point = () => {
    if (sess) return sess.spot.pointFinal;
    const t = s.track;
    return t.length ? t[t.length - 1] : null;
  };
  const send = async (kind: 'SOON' | 'FREED') => {
    const p = point();
    if (!p) {
      setMsg('Posizione non disponibile: attendi il GPS.');
      return;
    }
    const t = Date.now();
    const freeAt = kind === 'SOON' ? t + 120_000 : t;
    const ok = await publishSpot({
      id: `prova-${sess?.parkingId ?? 'qui'}`,
      kind,
      latitude: p.latitude,
      longitude: p.longitude,
      address: `${where ?? 'Posto di prova'} (prova)`,
      quality: 'PROVA',
      confidence: 0,
      freeAt,
      createdAt: t,
      expiresAt: Math.max(freeAt, t) + 180_000,
      deviceId: 'prova',
    });
    setMsg(ok ? (kind === 'SOON' ? '📣 Inviato: «si libera tra 2 minuti». Il telefono che cerca entro 800 m lo riceve entro 15 secondi.' : '✅ Inviato: «posto libero».') : 'Invio non riuscito: controlla la connessione.');
  };
  return (
    <View style={{ marginTop: space.lg }}>
      <Card accent={GREEN}>
        <Label size={13} bold color={GREEN}>
          🚗 TU LIBERI IL POSTO
        </Label>
        <Text style={{ color: c.text, fontSize: 18, fontWeight: '700', marginTop: 6 }}>{sess ? `La tua auto: ${where ?? 'posizione salvata'}` : 'Nessun parcheggio rilevato ancora'}</Text>
        <Label size={15} style={{ marginTop: 8 }}>
          {shared
            ? shared.kind === 'SOON'
              ? `📣 Stai avvisando: «si libera tra ~${Math.max(0, Math.round((shared.freeAt - now) / 60000))} min»`
              : '✅ Stai avvisando: «posto libero»'
            : 'Per ora non stai avvisando nessuno.'}
        </Label>
      </Card>
      <Card style={{ marginTop: space.md }}>
        <Label bold>Prova vera (automatica)</Label>
        <Label size={14} style={{ marginTop: 4, lineHeight: 21 }}>
          1. Parcheggia in strada e scendi: qui compare «La tua auto».{'\n'}2. Allontanati a piedi almeno 10 minuti.{'\n'}3. Torna all'auto a piedi: parte da solo «si libera tra …».{'\n'}4. Riparti: parte da solo «posto libero».
        </Label>
      </Card>
      <Card style={{ marginTop: space.md }}>
        <Label bold>Prova veloce (con i pulsanti)</Label>
        <Label dim size={13} style={{ marginTop: 2 }}>
          Invia subito l'avviso dal punto della tua auto (o da dove sei), senza aspettare.
        </Label>
        <Button title="📣 Sto tornando all'auto" style={{ marginTop: space.sm, backgroundColor: GREEN }} onPress={() => void send('SOON')} />
        <Button title="✅ Sono partito: posto libero" style={{ marginTop: space.sm, backgroundColor: GREEN }} onPress={() => void send('FREED')} />
        <Button
          small
          variant="ghost"
          title="Annulla l'avviso di prova"
          style={{ marginTop: space.sm }}
          onPress={async () => {
            await withdrawSpot(`prova-${sess?.parkingId ?? 'qui'}`);
            setMsg('Avviso di prova annullato.');
          }}
        />
        {msg ? <Label size={14} style={{ marginTop: space.sm }}>{msg}</Label> : null}
      </Card>
    </View>
  );
}

// ---------------------------------------------------------------------------------------
// 🔍 chi cerca

function CercaPanel() {
  const c = usePalette();
  const s = useHost();
  const now = useNow();
  const [sim, setSim] = useState<{ step: SimStep; info?: string } | null>(null);
  const cm = s.community;
  const ago = cm.lastSyncT ? Math.max(0, Math.round((now - cm.lastSyncT) / 1000)) : null;
  const busy = sim !== null && sim.step !== 'fine' && sim.step !== 'errore';
  return (
    <View style={{ marginTop: space.lg }}>
      <Card accent={BLUE}>
        <Label size={13} bold color={BLUE}>
          🔍 TU CERCHI PARCHEGGIO
        </Label>
        <Text style={{ color: c.text, fontSize: 18, fontWeight: '700', marginTop: 6 }}>
          {cm.listening ? 'In ascolto: posti entro 800 m' : 'Avvio dell\'ascolto…'}
        </Text>
        <Label dim size={13} style={{ marginTop: 2 }}>
          {ago === null ? 'Primo controllo in corso…' : `Ultimo controllo ${ago} s fa · ogni 15 secondi`} · voce e notifica attive
        </Label>
        {cm.nearby.length === 0 ? (
          <Label size={15} style={{ marginTop: space.md }}>
            Nessun posto vicino in questo momento.
          </Label>
        ) : (
          cm.nearby.map((p) => (
            <View key={p.id} style={{ marginTop: space.md, padding: space.md, borderRadius: 12, backgroundColor: p.kind === 'FREED' ? GREEN + '22' : BLUE + '22' }}>
              <Text style={{ color: c.text, fontSize: 17, fontWeight: '800' }}>
                {p.kind === 'FREED' ? '✅ LIBERO ORA' : `⏱️ SI LIBERA TRA ~${Math.max(0, Math.round((p.freeAt - now) / 60000))} MIN`}
              </Text>
              <Label size={15} style={{ marginTop: 2 }}>
                🅿️ {p.address ?? 'Posto'} · {p.distanceM} m
              </Label>
              <Button title="🧭 Portami lì" style={{ marginTop: space.sm, backgroundColor: p.kind === 'FREED' ? GREEN : BLUE }} onPress={() => navigateTo(p.latitude, p.longitude)} />
            </View>
          ))
        )}
        {cm.error ? <Label size={13} color={c.warn} style={{ marginTop: 6 }}>{cm.error}</Label> : null}
      </Card>
      <Card style={{ marginTop: space.md }}>
        <Label bold>Come provare</Label>
        <Label size={14} style={{ marginTop: 4, lineHeight: 21 }}>
          Lascia questo telefono acceso (anche a schermo spento). Quando l'altro telefono avvisa entro 800 m, qui senti la voce e arriva la notifica.
        </Label>
        <Button
          small
          title={busy ? (sim?.step === 'soon' ? 'Si libera tra 2 min… (attendi 20 s)' : 'Preparo…') : '🔊 Prova da solo: simula un posto qui vicino'}
          disabled={busy}
          style={{ marginTop: space.sm, backgroundColor: BLUE }}
          onPress={() => {
            const t = s.track;
            void simulateSpot((step, info) => setSim({ step, info }), t.length ? t[t.length - 1] : null);
          }}
        />
        {sim?.step === 'errore' ? <Label color={c.danger} size={13} style={{ marginTop: 4 }}>{sim.info}</Label> : null}
      </Card>
    </View>
  );
}

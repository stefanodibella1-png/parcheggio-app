// ParkingCT — control center segreto. Si apre toccando 7 volte il logo nella schermata principale.
// Solo l'account del proprietario può leggere i numeri e scrivere codici e pubblicità
// (lo garantiscono le regole del server, non questa schermata).
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, Share, Switch, Text, TextInput, View } from 'react-native';
import { Button, Card, Label } from '../ui/components/basics.tsx';
import { space, usePalette } from '../ui/theme.ts';
import {
  deleteAd,
  firstAccess,
  generateCode,
  listAds,
  listCodes,
  loadStats,
  login,
  logout,
  pretty,
  resetPassword,
  resume,
  saveAd,
  type AdStats,
  type AdminCode,
  type Stats,
} from './admin.ts';
import { APK_URL, TIER_LABEL, type Ad, type PublicConfig, type Tier } from './server.ts';

const RED = '#E53935';
type Tab = 'numeri' | 'codici' | 'pubblicita';

export function ControlCenter({ cfg, onBack }: { cfg: PublicConfig | null; onBack: () => void }) {
  const c = usePalette();
  const [state, setState] = useState<'checking' | 'login' | 'in'>('checking');
  const [tab, setTab] = useState<Tab>('numeri');

  useEffect(() => {
    void resume().then((ok) => setState(ok ? 'in' : 'login'));
  }, []);

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: space.xl }} keyboardShouldPersistTaps="handled">
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Pressable onPress={onBack} hitSlop={12}>
          <Label color={RED}>‹ Esci</Label>
        </Pressable>
        {state === 'in' ? (
          <Pressable
            onPress={async () => {
              await logout();
              setState('login');
            }}
            hitSlop={12}
          >
            <Label dim size={14}>
              Disconnetti
            </Label>
          </Pressable>
        ) : null}
      </View>
      <Text style={{ color: c.text, fontSize: 26, fontWeight: '800', marginTop: space.md }}>Control center</Text>
      {state === 'checking' ? <Label dim>Controllo l'accesso…</Label> : null}
      {state === 'login' ? <Login onIn={() => setState('in')} /> : null}
      {state === 'in' ? (
        <>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: space.md }}>
            {(
              [
                ['numeri', 'Numeri'],
                ['codici', 'Codici'],
                ['pubblicita', 'Pubblicità'],
              ] as [Tab, string][]
            ).map(([k, t]) => (
              <Pressable
                key={k}
                onPress={() => setTab(k)}
                style={{
                  flex: 1,
                  minHeight: 44,
                  borderRadius: 12,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: tab === k ? RED : c.cardAlt,
                }}
              >
                <Text style={{ color: tab === k ? '#FFFFFF' : c.text, fontWeight: '700' }}>{t}</Text>
              </Pressable>
            ))}
          </View>
          {tab === 'numeri' ? <Numbers /> : tab === 'codici' ? <Codes cfg={cfg} /> : <Ads />}
        </>
      ) : null}
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------------------

function Field({
  label,
  value,
  onChange,
  secure,
  placeholder,
  keyboard,
  multiline,
}: {
  label: string;
  value: string;
  onChange: (s: string) => void;
  secure?: boolean;
  placeholder?: string;
  keyboard?: 'default' | 'email-address' | 'numeric' | 'url';
  multiline?: boolean;
}) {
  const c = usePalette();
  return (
    <View style={{ marginTop: space.md }}>
      <Label size={14} bold>
        {label}
      </Label>
      <TextInput
        value={value}
        onChangeText={onChange}
        secureTextEntry={secure}
        placeholder={placeholder}
        placeholderTextColor={c.textDim}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType={keyboard ?? 'default'}
        multiline={multiline}
        style={{
          marginTop: 6,
          borderWidth: 1,
          borderColor: c.border,
          borderRadius: 12,
          padding: space.md,
          color: c.text,
          fontSize: 16,
          minHeight: multiline ? 80 : undefined,
          textAlignVertical: multiline ? 'top' : 'center',
        }}
      />
    </View>
  );
}

function Login({ onIn }: { onIn: () => void }) {
  const [email, setEmail] = useState('');
  const [pwd, setPwd] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <Card style={{ marginTop: space.md }}>
      <Label dim size={14}>
        Accesso riservato al proprietario.
      </Label>
      <Field label="Email" value={email} onChange={setEmail} keyboard="email-address" />
      <Field label="Password" value={pwd} onChange={setPwd} secure />
      {msg ? (
        <Label style={{ marginTop: space.sm }} color={RED}>
          {msg}
        </Label>
      ) : null}
      <Button
        title="Accedi"
        busy={busy}
        style={{ marginTop: space.md, backgroundColor: RED }}
        onPress={async () => {
          setBusy(true);
          const r = await login(email, pwd);
          setBusy(false);
          if (r.ok) onIn();
          else setMsg(r.msg);
        }}
      />
      <Button
        small
        variant="ghost"
        title="Primo accesso: crea la password"
        style={{ marginTop: space.sm }}
        onPress={async () => {
          if (pwd.length < 8) {
            setMsg('Scegli una password di almeno 8 caratteri, poi tocca di nuovo.');
            return;
          }
          setBusy(true);
          const r = await firstAccess(email, pwd);
          setBusy(false);
          if (r.ok) onIn();
          else setMsg(r.msg);
        }}
      />
      <Button small variant="ghost" title="Password dimenticata" style={{ marginTop: space.sm }} onPress={async () => setMsg(await resetPassword(email))} />
    </Card>
  );
}

// ---------------------------------------------------------------------------------------
// numeri

function Big({ n, label }: { n: number | null | string; label: string }) {
  const c = usePalette();
  return (
    <View style={{ width: '48%', backgroundColor: c.card, borderRadius: 14, padding: space.md, marginTop: space.sm }}>
      <Text style={{ color: c.text, fontSize: 28, fontWeight: '800' }}>{n === null ? '–' : n}</Text>
      <Label dim size={13}>
        {label}
      </Label>
    </View>
  );
}

function Numbers() {
  const [s, setS] = useState<Stats | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setBusy(true);
    setS(await loadStats());
    setBusy(false);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <View style={{ marginTop: space.md }}>
      <Button small variant="ghost" title={busy ? 'Aggiorno…' : 'Aggiorna'} busy={busy} onPress={load} />
      {s && !s.ok ? (
        <Label color={RED} style={{ marginTop: space.sm }}>
          Il server non ha risposto con i dati: controlla la connessione o riaccedi.
        </Label>
      ) : null}
      {s ? (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' }}>
            <Big n={s.devices} label="installazioni" />
            <Big n={s.active24h} label="attive nelle ultime 24 ore" />
            <Big n={s.active7d} label="attive negli ultimi 7 giorni" />
            <Big n={`${s.newToday} / ${s.new7d}`} label="nuove oggi / 7 giorni" />
            <Big n={s.founders} label="fondatori attivati" />
            <Big n={s.codesGenerated} label="codici generati qui" />
            <Big n={s.parkings} label="parcheggi raccolti" />
            <Big n={s.parkings7d} label="parcheggi ultimi 7 giorni" />
            <Big n={s.invitedTotal} label="amici invitati" />
            <Big n={s.zones.length} label="zone (celle di ~5 km)" />
          </View>
          <Card style={{ marginTop: space.md }}>
            <Label bold>Fondatori per livello</Label>
            {Object.keys(s.byTier).length === 0 ? <Label dim>Nessuno ancora.</Label> : null}
            {Object.entries(s.byTier).map(([k, v]) => (
              <Label key={k} style={{ marginTop: 4 }}>
                {TIER_LABEL[k as Tier] ?? k}: {v}
              </Label>
            ))}
          </Card>
          <Card style={{ marginTop: space.md }}>
            <Label bold>Zone</Label>
            {s.zones.slice(0, 15).map((z) => (
              <Pressable key={z.zone} onPress={() => Linking.openURL(`https://maps.google.com/?q=${z.lat},${z.lon}`)}>
                <Label style={{ marginTop: 6 }}>
                  {z.zone} · {z.n} telefoni <Label color={RED}>mappa ›</Label>
                </Label>
              </Pressable>
            ))}
          </Card>
          <Card style={{ marginTop: space.md }}>
            <Label bold>Chi invita di più</Label>
            {s.invites.length === 0 ? <Label dim>Nessun invito ancora.</Label> : null}
            {s.invites.map((i) => (
              <Label key={i.code} style={{ marginTop: 4 }}>
                {i.code}: {i.n} amici
              </Label>
            ))}
          </Card>
          <Card style={{ marginTop: space.md }}>
            <Label bold>Versioni dell'app</Label>
            {Object.entries(s.versions).map(([k, v]) => (
              <Label key={k} style={{ marginTop: 4 }}>
                {k}: {v}
              </Label>
            ))}
          </Card>
        </>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------------------
// codici

function shareCodeMessage(cfg: PublicConfig | null, a: AdminCode): string {
  const lines = [
    `Grazie per aver sostenuto ParkingCT! ⭐`,
    ``,
    `Il tuo codice ${TIER_LABEL[a.tier]}: ${pretty(a.code)}`,
    `Al lancio ParkingCT te lo chiede: inseriscilo e per te resta gratis per sempre.`,
  ];
  if (a.gifts.length) {
    lines.push('', `I tuoi ${a.gifts.length} codici regalo per gli amici (gratis per sempre anche per loro):`);
    for (const g of a.gifts) lines.push(`• ${pretty(g)}`);
    lines.push('Li trovi anche nell\'app, nella pagina Fondatori.');
  }
  lines.push('', `Scarica l'app: ${cfg?.landingUrl || APK_URL}`);
  return lines.join('\n');
}

function Codes({ cfg }: { cfg: PublicConfig | null }) {
  const c = usePalette();
  const [tier, setTier] = useState<Tier>('base');
  const [note, setNote] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<AdminCode | null>(null);
  const [list, setList] = useState<AdminCode[] | null>(null);
  const reload = useCallback(async () => setList(await listCodes()), []);
  useEffect(() => {
    void reload();
  }, [reload]);
  const gifts = tier === 'oro' ? cfg?.giftsGold ?? 2 : tier === 'platino' ? cfg?.giftsPlat ?? 5 : 0;
  const price = tier === 'oro' ? cfg?.priceGold : tier === 'platino' ? cfg?.pricePlat : cfg?.priceBase;
  return (
    <View style={{ marginTop: space.md }}>
      <Card>
        <Label bold>Nuovo codice per un sostenitore</Label>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: space.md }}>
          {(['base', 'oro', 'platino'] as Tier[]).map((t) => (
            <Pressable
              key={t}
              onPress={() => setTier(t)}
              style={{ flex: 1, minHeight: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: tier === t ? RED : c.cardAlt }}
            >
              <Text style={{ color: tier === t ? '#FFFFFF' : c.text, fontWeight: '700', textTransform: 'capitalize' }}>{t}</Text>
            </Pressable>
          ))}
        </View>
        <Label dim size={13} style={{ marginTop: 6 }}>
          {TIER_LABEL[tier]} · da {price ?? '?'} € · {gifts} codici regalo
        </Label>
        <Field label="Nome o nota (solo per te)" value={note} onChange={setNote} placeholder="es. Mario Rossi, PayPal 12/10" />
        <Field label="Importo donato (€)" value={amount} onChange={setAmount} keyboard="numeric" />
        <Button
          title="Genera codice"
          busy={busy}
          style={{ marginTop: space.md, backgroundColor: RED }}
          onPress={async () => {
            setBusy(true);
            const r = await generateCode(tier, gifts, note.trim(), Number(amount.replace(',', '.')) || 0);
            setBusy(false);
            if (!r) {
              Alert.alert('Non riuscito', 'Il server non ha accettato il codice: controlla la connessione o riaccedi.');
              return;
            }
            setLast(r);
            setNote('');
            setAmount('');
            void reload();
          }}
        />
      </Card>
      {last ? (
        <Card accent={RED} style={{ marginTop: space.md }}>
          <Label bold>Codice pronto</Label>
          <Text selectable style={{ color: c.text, fontSize: 24, fontWeight: '800', letterSpacing: 1, marginTop: 4 }}>
            {pretty(last.code)}
          </Text>
          {last.gifts.map((g) => (
            <Label key={g} dim>
              regalo: {pretty(g)}
            </Label>
          ))}
          <Button title="Invia al sostenitore" style={{ marginTop: space.md, backgroundColor: RED }} onPress={() => Share.share({ message: shareCodeMessage(cfg, last) })} />
        </Card>
      ) : null}
      <Card style={{ marginTop: space.md }}>
        <Label bold>Codici generati</Label>
        {list === null ? <Label dim>Carico…</Label> : list.length === 0 ? <Label dim>Nessuno ancora.</Label> : null}
        {(list ?? []).map((a) => (
          <Pressable key={a.hash} onPress={() => Share.share({ message: shareCodeMessage(cfg, a) })} style={{ marginTop: space.sm }}>
            <Label>
              {pretty(a.code)} · {a.tier}
              {a.used ? ' · ✅ attivato' : ' · in attesa'}
            </Label>
            <Label dim size={13}>
              {a.note || 'senza nota'}
              {a.amount ? ` · ${a.amount} €` : ''} · {new Date(a.createdAt).toLocaleDateString('it-IT')} · tocca per reinviare
            </Label>
          </Pressable>
        ))}
      </Card>
      <Label dim size={13} style={{ marginTop: space.md }}>
        I 300 codici del file CSV restano validi come livello base.
      </Label>
    </View>
  );
}

// ---------------------------------------------------------------------------------------
// pubblicità

const EMPTY_AD: Ad = { id: '', sponsor: '', title: '', text: '', cta: 'Scopri', url: '', image: '', zone: '', active: true, until: 0, weight: 1 };

function Ads() {
  const [list, setList] = useState<(Ad & AdStats)[] | null>(null);
  const [edit, setEdit] = useState<Ad | null>(null);
  const reload = useCallback(async () => setList(await listAds()), []);
  useEffect(() => {
    void reload();
  }, [reload]);
  if (edit) return <AdEditor ad={edit} onDone={() => (setEdit(null), void reload())} />;
  return (
    <View style={{ marginTop: space.md }}>
      <Button title="+ Nuova pubblicità" style={{ backgroundColor: RED }} onPress={() => setEdit({ ...EMPTY_AD })} />
      {list === null ? <Label dim style={{ marginTop: space.md }}>Carico…</Label> : null}
      {list?.length === 0 ? <Label dim style={{ marginTop: space.md }}>Nessuna pubblicità.</Label> : null}
      {(list ?? []).map((a) => {
        const ctr = a.views ? Math.round(((a.clicks ?? 0) / a.views) * 1000) / 10 : 0;
        return (
          <Pressable key={a.id} onPress={() => setEdit(a)}>
            <Card style={{ marginTop: space.md }} accent={a.active ? RED : undefined}>
              <Label bold>
                {a.title} {a.active ? '' : '(spenta)'}
              </Label>
              <Label dim size={13}>
                {a.sponsor || 'sponsor'} · {a.zone ? `zona ${a.zone}` : 'tutte le zone'}
                {a.until ? ` · fino al ${new Date(a.until).toLocaleDateString('it-IT')}` : ''}
              </Label>
              <Label style={{ marginTop: 4 }}>
                {a.views ?? '–'} visualizzazioni · {a.clicks ?? '–'} tocchi · {ctr}%
              </Label>
            </Card>
          </Pressable>
        );
      })}
    </View>
  );
}

function AdEditor({ ad, onDone }: { ad: Ad; onDone: () => void }) {
  const [a, setA] = useState<Ad>(ad);
  const [days, setDays] = useState(ad.until ? String(Math.max(0, Math.ceil((ad.until - Date.now()) / 86_400_000))) : '');
  const [busy, setBusy] = useState(false);
  const set = (k: keyof Ad) => (v: string) => setA({ ...a, [k]: v });
  return (
    <View style={{ marginTop: space.md }}>
      <Card>
        <Label bold>{ad.id ? 'Modifica pubblicità' : 'Nuova pubblicità'}</Label>
        <Field label="Sponsor" value={a.sponsor} onChange={set('sponsor')} placeholder="es. Bar Centrale" />
        <Field label="Titolo" value={a.title} onChange={set('title')} placeholder="es. Caffè + cornetto 1,50 €" />
        <Field label="Testo" value={a.text} onChange={set('text')} multiline />
        <Field label="Pulsante" value={a.cta} onChange={set('cta')} placeholder="es. Portami lì" />
        <Field label="Link (sito, Google Maps, WhatsApp…)" value={a.url} onChange={set('url')} keyboard="url" />
        <Field label="Immagine (link a un'immagine, facoltativo)" value={a.image} onChange={set('image')} keyboard="url" />
        <Field label="Zona (codice zona dai Numeri; vuoto = tutte)" value={a.zone} onChange={set('zone')} />
        <Field label="Durata in giorni (vuoto = senza scadenza)" value={days} onChange={setDays} keyboard="numeric" />
        <Field label="Peso (più alto = mostrata più spesso)" value={String(a.weight)} onChange={(v) => setA({ ...a, weight: Number(v) || 1 })} keyboard="numeric" />
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.md }}>
          <Label bold>Attiva</Label>
          <Switch value={a.active} onValueChange={(v) => setA({ ...a, active: v })} />
        </View>
        <Button
          title="Salva"
          busy={busy}
          style={{ marginTop: space.md, backgroundColor: RED }}
          disabled={!a.title.trim()}
          onPress={async () => {
            setBusy(true);
            const d = Number(days);
            const ok = await saveAd({ ...a, zone: a.zone.trim().toLowerCase(), until: d > 0 ? Date.now() + d * 86_400_000 : 0 });
            setBusy(false);
            if (ok) onDone();
            else Alert.alert('Non salvata', 'Controlla la connessione o riaccedi.');
          }}
        />
        {ad.id ? (
          <Button
            small
            variant="danger"
            title="Elimina"
            style={{ marginTop: space.sm }}
            onPress={() =>
              Alert.alert('Eliminare la pubblicità?', a.title, [
                { text: 'No' },
                { text: 'Elimina', style: 'destructive', onPress: async () => ((await deleteAd(ad.id)) ? onDone() : Alert.alert('Non eliminata')) },
              ])
            }
          />
        ) : null}
        <Button small variant="ghost" title="Annulla" style={{ marginTop: space.sm }} onPress={onDone} />
      </Card>
    </View>
  );
}

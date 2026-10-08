// Componenti della schermata Test: stato, auto, timeline, checklist.
import React, { useEffect, useState } from 'react';
import { Alert, Linking, Platform, Pressable, Share, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import type { DetectionEvent, EngineSnapshot, ParkingSession, ParkingSpot } from '../../../engine/types.ts';
import { host, type HostState } from '../../host/EngineHost.ts';
import type { CheckItem } from '../../services/permissions.ts';
import { FAMILY_COLORS, STATE_TEXT, familyOf, space, usePalette } from '../theme.ts';
import { ago, fmtDistance, fmtDuration, fmtNum, fmtTime } from '../format.ts';
import { Button, Card, Label, Pill } from './basics.tsx';

export function useHost(): HostState {
  const [s, setS] = useState<HostState>(host.state);
  useEffect(() => host.subscribe(setS), []);
  return s;
}

export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

// ---- scheda di stato grande ------------------------------------------------------------

export function StateCard({ snap, now }: { snap: EngineSnapshot | null; now: number }) {
  const c = usePalette();
  const state = snap?.state ?? 'UNKNOWN';
  const fam = familyOf(state);
  const color = FAMILY_COLORS[fam];
  const meta = STATE_TEXT[state];
  const sinceMs = snap ? now - snap.stateSinceT : 0;

  // un solo numero grande, contestuale
  let big = '';
  let bigUnit = '';
  if (fam === 'vehicle' && snap?.speedKmh !== null && snap?.speedKmh !== undefined) {
    big = fmtNum(snap.speedKmh);
    bigUnit = 'km/h';
  } else if (state === 'VEHICLE_STOPPED' || state === 'POSSIBLE_PARKING' || state === 'PARKED' || state === 'USER_RETURNING') {
    big = fmtDuration(sinceMs);
    bigUnit = state === 'PARKED' ? 'parcheggiato da' : 'fermo da';
  } else if ((state === 'PARKED_USER_AWAY' || state === 'RETURN_PREDICTED') && snap?.distanceFromParkingM !== null && snap?.distanceFromParkingM !== undefined) {
    big = fmtDistance(snap.distanceFromParkingM);
    bigUnit = "dall'auto";
  } else if (state === 'WALKING' && snap?.speedKmh !== null && snap?.speedKmh !== undefined) {
    big = fmtNum(snap.speedKmh, 1);
    bigUnit = 'km/h';
  }

  const conf = snap ? relevantScore(snap) : 0;
  const age = snap?.lastFixAgeS ?? null;
  const stale = age === null || age > 30;

  return (
    <Card accent={color} style={{ paddingVertical: space.xl }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Text style={{ fontSize: 40, marginRight: space.md }}>{meta.icon}</Text>
        <View style={{ flex: 1 }}>
          <Text style={{ color: c.text, fontSize: 24, fontWeight: '800' }}>{meta.label}</Text>
          <Text style={{ color: c.textDim, fontSize: 14, marginTop: 2 }}>da {fmtDuration(sinceMs)} · rilevamento automatico</Text>
        </View>
      </View>
      {big ? (
        <View style={{ flexDirection: 'row', alignItems: 'baseline', marginTop: space.lg }}>
          {bigUnit && bigUnit.endsWith('da') ? <Text style={{ color: c.textDim, fontSize: 16, marginRight: 8 }}>{bigUnit}</Text> : null}
          <Text style={{ color: c.text, fontSize: 52, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{big}</Text>
          {bigUnit && !bigUnit.endsWith('da') ? <Text style={{ color: c.textDim, fontSize: 18, marginLeft: 8 }}>{bigUnit}</Text> : null}
        </View>
      ) : null}
      {snap?.searchingSinceT ? (
        <Label dim style={{ marginTop: 4 }}>🔎 Probabile ricerca di parcheggio da {fmtDuration(now - snap.searchingSinceT)} (sperimentale)</Label>
      ) : null}
      {snap?.returnInfo && state === 'RETURN_PREDICTED' && snap.returnInfo.releaseEtaS !== null ? (
        <View style={{ marginTop: space.sm, padding: space.sm, borderRadius: 8, backgroundColor: c.cardAlt }}>
          <Label bold>Il tuo posto si libererà tra ~{Math.max(1, Math.round(snap.returnInfo.releaseEtaS / 60))} min</Label>
          <Label dim size={13}>
            sei a {snap.returnInfo.distanceM} m dall'auto
            {snap.returnInfo.etaS !== null ? ` · arrivo stimato tra ${fmtDuration(snap.returnInfo.etaS * 1000)}` : ''}
          </Label>
        </View>
      ) : null}
      {state === 'USER_RETURNING' && snap?.returnInfo ? (
        <View style={{ marginTop: space.sm, padding: space.sm, borderRadius: 8, backgroundColor: c.cardAlt }}>
          <Label bold>Il tuo posto si sta per liberare</Label>
        </View>
      ) : null}
      <View style={{ marginTop: space.lg }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Label dim size={13}>confidence</Label>
          <Label size={13} bold>{Math.round(conf)}</Label>
        </View>
        <View style={{ height: 10, backgroundColor: c.cardAlt, borderRadius: 5, marginTop: 4, overflow: 'hidden' }}>
          <View style={{ width: `${Math.max(0, Math.min(100, conf))}%`, height: 10, backgroundColor: color }} />
        </View>
      </View>
      <Text style={{ color: stale ? c.warn : c.textDim, fontSize: 13, marginTop: space.md }}>
        {snap?.gpsAccuracyM !== null && snap?.gpsAccuracyM !== undefined ? `GPS ±${Math.round(snap.gpsAccuracyM)} m` : 'GPS in attesa'}
        {' · '}
        {age === null ? 'nessun dato' : `ultimo dato ${Math.round(age)} s fa`}
        {stale && age !== null ? ' — il sistema potrebbe aver sospeso l\'app' : ''}
      </Text>
    </Card>
  );
}

function relevantScore(s: EngineSnapshot): number {
  switch (familyOf(s.state)) {
    case 'vehicle':
      return s.state === 'VEHICLE_DEPARTED' ? Math.max(s.scores.release, s.scores.vehicle) : s.scores.vehicle;
    case 'walking':
      return s.state === 'RETURN_PREDICTED' ? s.scores.return : s.scores.walking;
    case 'parking':
      return s.scores.parking;
    case 'released':
      return s.scores.release;
    default:
      return Math.max(s.scores.vehicle, s.scores.walking);
  }
}

// ---- la tua auto ---------------------------------------------------------------------------

export function mapsUrl(spot: ParkingSpot): string {
  const { latitude, longitude } = spot.pointFinal;
  return Platform.OS === 'ios'
    ? `http://maps.apple.com/?ll=${latitude},${longitude}&q=Auto`
    : `geo:${latitude},${longitude}?q=${latitude},${longitude}(Auto)`;
}

export function addressLine(spot: ParkingSpot): string {
  if (spot.address?.formatted) return `vicino a ${spot.address.formatted}`;
  switch (spot.geocodeStatus) {
    case 'PENDING':
      return 'Indirizzo in arrivo…';
    case 'NO_NETWORK':
      return 'Indirizzo non disponibile: nessuna rete (verrà riprovato)';
    case 'NOT_AVAILABLE':
      return 'Geocoder non disponibile su questo telefono';
    default:
      return 'Indirizzo non trovato';
  }
}

const QUALITY_TEXT = { A: 'ottima', B: 'buona', C: 'scarsa' } as const;

export function CarCard({ session, distanceM, now }: { session: ParkingSession; distanceM: number | null; now: number }) {
  const c = usePalette();
  const spot = session.spot;
  const p = spot.pointFinal;
  const coords = `${p.latitude.toFixed(6)}, ${p.longitude.toFixed(6)}`;
  const qColor = spot.pointQuality === 'A' ? c.ok : spot.pointQuality === 'B' ? c.warn : c.danger;
  return (
    <Card accent={FAMILY_COLORS.parking}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Label size={13} dim bold>LA TUA AUTO</Label>
        <Pill text={`Punto ${spot.pointQuality} · ±${Math.round(p.accuracyM)} m · ${QUALITY_TEXT[spot.pointQuality]}`} color={qColor} />
      </View>
      <Text style={{ color: c.text, fontSize: 20, fontWeight: '700', marginTop: space.sm }}>{addressLine(spot)}</Text>
      <Label dim size={13} style={{ marginTop: 4 }}>
        {session.inferred ? 'Parcheggio dedotto' : `Parcheggiata alle ${fmtTime(session.parkedT ?? session.startT)}`} · da {fmtDuration(now - session.startT)}
        {distanceM !== null ? ` · sei a ${fmtDistance(distanceM)}` : ''}
      </Label>
      {spot.recurringSpot ? <Label dim size={13}>Posto abituale (casa/lavoro)</Label> : null}
      <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.md, flexWrap: 'wrap' }}>
        <Button small variant="ghost" title="Copia indirizzo" disabled={!spot.address?.formatted} onPress={() => Clipboard.setStringAsync(spot.address?.formatted ?? '')} />
        <Button small variant="ghost" title="Copia coordinate" onPress={() => Clipboard.setStringAsync(coords)} />
        <Button small variant="ghost" title="Apri in Mappe" onPress={() => Linking.openURL(mapsUrl(spot)).catch(() => Alert.alert('Impossibile aprire Mappe'))} />
        <Button
          small
          variant="ghost"
          title="Condividi"
          onPress={() => Share.share({ message: `${spot.address?.formatted ?? 'Auto'} — https://maps.google.com/?q=${p.latitude},${p.longitude}` })}
        />
      </View>
    </Card>
  );
}

// ---- timeline compatta --------------------------------------------------------------------------

export function Timeline({ events, onOpen }: { events: DetectionEvent[]; onOpen: () => void }) {
  const c = usePalette();
  const last = events.slice(-5).reverse();
  if (last.length === 0) return null;
  return (
    <Pressable onPress={onOpen}>
      <Card>
        {last.map((e) => (
          <View key={e.id} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 6 }}>
            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: FAMILY_COLORS[familyOf(e.type)], marginRight: space.md }} />
            <Text style={{ color: c.textDim, fontSize: 13, width: 70, fontVariant: ['tabular-nums'] }}>{fmtTime(e.t)}</Text>
            <Text style={{ color: c.text, fontSize: 15, flex: 1 }} numberOfLines={1}>
              {STATE_TEXT[e.type].label}
            </Text>
          </View>
        ))}
        <Label dim size={13} style={{ marginTop: 4 }}>Tocca per il log completo ›</Label>
      </Card>
    </Pressable>
  );
}

// ---- checklist di prontezza -------------------------------------------------------------------------

export function Checklist({ items, onChanged }: { items: CheckItem[]; onChanged: () => void }) {
  const c = usePalette();
  const color = (l: CheckItem['level']) => (l === 'ok' ? c.ok : l === 'warn' ? c.warn : c.danger);
  const icon = (l: CheckItem['level']) => (l === 'ok' ? '✓' : l === 'warn' ? '!' : '✕');
  return (
    <Card>
      {items.map((i, idx) => (
        <View key={i.key} style={{ paddingVertical: space.sm, borderTopWidth: idx ? 1 : 0, borderTopColor: c.border }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: color(i.level) + '26', alignItems: 'center', justifyContent: 'center', marginRight: space.md }}>
              <Text style={{ color: color(i.level), fontWeight: '800' }}>{icon(i.level)}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Label bold>{i.label}</Label>
              <Label dim size={13}>{i.detail}</Label>
            </View>
          </View>
          {i.level !== 'ok' ? (
            <View style={{ marginLeft: 38, marginTop: 4 }}>
              <Label dim size={13}>{i.impact}</Label>
              {i.action && i.actionLabel ? (
                <Button
                  small
                  title={i.actionLabel}
                  style={{ marginTop: space.sm, alignSelf: 'flex-start' }}
                  onPress={async () => {
                    await i.action!();
                    onChanged();
                  }}
                />
              ) : null}
            </View>
          ) : null}
        </View>
      ))}
    </Card>
  );
}

export function SensorLine({ rates, now }: { rates: HostState['rates']; now: number }) {
  return (
    <Label dim size={12}>
      GPS {rates.location}/min ({ago(rates.lastLocationT, now)}) · attività {rates.activity}/min · movimento {rates.motion}/min
    </Label>
  );
}

/** Community: posti vicini quando stai cercando, e il tuo posto condiviso. */
export function CommunityCard({ community, now }: { community: HostState['community']; now: number }) {
  const c = usePalette();
  if (!community.configured) {
    return (
      <Card>
        <Label size={13} dim bold>COMMUNITY</Label>
        <Label dim size={13} style={{ marginTop: 4 }}>
          Server della community non ancora collegato: le previsioni restano su questo telefono.
        </Label>
      </Card>
    );
  }
  const mins = (t: number) => Math.max(0, Math.round((t - now) / 60000));
  return (
    <Card accent={FAMILY_COLORS.parking}>
      <Label size={13} dim bold>COMMUNITY</Label>
      {community.shared ? (
        <Label style={{ marginTop: 4 }}>
          📣 Il tuo posto è condiviso: {community.shared.kind === 'FREED' ? 'libero' : `si libera tra ~${mins(community.shared.freeAt)} min`}
        </Label>
      ) : null}
      {community.listening ? (
        <>
          <Label style={{ marginTop: 4 }}>🔎 Stai cercando parcheggio: ti avviso dei posti vicini</Label>
          {community.nearby.length === 0 ? (
            <Label dim size={13} style={{ marginTop: 4 }}>Nessun posto in arrivo vicino a te{community.lastSyncT ? ` · controllato ${ago(community.lastSyncT, now)}` : ''}</Label>
          ) : (
            community.nearby.slice(0, 5).map((s) => (
              <Label key={s.id} size={14} style={{ marginTop: 4 }}>
                🅿️ {s.address ?? 'Posto'} · {s.kind === 'FREED' ? 'libero' : `tra ~${mins(s.freeAt)} min`} · {s.distanceM} m
              </Label>
            ))
          )}
        </>
      ) : null}
      {!community.shared && !community.listening ? (
        <Label dim size={13} style={{ marginTop: 4 }}>
          Automatica: quando torni all'auto avvisa chi cerca vicino; quando cerchi parcheggio ricevi i posti che si liberano.
        </Label>
      ) : null}
      {community.error ? <Label size={13} color={c.warn} style={{ marginTop: 4 }}>{community.error}</Label> : null}
    </Card>
  );
}

// Mappa dei posti: verde = libero, arancione = si libera, rosso = la tua auto, punto blu = tu.
// Mappa MapLibre con le cartine gratuite di OpenFreeMap (dati © OpenStreetMap), senza chiavi né costi.
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Camera, Map, Marker, NativeUserLocation } from '@maplibre/maplibre-react-native';
import { Button, Label } from '../ui/components/basics.tsx';
import { navigateTo, useHost, useNow } from '../ui/components/live.tsx';
import { space, usePalette } from '../ui/theme.ts';

const STYLE = 'https://tiles.openfreemap.org/styles/liberty';
const GREEN = '#15803D';
const ORANGE = '#D97706';
const RED = '#E53935';

function Pin({ color, label }: { color: string; label: string }) {
  return (
    <View style={{ alignItems: 'center' }}>
      <View style={{ backgroundColor: color, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 10, borderWidth: 2, borderColor: '#FFFFFF' }}>
        <Text style={{ color: '#FFFFFF', fontWeight: '800', fontSize: 13 }}>{label}</Text>
      </View>
      <View style={{ width: 0, height: 0, borderLeftWidth: 7, borderRightWidth: 7, borderTopWidth: 8, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: color }} />
    </View>
  );
}

export function MapScreen({ onBack }: { onBack: () => void }) {
  const c = usePalette();
  const s = useHost();
  const now = useNow(5000);
  const me = s.track.length ? s.track[s.track.length - 1] : null;
  const car = s.session?.spot.pointFinal ?? null;
  const spots = s.community.nearby;
  const center: [number, number] | null = me ? [me.longitude, me.latitude] : car ? [car.longitude, car.latitude] : spots[0] ? [spots[0].longitude, spots[0].latitude] : null;
  const best = [...spots].sort((a, b) => a.distanceM - b.distanceM)[0] ?? null;
  const mins = (t: number) => Math.max(0, Math.round((t - now) / 60000));
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      {center ? (
        <Map style={{ flex: 1 }} mapStyle={STYLE} logo={false} attribution compass={false}>
          <Camera initialViewState={{ center, zoom: 15 }} />
          <NativeUserLocation />
          {car ? (
            <Marker id="car" lngLat={[car.longitude, car.latitude]} anchor="bottom">
              <View>
                <Pin color={RED} label="La tua auto" />
              </View>
            </Marker>
          ) : null}
          {spots.map((p) => (
            <Marker key={p.id} id={p.id} lngLat={[p.longitude, p.latitude]} anchor="bottom">
              <View>
                <Pin color={p.kind === 'FREED' ? GREEN : ORANGE} label={p.kind === 'FREED' ? 'P · ora' : `P · ${mins(p.freeAt)} min`} />
              </View>
            </Marker>
          ))}
        </Map>
      ) : (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.lg }}>
          <Label dim>In attesa della posizione…</Label>
        </View>
      )}
      <View style={{ position: 'absolute', top: space.md, left: space.md }}>
        <Pressable onPress={onBack} hitSlop={12} style={{ backgroundColor: '#FFFFFF', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10 }}>
          <Text style={{ color: '#0F172A', fontWeight: '800', fontSize: 15 }}>‹ Indietro</Text>
        </Pressable>
      </View>
      <View style={{ position: 'absolute', left: space.md, right: space.md, bottom: space.lg, backgroundColor: '#FFFFFF', borderRadius: 20, padding: space.md }}>
        {best ? (
          <>
            <Text style={{ color: best.kind === 'FREED' ? GREEN : ORANGE, fontWeight: '800', fontSize: 13 }}>
              {best.kind === 'FREED' ? 'LIBERO ORA' : `SI LIBERA TRA ~${mins(best.freeAt)} MIN`}
            </Text>
            <Text style={{ color: '#0F172A', fontWeight: '800', fontSize: 19, marginTop: 2 }}>
              {best.address ?? 'Posto vicino'} · {best.distanceM} m
            </Text>
            <Button title="🧭 Portami lì" style={{ marginTop: space.sm, backgroundColor: best.kind === 'FREED' ? GREEN : ORANGE }} onPress={() => navigateTo(best.latitude, best.longitude)} />
          </>
        ) : (
          <Text style={{ color: '#334155', fontSize: 15 }}>Nessun posto in arrivo qui vicino in questo momento.</Text>
        )}
        <Text style={{ color: '#64748B', fontSize: 11, marginTop: 6 }}>Mappa © OpenStreetMap · OpenFreeMap</Text>
      </View>
    </View>
  );
}

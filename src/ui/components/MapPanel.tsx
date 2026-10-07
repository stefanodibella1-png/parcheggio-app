// Mappa di debug.
// iOS: Apple Maps (nessuna chiave). Android: vista della traccia disegnata
// dall'app (senza mappa di sfondo, quindi senza chiave Google Maps);
// "Apri in Mappe" mostra il punto sulla mappa vera.
import React, { useMemo, useState } from 'react';
import { Platform, Pressable, Text, View, type LayoutChangeEvent } from 'react-native';
import MapView, { Circle, Marker, Polyline } from 'react-native-maps';
import type { DetectionEvent, EngineState, LocationSample, ParkingSpot } from '../../../engine/types.ts';
import { FAMILY_COLORS, familyOf, usePalette, radius } from '../theme.ts';

interface Props {
  track: LocationSample[];
  events: DetectionEvent[];
  spot?: ParkingSpot | null;
  height?: number;
  accuracyLimit?: number;
  showRejected?: boolean;
  onPressPoint?: (s: LocationSample) => void;
  highlightT?: number | null;
}

interface Segment {
  color: string;
  points: LocationSample[];
}

function stateTimeline(events: DetectionEvent[]): { t: number; state: EngineState }[] {
  return events.map((e) => ({ t: e.t, state: e.to }));
}

export function buildSegments(track: LocationSample[], events: DetectionEvent[], limit: number): Segment[] {
  const tl = stateTimeline(events);
  const segs: Segment[] = [];
  let ti = 0;
  let state: EngineState = 'UNKNOWN';
  let cur: Segment | null = null;
  for (const p of track) {
    if (p.accuracy > limit) continue;
    while (ti < tl.length && tl[ti].t <= p.t) state = tl[ti++].state;
    const color = FAMILY_COLORS[familyOf(state)];
    if (!cur || cur.color !== color) {
      const prevLast: LocationSample | null = cur ? cur.points[cur.points.length - 1] : null;
      cur = { color, points: prevLast ? [prevLast] : [] };
      segs.push(cur);
    }
    cur.points.push(p);
  }
  return segs;
}

function thin<T>(arr: T[], max: number): T[] {
  if (arr.length <= max) return arr;
  const step = arr.length / max;
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(arr[Math.floor(i * step)]);
  out.push(arr[arr.length - 1]);
  return out;
}

export function MapPanel({ track, events, spot, height = 260, accuracyLimit = 30, showRejected, onPressPoint, highlightT }: Props) {
  const c = usePalette();
  const segments = useMemo(() => buildSegments(track, events, accuracyLimit), [track, events, accuracyLimit]);
  const rejected = useMemo(() => (showRejected ? thin(track.filter((p) => p.accuracy > accuracyLimit), 200) : []), [track, showRejected, accuracyLimit]);
  const valid = useMemo(() => track.filter((p) => p.accuracy <= accuracyLimit), [track, accuracyLimit]);
  const last = valid[valid.length - 1] ?? track[track.length - 1] ?? null;
  const highlight = highlightT ? track.reduce<LocationSample | null>((b, p) => (!b || Math.abs(p.t - highlightT) < Math.abs(b.t - highlightT) ? p : b), null) : null;

  if (track.length === 0 && !spot) {
    return (
      <View style={{ height, borderRadius: radius.md, backgroundColor: c.cardAlt, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: c.textDim }}>Nessuna posizione ancora</Text>
      </View>
    );
  }

  if (Platform.OS === 'ios') {
    const center = spot?.pointFinal ?? last!;
    return (
      <View style={{ height, borderRadius: radius.md, overflow: 'hidden' }}>
        <MapView
          style={{ flex: 1 }}
          initialRegion={{ latitude: center.latitude, longitude: center.longitude, latitudeDelta: 0.01, longitudeDelta: 0.01 }}
          showsUserLocation
          onPress={
            onPressPoint
              ? (e) => {
                  const { latitude, longitude } = e.nativeEvent.coordinate;
                  const near = nearest(valid, latitude, longitude);
                  if (near) onPressPoint(near);
                }
              : undefined
          }
        >
          {segments.map((s, i) => (
            <Polyline key={i} coordinates={thin(s.points, 400)} strokeColor={s.color} strokeWidth={4} />
          ))}
          {rejected.map((p) => (
            <Circle key={`r${p.t}`} center={p} radius={2} fillColor="#8A94A666" strokeColor="transparent" />
          ))}
          {spot ? (
            <>
              <Circle center={spot.pointFinal} radius={spot.pointFinal.accuracyM} fillColor="#F59E0B33" strokeColor="#F59E0B" />
              <Marker coordinate={spot.pointFinal} title="Auto" description={spot.address?.formatted ?? undefined} pinColor="#F59E0B" />
              {spot.pointAtPark ? <Circle center={spot.pointAtPark} radius={1.5} fillColor="#3B82F6" strokeColor="#3B82F6" /> : null}
              {spot.pointAtDeparture ? <Circle center={spot.pointAtDeparture} radius={1.5} fillColor="#22C55E" strokeColor="#22C55E" /> : null}
            </>
          ) : null}
          {highlight ? <Marker coordinate={highlight} pinColor="#EF4444" /> : null}
        </MapView>
      </View>
    );
  }
  return <TrackView height={height} segments={segments} rejected={rejected} spot={spot ?? null} last={last} onPressPoint={onPressPoint} valid={valid} highlight={highlight} />;
}

function nearest(points: LocationSample[], lat: number, lon: number): LocationSample | null {
  let best: LocationSample | null = null;
  let bd = Infinity;
  for (const p of points) {
    const d = (p.latitude - lat) ** 2 + ((p.longitude - lon) * Math.cos((lat * Math.PI) / 180)) ** 2;
    if (d < bd) {
      bd = d;
      best = p;
    }
  }
  return best;
}

function TrackView({
  height,
  segments,
  rejected,
  spot,
  last,
  valid,
  onPressPoint,
  highlight,
}: {
  height: number;
  segments: Segment[];
  rejected: LocationSample[];
  spot: ParkingSpot | null;
  last: LocationSample | null;
  valid: LocationSample[];
  onPressPoint?: (s: LocationSample) => void;
  highlight: LocationSample | null;
}) {
  const c = usePalette();
  const [w, setW] = useState(0);
  const pts = [...segments.flatMap((s) => s.points), ...(spot ? [spot.pointFinal] : [])];
  if (pts.length === 0 && last) pts.push(last);
  const lat0 = Math.min(...pts.map((p) => p.latitude));
  const lat1 = Math.max(...pts.map((p) => p.latitude));
  const lon0 = Math.min(...pts.map((p) => p.longitude));
  const lon1 = Math.max(...pts.map((p) => p.longitude));
  const k = Math.cos(((lat0 + lat1) / 2) * (Math.PI / 180));
  const spanM = Math.max((lat1 - lat0) * 111_320, (lon1 - lon0) * 111_320 * k, 60) * 1.15;
  const pad = 14;
  const size = Math.max(1, Math.min(w, height) - pad * 2);
  const mPerPx = spanM / size;
  const cx = (lon0 + lon1) / 2;
  const cy = (lat0 + lat1) / 2;
  const toXY = (p: { latitude: number; longitude: number }) => ({
    x: w / 2 + ((p.longitude - cx) * 111_320 * k) / mPerPx,
    y: height / 2 - ((p.latitude - cy) * 111_320) / mPerPx,
  });
  const onLayout = (e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width);
  const scaleM = niceScale(mPerPx * 80);

  return (
    <Pressable
      onLayout={onLayout}
      onPress={
        onPressPoint
          ? (e) => {
              const { locationX, locationY } = e.nativeEvent;
              const lon = cx + ((locationX - w / 2) * mPerPx) / (111_320 * k);
              const lat = cy - ((locationY - height / 2) * mPerPx) / 111_320;
              const n = nearest(valid, lat, lon);
              if (n) onPressPoint(n);
            }
          : undefined
      }
      style={{ height, borderRadius: radius.md, backgroundColor: c.cardAlt, overflow: 'hidden' }}
    >
      {w > 0 ? (
        <>
          {rejected.map((p) => {
            const { x, y } = toXY(p);
            return <View key={`r${p.t}`} style={{ position: 'absolute', left: x - 1.5, top: y - 1.5, width: 3, height: 3, borderRadius: 2, backgroundColor: '#8A94A666' }} />;
          })}
          {segments.map((s, si) =>
            thin(s.points, 500).map((p, i) => {
              const { x, y } = toXY(p);
              return <View key={`${si}-${i}`} style={{ position: 'absolute', left: x - 2.5, top: y - 2.5, width: 5, height: 5, borderRadius: 3, backgroundColor: s.color }} />;
            }),
          )}
          {spot
            ? (() => {
                const { x, y } = toXY(spot.pointFinal);
                const r = Math.max(6, spot.pointFinal.accuracyM / mPerPx);
                return (
                  <>
                    <View style={{ position: 'absolute', left: x - r, top: y - r, width: r * 2, height: r * 2, borderRadius: r, backgroundColor: '#F59E0B33', borderWidth: 1, borderColor: '#F59E0B' }} />
                    <Text style={{ position: 'absolute', left: x - 10, top: y - 14, fontSize: 18 }}>🅿️</Text>
                  </>
                );
              })()
            : null}
          {last
            ? (() => {
                const { x, y } = toXY(last);
                return <View style={{ position: 'absolute', left: x - 7, top: y - 7, width: 14, height: 14, borderRadius: 7, backgroundColor: '#FFFFFF', borderWidth: 3, borderColor: '#3B82F6' }} />;
              })()
            : null}
          {highlight
            ? (() => {
                const { x, y } = toXY(highlight);
                return <View style={{ position: 'absolute', left: x - 8, top: y - 8, width: 16, height: 16, borderRadius: 8, borderWidth: 3, borderColor: '#EF4444' }} />;
              })()
            : null}
          <View style={{ position: 'absolute', left: 12, bottom: 10, alignItems: 'flex-start' }}>
            <View style={{ width: scaleM.m / mPerPx, height: 3, backgroundColor: c.text, opacity: 0.6 }} />
            <Text style={{ color: c.textDim, fontSize: 11, marginTop: 2 }}>{scaleM.m >= 1000 ? `${scaleM.m / 1000} km` : `${scaleM.m} m`} · nord in alto</Text>
          </View>
        </>
      ) : null}
    </Pressable>
  );
}

/** lunghezza "tonda" della barra di scala, circa 80 px */
function niceScale(m: number): { m: number } {
  const steps = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000];
  return { m: steps.find((x) => x >= m) ?? 10000 };
}

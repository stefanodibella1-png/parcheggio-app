// Funzioni geografiche di base.

import type { GeoPoint, LocationSample } from './types.ts';

const R = 6371000;
const RAD = Math.PI / 180;

export interface LatLon {
  latitude: number;
  longitude: number;
}

export function distanceM(a: LatLon, b: LatLon): number {
  const dLat = (b.latitude - a.latitude) * RAD;
  const dLon = (b.longitude - a.longitude) * RAD;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.latitude * RAD) * Math.cos(b.latitude * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
}

/** Direzione iniziale da a verso b, gradi 0–360 (0 = nord). */
export function bearingDeg(a: LatLon, b: LatLon): number {
  const φ1 = a.latitude * RAD;
  const φ2 = b.latitude * RAD;
  const Δλ = (b.longitude - a.longitude) * RAD;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (Math.atan2(y, x) / RAD + 360) % 360;
}

/** Differenza assoluta tra due angoli, 0–180. */
export function angleDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/** Media circolare di angoli in gradi. */
export function meanAngle(values: number[]): number | null {
  if (values.length === 0) return null;
  let s = 0;
  let c = 0;
  for (const v of values) {
    s += Math.sin(v * RAD);
    c += Math.cos(v * RAD);
  }
  if (Math.hypot(s, c) / values.length < 0.5) return null; // direzioni troppo disperse
  return (Math.atan2(s, c) / RAD + 360) % 360;
}

function median(values: number[]): number {
  const v = [...values].sort((x, y) => x - y);
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/**
 * Punto stabilizzato da un insieme di fix: media pesata per 1/accuracy²,
 * dopo aver scartato i fix lontani più di 2× la mediana dal punto mediano.
 * La precisione stimata NON assume errori indipendenti (i fix GPS consecutivi
 * sono correlati): mediana delle accuracy / √min(n,4), minimo 2 m.
 */
export function stabilizedPoint(fixes: LocationSample[]): GeoPoint | null {
  if (fixes.length === 0) return null;
  const medLat = median(fixes.map((f) => f.latitude));
  const medLon = median(fixes.map((f) => f.longitude));
  const center = { latitude: medLat, longitude: medLon };
  const dists = fixes.map((f) => distanceM(center, f));
  const medDist = median(dists);
  const cut = Math.max(5, medDist * 2);
  const kept = fixes.filter((_, i) => dists[i] <= cut);
  const use = kept.length > 0 ? kept : fixes;
  let sw = 0;
  let lat = 0;
  let lon = 0;
  for (const f of use) {
    const w = 1 / Math.max(1, f.accuracy) ** 2;
    sw += w;
    lat += f.latitude * w;
    lon += f.longitude * w;
  }
  const p = { latitude: lat / sw, longitude: lon / sw };
  const spread = use.reduce((s, f) => s + distanceM(p, f) ** 2, 0) / use.length;
  const medAcc = median(use.map((f) => f.accuracy));
  const accuracyM = Math.max(2, medAcc / Math.sqrt(Math.min(use.length, 4)), Math.sqrt(spread));
  return { ...p, accuracyM: round1(accuracyM), fixes: use.length, spreadM: round1(Math.sqrt(spread)) };
}

/** Fonde due punti pesando per precisione. */
export function mergePoints(a: GeoPoint, b: GeoPoint): GeoPoint {
  const wa = 1 / a.accuracyM ** 2;
  const wb = 1 / b.accuracyM ** 2;
  const latitude = (a.latitude * wa + b.latitude * wb) / (wa + wb);
  const longitude = (a.longitude * wa + b.longitude * wb) / (wa + wb);
  const accuracyM = Math.max(2, Math.sqrt(1 / (wa + wb)));
  return {
    latitude,
    longitude,
    accuracyM: round1(accuracyM),
    fixes: a.fixes + b.fixes,
    spreadM: round1(Math.max(a.spreadM, b.spreadM)),
  };
}

export function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

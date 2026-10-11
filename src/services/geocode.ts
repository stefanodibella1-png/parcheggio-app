// Reverse geocoding con il geocoder di sistema (nessuna chiave, nessun servizio esterno).
import * as Location from 'expo-location';
import { Platform } from 'react-native';
import { distanceM } from '../../engine/geo.ts';
import type { GeocodeStatus, ParkingSpot, SpotAddress } from '../../engine/types.ts';

export interface GeocodeResult {
  address: SpotAddress | null;
  addressSource: string;
  addressDistanceM: number | null;
  geocodedAt: number;
  geocodeStatus: GeocodeStatus;
}

function classify(err: unknown): GeocodeStatus {
  const msg = String((err as Error)?.message ?? err).toLowerCase();
  if (msg.includes('not available') || msg.includes('unavailable') || msg.includes('not present')) return 'NOT_AVAILABLE';
  if (msg.includes('network') || msg.includes('internet') || msg.includes('grpc') || msg.includes('timed out') || msg.includes('offline')) return 'NO_NETWORK';
  return 'ERROR';
}

export function formatAddress(a: Location.LocationGeocodedAddress): SpotAddress {
  const street = a.street ?? (a.name && /\d/.test(a.name) === false ? a.name : null);
  const streetNumber = a.streetNumber ?? null;
  const city = a.city ?? a.subregion ?? null;
  const province = a.subregion && a.subregion !== city ? a.subregion : null;
  const line1 = [street, streetNumber].filter(Boolean).join(' ');
  const line2 = [a.postalCode, city].filter(Boolean).join(' ');
  const formatted = [line1, line2].filter((x) => x && x.length > 0).join(', ') || a.formattedAddress || null;
  return {
    street,
    streetNumber,
    postalCode: a.postalCode ?? null,
    district: a.district ?? null,
    city,
    province,
    formatted,
  };
}

/**
 * Seconda fonte quando il geocoder del telefono non dà la via (es. dentro un parcheggio di un
 * centro commerciale restituisce solo "95121 Catania"): OpenStreetMap / Nominatim.
 * Dati © OpenStreetMap contributors (ODbL). Una richiesta per parcheggio, nel rispetto dei limiti d'uso.
 */
async function nominatim(lat: number, lon: number): Promise<{ road: string | null; number: string | null; place: string | null; district: string | null; city: string | null; postcode: string | null } | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1&accept-language=it`,
      { headers: { 'User-Agent': 'ParkingCT/1.0 (app parcheggi Catania)', Accept: 'application/json' }, signal: ctrl.signal },
    );
    if (!r.ok) return null;
    const j = (await r.json()) as { name?: string; address?: Record<string, string> };
    const a = j.address ?? {};
    const road = a.road ?? a.pedestrian ?? a.square ?? a.footway ?? a.service ?? null;
    return {
      road,
      number: a.house_number ?? null,
      place: j.name && j.name !== road ? j.name : (a.shop ?? a.mall ?? a.amenity ?? a.building ?? null),
      district: a.suburb ?? a.quarter ?? a.neighbourhood ?? null,
      city: a.city ?? a.town ?? a.village ?? null,
      postcode: a.postcode ?? null,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** completa un indirizzo senza via con i dati di OpenStreetMap */
export async function enrichAddress(address: SpotAddress | null, lat: number, lon: number): Promise<SpotAddress | null> {
  if (address?.street) return address;
  const o = await nominatim(lat, lon);
  if (!o || (!o.road && !o.place)) return address;
  const street = o.road;
  const streetNumber = o.number;
  const city = address?.city ?? o.city;
  const postalCode = address?.postalCode ?? o.postcode;
  const line1 = [street, streetNumber].filter(Boolean).join(' ');
  const line2 = [postalCode, city].filter(Boolean).join(' ');
  return {
    street,
    streetNumber,
    postalCode,
    district: address?.district ?? o.district,
    city,
    province: address?.province ?? null,
    formatted: [o.place, line1, line2].filter((x) => x && x.length > 0).join(', ') || address?.formatted || null,
    place: o.place,
  };
}

export async function reverseGeocode(spot: ParkingSpot): Promise<GeocodeResult> {
  const p = spot.pointFinal;
  const source = Platform.OS === 'ios' ? 'ios-clgeocoder' : 'android-geocoder';
  try {
    const list = await Location.reverseGeocodeAsync({ latitude: p.latitude, longitude: p.longitude });
    if (!list || list.length === 0) {
      const osm = await enrichAddress(null, p.latitude, p.longitude);
      if (osm) return { address: osm, addressSource: 'openstreetmap', addressDistanceM: null, geocodedAt: Date.now(), geocodeStatus: 'OK' };
      return { address: null, addressSource: source, addressDistanceM: null, geocodedAt: Date.now(), geocodeStatus: 'ERROR' };
    }
    // tra i risultati del telefono si preferisce quello con la via
    const best = list.find((x) => x.street) ?? list[0];
    const address = (await enrichAddress(formatAddress(best), p.latitude, p.longitude)) ?? formatAddress(best);
    // controllo: quanto dista l'indirizzo trovato dal punto?
    let addressDistanceM: number | null = null;
    if (address.formatted) {
      try {
        const back = await Location.geocodeAsync(address.formatted);
        if (back.length > 0) addressDistanceM = Math.round(distanceM(p, back[0]));
      } catch {
        // facoltativo
      }
    }
    return { address, addressSource: source, addressDistanceM, geocodedAt: Date.now(), geocodeStatus: 'OK' };
  } catch (e) {
    return { address: null, addressSource: source, addressDistanceM: null, geocodedAt: Date.now(), geocodeStatus: classify(e) };
  }
}

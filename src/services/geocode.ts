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

export async function reverseGeocode(spot: ParkingSpot): Promise<GeocodeResult> {
  const p = spot.pointFinal;
  const source = Platform.OS === 'ios' ? 'ios-clgeocoder' : 'android-geocoder';
  try {
    const list = await Location.reverseGeocodeAsync({ latitude: p.latitude, longitude: p.longitude });
    if (!list || list.length === 0) {
      return { address: null, addressSource: source, addressDistanceM: null, geocodedAt: Date.now(), geocodeStatus: 'ERROR' };
    }
    const address = formatAddress(list[0]);
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

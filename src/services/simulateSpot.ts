// SIMULAZIONE (solo app di laboratorio PARCHEGGIO): fa vedere e sentire cosa riceve chi cerca
// parcheggio quando un posto vicino sta per liberarsi. Non passa dal motore di rilevamento
// (nessun dato finto entra nel motore): crea un posto di prova sul server, scade in 3 minuti
// ed è marcato "SIMULAZIONE", così lo ricevono anche gli altri telefoni di prova vicini.
import * as Location from 'expo-location';
import { publishSpot } from '../community/community.ts';
import { notifyNearbySpot } from './notifications.ts';
import { speak } from './voice.ts';

function offset(lat: number, lon: number, meters: number, bearingDeg: number): { latitude: number; longitude: number } {
  const b = (bearingDeg * Math.PI) / 180;
  const dLat = (meters * Math.cos(b)) / 111_320;
  const dLon = (meters * Math.sin(b)) / (111_320 * Math.cos((lat * Math.PI) / 180));
  return { latitude: lat + dLat, longitude: lon + dLon };
}

async function streetName(lat: number, lon: number): Promise<string | null> {
  try {
    const r = (await Location.reverseGeocodeAsync({ latitude: lat, longitude: lon }))[0];
    if (!r) return null;
    return r.street ? `${r.street}${r.streetNumber ? ` ${r.streetNumber}` : ''}` : (r.name ?? null);
  } catch {
    return null;
  }
}

export type SimStep = 'cerco' | 'soon' | 'freed' | 'fine' | 'errore';

/**
 * Sequenza: posto che si libera tra 2 minuti a ~200 m (notifica + voce),
 * dopo 20 secondi lo stesso posto diventa libero (notifica + voce).
 */
export async function simulateSpot(onStep: (s: SimStep, info?: string) => void, last?: { latitude: number; longitude: number } | null): Promise<void> {
  onStep('cerco');
  let here = last ?? null;
  if (!here) {
    const p = await Location.getLastKnownPositionAsync().catch(() => null);
    here = p ? { latitude: p.coords.latitude, longitude: p.coords.longitude } : null;
  }
  if (!here) {
    onStep('errore', 'Posizione non disponibile: attiva il GPS e riprova.');
    return;
  }
  const dist = 200;
  const spot = offset(here.latitude, here.longitude, dist, Math.random() * 360);
  const street = await streetName(spot.latitude, spot.longitude);
  const address = street ? `${street} (simulazione)` : 'SIMULAZIONE';
  const id = `sim-${Date.now().toString(36)}`;
  const now = Date.now();

  // 1) si libera tra 2 minuti
  const freeAt = now + 120_000;
  await notifyNearbySpot({ id, kind: 'SOON', address, freeAt, distanceM: dist }, now);
  speak(`Posto che si libera ${street ? `in ${street}` : 'vicino a te'} tra circa 2 minuti, a ${dist} metri.`);
  onStep('soon', address);
  void publishSpot({
    id,
    kind: 'SOON',
    latitude: spot.latitude,
    longitude: spot.longitude,
    address,
    quality: 'SIM',
    confidence: 0,
    freeAt,
    createdAt: now,
    expiresAt: now + 180_000,
    deviceId: 'simulazione',
  }).catch(() => false);

  // 2) dopo 20 s: ora è libero
  await new Promise((r) => setTimeout(r, 20_000));
  const t2 = Date.now();
  await notifyNearbySpot({ id, kind: 'FREED', address, freeAt: t2, distanceM: 150 }, t2);
  speak(`Il posto ${street ? `in ${street}` : 'che ti ho segnalato'} è libero, a 150 metri.`);
  onStep('freed', address);
  void publishSpot({
    id,
    kind: 'FREED',
    latitude: spot.latitude,
    longitude: spot.longitude,
    address,
    quality: 'SIM',
    confidence: 0,
    freeAt: t2,
    createdAt: t2,
    expiresAt: t2 + 120_000,
    deviceId: 'simulazione',
  }).catch(() => false);
  onStep('fine');
}

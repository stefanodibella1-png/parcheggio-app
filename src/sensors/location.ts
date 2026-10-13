// Posizione in foreground e background (expo-location + expo-task-manager).
import * as Location from 'expo-location';
import { AppState, Platform } from 'react-native';
import type { LocationSample } from '../../engine/types.ts';
import { IS_PUBLIC } from '../variant.ts';
import { ActivityRecognition } from '../../modules/activity-recognition/index.ts';

/**
 * Android (build 19+): il GPS lo gestisce il servizio in primo piano nativo del modulo.
 * Il servizio di expo-location veniva chiuso dal telefono (test 13/10: 4 ore senza posizioni).
 * Le posizioni arrivano nel buffer nativo e l'host le legge ogni 5 s (drainLocations).
 */
export function nativeGps(): boolean {
  return Platform.OS === 'android' && ActivityRecognition.locationServicePresent;
}

const INTERVAL: Record<LocationMode, number> = { high: 1000, parked: 2000, away: 5000 };

function startNative(mode: LocationMode, body: string): void {
  // servizio già attivo: si cambia solo la frequenza (in background Android non permette di riavviarlo)
  if (ActivityRecognition.locationServiceRunning() && ActivityRecognition.setLocationInterval(INTERVAL[mode])) return;
  ActivityRecognition.startLocationService(
    INTERVAL[mode],
    IS_PUBLIC ? 'ParkingCT è attivo' : 'PARCHEGGIO · test attivo',
    IS_PUBLIC ? 'Ricordo dove parcheggi. Tocca per aprire.' : body,
  );
}

export const LOCATION_TASK = 'parcheggio-location';
export const GEOFENCE_TASK = 'parcheggio-geofence';

export type LocationMode = 'high' | 'parked' | 'away';

let currentMode: LocationMode | null = null;
let currentBody = '';

/**
 * high   = guida / partenza: 1 Hz, massima precisione, nessuna pausa automatica
 * parked = auto ferma, utente vicino: 0,5 Hz
 * away   = utente lontano a piedi: risparmio batteria, i geofence fanno da rete
 */
function optionsFor(mode: LocationMode, body: string): Location.LocationTaskOptions {
  const base: Location.LocationTaskOptions = {
    pausesUpdatesAutomatically: false, // iOS: altrimenti si ferma quando l'auto si ferma
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: IS_PUBLIC ? 'ParkingCT è attivo' : 'PARCHEGGIO · test attivo',
      notificationBody: IS_PUBLIC ? 'Ricordo dove parcheggi. Tocca per aprire.' : body,
      notificationColor: '#3B82F6',
      killServiceOnDestroy: false,
    },
  };
  if (mode === 'high') {
    return { ...base, accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 0, activityType: Location.ActivityType.AutomotiveNavigation };
  }
  // Android: niente filtro di distanza. Con il filtro, da fermi non arriva nessuna posizione,
  // il telefono (HyperOS) considera l'app inattiva e la congela: poi il GPS non riparte
  // nemmeno quando si risale in auto (test 11/10 19:27, 12/10 13:21).
  const android = Platform.OS === 'android';
  if (mode === 'parked') {
    return { ...base, accuracy: Location.Accuracy.High, timeInterval: 2000, distanceInterval: android ? 0 : 2, activityType: Location.ActivityType.Other };
  }
  return {
    ...base,
    accuracy: android ? Location.Accuracy.High : Location.Accuracy.Balanced,
    timeInterval: android ? 5000 : 10000,
    distanceInterval: android ? 0 : 15,
    activityType: Location.ActivityType.Fitness,
  };
}

export async function startLocation(mode: LocationMode, body: string): Promise<void> {
  if (mode === currentMode && body === currentBody) return;
  if (nativeGps()) {
    currentMode = mode;
    currentBody = body;
    // il servizio vecchio di expo-location, se attivo da una versione precedente, si spegne
    if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(() => false)) {
      await Location.stopLocationUpdatesAsync(LOCATION_TASK).catch(() => {});
    }
    startNative(mode, body);
    return;
  }
  // in background su Android non si tocca un servizio già attivo
  if (Platform.OS === 'android' && AppState.currentState !== 'active' && (await locationRunning())) return;
  currentMode = mode;
  currentBody = body;
  await Location.startLocationUpdatesAsync(LOCATION_TASK, optionsFor(mode, body));
}

export async function stopLocation(): Promise<void> {
  currentMode = null;
  currentBody = '';
  if (nativeGps()) ActivityRecognition.stopLocationService();
  if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(() => false)) {
    await Location.stopLocationUpdatesAsync(LOCATION_TASK);
  }
}

/**
 * Riavvio del GPS quando il telefono l'ha fermato. SOLO con l'app in primo piano:
 * in background Android non permette di riavviare il servizio, e un arresto
 * seguito da un avvio fallito lo lascerebbe spento (test 10/10 alle 13:07).
 * Niente arresto: si richiama l'avvio, che riattiva il servizio con le stesse opzioni.
 */
export async function restartLocation(mode: LocationMode, body: string): Promise<void> {
  if (Platform.OS === 'android' && AppState.currentState !== 'active') return;
  currentMode = mode;
  currentBody = body;
  if (nativeGps()) {
    startNative(mode, body);
    return;
  }
  await Location.startLocationUpdatesAsync(LOCATION_TASK, optionsFor(mode, body));
}

export async function locationRunning(): Promise<boolean> {
  if (nativeGps()) return ActivityRecognition.locationServiceRunning();
  return Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(() => false);
}

export function getLocationMode(): LocationMode | null {
  return currentMode;
}

export function toSample(l: Location.LocationObject): LocationSample {
  const c = l.coords;
  const speed = c.speed === null || c.speed === undefined || c.speed < 0 ? null : c.speed;
  const heading = c.heading === null || c.heading === undefined || c.heading < 0 || speed === null || speed < 1 ? null : c.heading;
  return {
    t: l.timestamp,
    latitude: c.latitude,
    longitude: c.longitude,
    accuracy: c.accuracy ?? 999,
    speed,
    altitude: c.altitude ?? null,
    heading,
    source: Platform.OS === 'ios' ? 'corelocation' : 'fused',
  };
}

// ---- geofence attorno al punto di parcheggio --------------------------------------

export async function startGeofences(latitude: number, longitude: number, radii: number[]): Promise<void> {
  const regions: Location.LocationRegion[] = radii.map((r) => ({
    identifier: `parking-${r}`,
    latitude,
    longitude,
    radius: r,
    notifyOnEnter: true,
    notifyOnExit: true,
  }));
  await Location.startGeofencingAsync(GEOFENCE_TASK, regions);
}

export async function stopGeofences(): Promise<void> {
  if (await Location.hasStartedGeofencingAsync(GEOFENCE_TASK).catch(() => false)) {
    await Location.stopGeofencingAsync(GEOFENCE_TASK);
  }
}

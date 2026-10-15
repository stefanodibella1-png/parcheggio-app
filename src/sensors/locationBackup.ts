// Android: posizioni di riserva consegnate da Play Services con un PendingIntent.
// Su Xiaomi/HyperOS il telefono può congelare l'app per decine di minuti (test 12/10 ore 13:37):
// il servizio GPS di expo-location smette di consegnare, mentre i broadcast di sistema
// continuano ad arrivare (come le attività). Le posizioni restano nel buffer nativo e
// vengono recuperate appena JS riparte. Su iOS non fa nulla.
import { Platform } from 'react-native';
import { ActivityRecognition, type NativeLocation } from '../../modules/activity-recognition/index.ts';
import type { LocationSample } from '../../engine/types.ts';

export const LOCATION_BACKUP_MS = 3000;

export function locationBackupAvailable(): boolean {
  return Platform.OS === 'android' && ActivityRecognition.locationBackupPresent;
}

export function startLocationBackup(): void {
  if (!locationBackupAvailable()) return;
  // con il servizio GPS nativo (build 19+) la riserva non serve: stesse posizioni, doppio consumo
  if (ActivityRecognition.locationServicePresent) {
    try {
      ActivityRecognition.stopLocation();
    } catch {
      // niente
    }
    return;
  }
  try {
    ActivityRecognition.startLocation(LOCATION_BACKUP_MS);
  } catch {
    // permesso mancante: resta solo il GPS principale
  }
}

export function stopLocationBackup(): void {
  if (!locationBackupAvailable()) return;
  try {
    ActivityRecognition.stopLocation();
  } catch {
    // niente da fermare
  }
}

function toSample(l: NativeLocation): LocationSample {
  const speed = l.speed < 0 ? null : l.speed;
  return {
    t: l.t,
    latitude: l.latitude,
    longitude: l.longitude,
    accuracy: l.accuracy,
    speed,
    altitude: l.altitude <= -99999 ? null : l.altitude,
    heading: l.heading < 0 || speed === null || speed < 1 ? null : l.heading,
    // build 23+: origine vera (svc = servizio GPS nativo, pi = riserva); prima tutto era 'fused-pi'
    source: l.src === 'svc' ? 'svc' : 'fused-pi',
  };
}

export async function bufferedLocations(): Promise<LocationSample[]> {
  if (!locationBackupAvailable()) return [];
  try {
    return (await ActivityRecognition.getBufferedLocations()).map(toSample).sort((a, b) => a.t - b.t);
  } catch {
    return [];
  }
}

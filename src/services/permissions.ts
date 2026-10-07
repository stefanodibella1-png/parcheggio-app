// Checklist di prontezza e richiesta dei permessi.
import * as Battery from 'expo-battery';
import * as IntentLauncher from 'expo-intent-launcher';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { Linking, PermissionsAndroid, Platform } from 'react-native';
import { ActivityRecognition } from '../../modules/activity-recognition/index.ts';
import { motionAvailable } from '../sensors/motion.ts';

export type Level = 'ok' | 'warn' | 'bad';

export interface CheckItem {
  key: 'locationFg' | 'locationBg' | 'precise' | 'motion' | 'notifications' | 'gps' | 'battery' | 'accelerometer';
  label: string;
  level: Level;
  detail: string;
  /** cosa non verrà misurato se manca */
  impact: string;
  action: (() => Promise<void>) | null;
  actionLabel: string | null;
}

async function openSettings(): Promise<void> {
  await Linking.openSettings();
}

async function requestMotion(): Promise<void> {
  if (Platform.OS === 'android') {
    if (Number(Platform.Version) >= 29) {
      await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACTIVITY_RECOGNITION);
    }
  } else {
    const r = await ActivityRecognition.requestPermission();
    if (r !== 'granted') await openSettings();
  }
}

async function motionStatus(): Promise<{ level: Level; detail: string }> {
  if (!ActivityRecognition.present) return { level: 'bad', detail: 'Modulo non incluso in questa installazione: serve una nuova build' };
  if (!(await ActivityRecognition.isAvailable())) return { level: 'bad', detail: 'Non disponibile su questo telefono' };
  if (Platform.OS === 'android') {
    if (Number(Platform.Version) < 29) return { level: 'ok', detail: 'Concesso' };
    const ok = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.ACTIVITY_RECOGNITION);
    return ok ? { level: 'ok', detail: 'Concesso' } : { level: 'bad', detail: 'Non concesso' };
  }
  const s = await ActivityRecognition.authorizationStatus();
  if (s === 'granted') return { level: 'ok', detail: 'Concesso' };
  if (s === 'undetermined') return { level: 'bad', detail: 'Da concedere' };
  return { level: 'bad', detail: 'Negato: abilitalo in Impostazioni › PARCHEGGIO › Movimento e fitness' };
}

export async function readiness(): Promise<CheckItem[]> {
  const items: CheckItem[] = [];
  const fg = await Location.getForegroundPermissionsAsync();
  const bg = await Location.getBackgroundPermissionsAsync();
  const gpsOn = await Location.hasServicesEnabledAsync().catch(() => false);

  items.push({
    key: 'locationFg',
    label: 'Posizione',
    level: fg.granted ? 'ok' : 'bad',
    detail: fg.granted ? 'Concessa' : 'Non concessa',
    impact: 'Senza posizione il test non può funzionare.',
    action: fg.granted ? null : async () => {
      const r = await Location.requestForegroundPermissionsAsync();
      if (!r.granted && !r.canAskAgain) await openSettings();
    },
    actionLabel: fg.granted ? null : 'Concedi',
  });

  items.push({
    key: 'locationBg',
    label: 'Posizione "Sempre"',
    level: bg.granted ? 'ok' : 'bad',
    detail: bg.granted ? 'Concessa' : 'Solo mentre usi l\'app',
    impact: 'A telefono bloccato il test si ferma.',
    action: bg.granted
      ? null
      : async () => {
          if (!fg.granted) await Location.requestForegroundPermissionsAsync();
          const r = await Location.requestBackgroundPermissionsAsync();
          if (!r.granted) await openSettings();
        },
    actionLabel: bg.granted ? null : Platform.OS === 'android' ? 'Apri e scegli "Consenti sempre"' : 'Concedi "Sempre"',
  });

  if (Platform.OS === 'ios') {
    const precise = (fg as unknown as { ios?: { accuracy?: string } }).ios?.accuracy !== 'reduced';
    items.push({
      key: 'precise',
      label: 'Posizione esatta',
      level: precise ? 'ok' : 'bad',
      detail: precise ? 'Attiva' : 'Approssimativa',
      impact: 'Con la posizione approssimativa il punto del parcheggio è inutilizzabile.',
      action: precise ? null : openSettings,
      actionLabel: precise ? null : 'Apri Impostazioni',
    });
  }

  const m = await motionStatus();
  items.push({
    key: 'motion',
    label: Platform.OS === 'ios' ? 'Movimento e fitness' : 'Attività fisica',
    level: m.level,
    detail: m.detail,
    impact: 'Senza activity recognition auto e camminata si distinguono peggio.',
    action: m.level === 'ok' ? null : requestMotion,
    actionLabel: m.level === 'ok' ? null : 'Concedi',
  });

  const n = await Notifications.getPermissionsAsync();
  items.push({
    key: 'notifications',
    label: 'Notifiche',
    level: n.granted ? 'ok' : 'warn',
    detail: n.granted ? 'Attive' : 'Disattivate',
    impact: 'Non vedrai gli eventi a telefono bloccato (il rilevamento continua).',
    action: n.granted ? null : async () => {
      const r = await Notifications.requestPermissionsAsync();
      if (!r.granted) await openSettings();
    },
    actionLabel: n.granted ? null : 'Attiva',
  });

  items.push({
    key: 'gps',
    label: 'GPS acceso',
    level: gpsOn ? 'ok' : 'bad',
    detail: gpsOn ? 'Acceso' : 'Spento',
    impact: 'Con il GPS spento non arriva nessuna posizione.',
    action: gpsOn
      ? null
      : async () => {
          if (Platform.OS === 'android') await IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.LOCATION_SOURCE_SETTINGS);
          else await openSettings();
        },
    actionLabel: gpsOn ? null : 'Accendi',
  });

  const acc = await motionAvailable();
  items.push({
    key: 'accelerometer',
    label: 'Accelerometro',
    level: acc ? 'ok' : 'warn',
    detail: acc ? 'Disponibile' : 'Non disponibile',
    impact: 'Senza accelerometro non si contano i passi.',
    action: null,
    actionLabel: null,
  });

  if (Platform.OS === 'android') {
    let optimized: boolean | null = null;
    try {
      optimized = await Battery.isBatteryOptimizationEnabledAsync();
    } catch {
      optimized = null;
    }
    items.push({
      key: 'battery',
      label: 'Ottimizzazione batteria',
      level: optimized === false ? 'ok' : 'warn',
      detail:
        optimized === false
          ? 'Senza restrizioni'
          : optimized === true
            ? 'Attiva: imposta PARCHEGGIO su "Senza restrizioni"'
            : 'Da verificare a mano: imposta PARCHEGGIO su "Senza restrizioni"',
      impact: 'Alcuni telefoni (Xiaomi, Samsung, Huawei…) chiudono l\'app in background.',
      action:
        optimized === false
          ? null
          : async () => {
              await IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
            },
      actionLabel: optimized === false ? null : 'Apri impostazioni batteria',
    });
  }
  return items;
}

export function statusMap(items: CheckItem[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of items) out[i.key] = `${i.level}: ${i.detail}`;
  return out;
}

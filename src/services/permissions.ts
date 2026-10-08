// Checklist di prontezza e richiesta dei permessi.
import * as Battery from 'expo-battery';
import * as Device from 'expo-device';
import * as IntentLauncher from 'expo-intent-launcher';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { Linking, PermissionsAndroid, Platform } from 'react-native';
import { ActivityRecognition } from '../../modules/activity-recognition/index.ts';
import { motionAvailable } from '../sensors/motion.ts';
import { kvGet, kvSet } from '../storage/db.ts';

export type Level = 'ok' | 'warn' | 'bad';

export interface CheckItem {
  key:
    | 'locationFg'
    | 'locationBg'
    | 'precise'
    | 'motion'
    | 'notifications'
    | 'gps'
    | 'battery'
    | 'vendorBattery'
    | 'autostart'
    | 'recentsLock'
    | 'power'
    | 'accelerometer';
  label: string;
  level: Level;
  detail: string;
  /** cosa non verrà misurato se manca */
  impact: string;
  action: (() => Promise<void>) | null;
  actionLabel: string | null;
  /** impostazioni che il telefono non permette di leggere: l'utente conferma di averle fatte */
  confirm?: (() => Promise<void>) | null;
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
  if (Platform.OS === 'android') items.push(...(await vendorItems()));

  const power = await powerState();
  items.push({
    key: 'power',
    label: 'Risparmio energetico',
    level: power.lowPower ? 'bad' : 'ok',
    detail: `${power.lowPower ? 'ATTIVO' : 'Spento'}${power.level !== null ? ` · batteria ${power.level}%` : ''}`,
    impact: 'Con il risparmio energetico il telefono blocca GPS e sensori in background: il test si ferma.',
    action:
      power.lowPower && Platform.OS === 'android'
        ? async () => {
            await IntentLauncher.startActivityAsync('android.settings.BATTERY_SAVER_SETTINGS');
          }
        : null,
    actionLabel: power.lowPower && Platform.OS === 'android' ? 'Disattiva risparmio energetico' : null,
  });
  return items;
}

/** Livello batteria e risparmio energetico (null se non leggibile). */
export async function powerState(): Promise<{ level: number | null; lowPower: boolean | null; charging: boolean | null }> {
  try {
    const p = await Battery.getPowerStateAsync();
    return {
      level: p.batteryLevel >= 0 ? Math.round(p.batteryLevel * 100) : null,
      lowPower: p.lowPowerMode,
      charging: p.batteryState === Battery.BatteryState.CHARGING || p.batteryState === Battery.BatteryState.FULL,
    };
  } catch {
    return { level: null, lowPower: null, charging: null };
  }
}

export function statusMap(items: CheckItem[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of items) out[i.key] = `${i.level}: ${i.detail}`;
  return out;
}

// ---- impostazioni dei produttori (Xiaomi, Samsung, Oppo, Huawei…) ------------------------

const PKG = 'com.stefanodibella.parcheggio';
const LABEL = 'PARCHEGGIO';

type Vendor = 'xiaomi' | 'samsung' | 'oppo' | 'vivo' | 'huawei' | 'other';

export function vendor(): Vendor {
  const m = `${Device.manufacturer ?? ''} ${Device.brand ?? ''}`.toLowerCase();
  if (/xiaomi|redmi|poco/.test(m)) return 'xiaomi';
  if (/samsung/.test(m)) return 'samsung';
  if (/oppo|realme|oneplus/.test(m)) return 'oppo';
  if (/vivo|iqoo/.test(m)) return 'vivo';
  if (/huawei|honor/.test(m)) return 'huawei';
  return 'other';
}

/** Prova ad aprire una schermata di sistema; se non esiste su questo telefono passa alla successiva. */
async function openFirst(
  targets: ({ packageName: string; className: string; extra?: Record<string, string> } | 'appDetails')[],
): Promise<void> {
  for (const t of targets) {
    try {
      if (t === 'appDetails') {
        await IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.APPLICATION_DETAILS_SETTINGS, { data: `package:${PKG}` });
      } else {
        await IntentLauncher.startActivityAsync('android.intent.action.MAIN', {
          packageName: t.packageName,
          className: t.className,
          extra: t.extra,
        });
      }
      return;
    } catch {
      // schermata non presente: si prova la prossima
    }
  }
}

async function confirmed(key: string): Promise<boolean> {
  return (await kvGet(`setup:${key}`).catch(() => null)) === '1';
}

function confirmer(key: string): () => Promise<void> {
  return async () => {
    await kvSet(`setup:${key}`, '1').catch(() => {});
  };
}

async function vendorItems(): Promise<CheckItem[]> {
  const v = vendor();
  const out: CheckItem[] = [];
  const impact = 'Senza questa impostazione il telefono sospende PARCHEGGIO in background e il test perde guida e parcheggi.';

  if (v === 'xiaomi') {
    const auto = await confirmed('autostart');
    out.push({
      key: 'autostart',
      label: 'Avvio automatico (Xiaomi)',
      level: auto ? 'ok' : 'warn',
      detail: auto ? 'Confermato' : 'Da attivare: tocca il pulsante e accendi PARCHEGGIO',
      impact,
      action: auto
        ? null
        : () =>
            openFirst([
              { packageName: 'com.miui.securitycenter', className: 'com.miui.permcenter.autostart.AutoStartManagementActivity' },
              'appDetails',
            ]),
      actionLabel: auto ? null : 'Apri avvio automatico',
      confirm: auto ? null : confirmer('autostart'),
    });
    const bat = await confirmed('vendorBattery');
    out.push({
      key: 'vendorBattery',
      label: 'Risparmio batteria Xiaomi',
      level: bat ? 'ok' : 'warn',
      detail: bat ? 'Confermato' : 'Scegli "Nessuna restrizione" per PARCHEGGIO',
      impact,
      action: bat
        ? null
        : () =>
            openFirst([
              {
                packageName: 'com.miui.powerkeeper',
                className: 'com.miui.powerkeeper.ui.HiddenAppsConfigActivity',
                extra: { package_name: PKG, package_label: LABEL },
              },
              'appDetails',
            ]),
      actionLabel: bat ? null : 'Apri risparmio batteria',
      confirm: bat ? null : confirmer('vendorBattery'),
    });
  } else if (v === 'samsung') {
    const ok = await confirmed('vendorBattery');
    out.push({
      key: 'vendorBattery',
      label: 'App mai in sospensione (Samsung)',
      level: ok ? 'ok' : 'warn',
      detail: ok ? 'Confermato' : 'Batteria › Limiti utilizzo in background › App mai in sospensione › aggiungi PARCHEGGIO',
      impact,
      action: ok
        ? null
        : () =>
            openFirst([
              { packageName: 'com.samsung.android.lool', className: 'com.samsung.android.sm.battery.ui.BatteryActivity' },
              'appDetails',
            ]),
      actionLabel: ok ? null : 'Apri batteria',
      confirm: ok ? null : confirmer('vendorBattery'),
    });
  } else if (v === 'oppo' || v === 'vivo' || v === 'huawei') {
    const auto = await confirmed('autostart');
    const targets: Parameters<typeof openFirst>[0] =
      v === 'oppo'
        ? [{ packageName: 'com.coloros.safecenter', className: 'com.coloros.safecenter.permission.startup.StartupAppListActivity' }, 'appDetails']
        : v === 'vivo'
          ? [{ packageName: 'com.vivo.permissionmanager', className: 'com.vivo.permissionmanager.activity.BgStartUpManagerActivity' }, 'appDetails']
          : [{ packageName: 'com.huawei.systemmanager', className: 'com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity' }, 'appDetails'];
    out.push({
      key: 'autostart',
      label: 'Avvio automatico / attività in background',
      level: auto ? 'ok' : 'warn',
      detail: auto ? 'Confermato' : 'Consenti a PARCHEGGIO di avviarsi e restare attiva in background',
      impact,
      action: auto ? null : () => openFirst(targets),
      actionLabel: auto ? null : 'Apri impostazioni',
      confirm: auto ? null : confirmer('autostart'),
    });
  }

  if (v !== 'other' && v !== 'samsung') {
    const lock = await confirmed('recentsLock');
    out.push({
      key: 'recentsLock',
      label: 'Blocca nelle app recenti',
      level: lock ? 'ok' : 'warn',
      detail: lock
        ? 'Confermato'
        : 'Apri le app recenti, tieni premuto su PARCHEGGIO e tocca il lucchetto 🔒',
      impact,
      action: null,
      actionLabel: null,
      confirm: lock ? null : confirmer('recentsLock'),
    });
  }
  return out;
}

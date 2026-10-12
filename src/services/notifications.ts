// Notifiche locali: servono a verificare il comportamento a app chiusa.
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { DetectionEvent, ParkingSession, ReturnInfo } from '../../engine/types.ts';
import { IS_PUBLIC } from '../variant.ts';

let configured = false;

export async function setupNotifications(): Promise<void> {
  if (configured) return;
  configured = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('events', {
      name: 'Eventi del test',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 120],
    });
    await Notifications.setNotificationChannelAsync('state', {
      name: 'Stato del test',
      importance: Notifications.AndroidImportance.LOW,
    });
  }
}

function addr(s: ParkingSession | null | undefined): string {
  const f = s?.spot.address?.formatted;
  return f ? ` vicino a ${f}` : '';
}

function street(s: ParkingSession | null | undefined): string {
  const a = s?.spot.address;
  const f = a?.street ? `${a.street}${a.streetNumber ? ` ${a.streetNumber}` : ''}` : a?.formatted;
  return f ? ` in ${f}` : '';
}

/** "tra ~3 min" / "tra meno di 1 min" */
export function inMinutes(s: number): string {
  if (s < 60) return 'tra meno di 1 min';
  return `tra ~${Math.round(s / 60)} min`;
}

/** Testo della previsione di ritorno (si aggiorna mentre ti avvicini). */
export function returnText(session: ParkingSession | null, ri: ReturnInfo | null): { title: string; body: string } {
  const when = ri && ri.releaseEtaS !== null ? inMinutes(ri.releaseEtaS) : 'a breve';
  const dist = ri ? ` · sei a ${ri.distanceM} m dall'auto` : '';
  return {
    title: "↩️ Stai tornando all'auto",
    body: `Il tuo posto${street(session)} si libererà ${when}${dist}.`,
  };
}

/** Testo della notifica per un evento; null = nessuna notifica. */
export function textFor(
  e: DetectionEvent,
  session: ParkingSession | null,
  ri: ReturnInfo | null = null,
): { title: string; body: string; important: boolean } | null {
  const conf = (x: number) => `confidence ${Math.round(x)}`;
  switch (e.type) {
    case 'POSSIBLE_PARKING':
      return { title: '🅿️ Possibile parcheggio', body: 'Auto ferma nello stesso punto.', important: false };
    case 'PARKED':
      // solo per un parcheggio nuovo, non quando si torna a "parcheggiata" dopo un falso movimento
      if (e.from === 'DEPARTURE_CANDIDATE' || e.from === 'USER_RETURNING' || e.from === 'PARKED_USER_AWAY') return null;
      return { title: '🅿️ Parcheggio confermato', body: `Auto parcheggiata${addr(session)}.`, important: true };
    case 'PARKED_USER_AWAY':
      if (e.from !== 'PARKED') return null; // una volta sola, quando scendi e ti allontani
      return { title: "🚶 Ti stai allontanando dall'auto", body: 'Il parcheggio resta occupato.', important: false };
    case 'RETURN_PREDICTED':
      return { ...returnText(session, ri), important: true };
    case 'USER_RETURNING':
      if (e.from !== 'PARKED_USER_AWAY' && e.from !== 'RETURN_PREDICTED') return null;
      return {
        title: "🚗 Sei di nuovo all'auto",
        body: `Il tuo posto${street(session)} si sta per liberare.`,
        important: true,
      };
    case 'DEPARTURE_CANDIDATE':
      return null; // verifica interna: avvisa solo l'esito (partenza o posto liberato)
    case 'VEHICLE_DEPARTED':
      return { title: '🚗 Ripartenza in veicolo rilevata', body: e.reason, important: false };
    case 'PARKING_RELEASED':
    case 'PARKING_RELEASED_INFERRED':
      return {
        title: `✅ Posto probabilmente liberato${e.type === 'PARKING_RELEASED_INFERRED' ? ' (dedotto)' : ''}`,
        body: `${session?.spot.address?.formatted ?? 'Posizione salvata'} · ${conf(e.scores.release)}`,
        important: true,
      };
    case 'LOW_CONFIDENCE':
      if (e.from !== 'VEHICLE_DEPARTED') return null;
      return { title: '❔ Partenza incerta', body: e.reason, important: false };
    default:
      return null;
  }
}

const RETURN_TYPES = new Set(['RETURN_PREDICTED', 'USER_RETURNING']);

function returnId(testId: string): string {
  return `${testId}-return`;
}

export async function notifyEvent(
  e: DetectionEvent,
  session: ParkingSession | null,
  testId: string,
  ri: ReturnInfo | null = null,
): Promise<void> {
  // ritorno annullato o posto liberato: la previsione non serve più
  if (
    (e.type === 'PARKED_USER_AWAY' && e.from === 'RETURN_PREDICTED') ||
    e.type === 'PARKING_RELEASED' ||
    e.type === 'PARKING_RELEASED_INFERRED' ||
    (e.type === 'LOW_CONFIDENCE' && e.from === 'VEHICLE_DEPARTED')
  ) {
    await Notifications.dismissNotificationAsync(returnId(testId)).catch(() => {});
  }
  let txt = textFor(e, session, ri);
  if (!txt) return;
  // ParkingCT: all'utente solo ciò che gli serve, senza termini tecnici
  if (IS_PUBLIC) {
    // solo quando si scende davvero e ci si allontana a piedi: una sosta seduti in auto
    // (coda, attesa, doppia fila) non è un parcheggio da ricordare
    if (!(e.type === 'PARKED_USER_AWAY' && e.from === 'PARKED')) return;
    txt = { title: '🅿️ Ho ricordato dove hai parcheggiato', body: session?.spot.address?.formatted ?? 'Apri ParkingCT per vedere dove.', important: true };
  }
  const isReturn = RETURN_TYPES.has(e.type);
  try {
    await Notifications.scheduleNotificationAsync({
      // previsione di ritorno: una sola notifica che si aggiorna;
      // le altre di stato si sostituiscono a vicenda; quelle importanti restano
      identifier: isReturn ? returnId(testId) : txt.important ? `${testId}-${e.id}` : `${testId}-state`,
      content: {
        title: txt.title,
        body: txt.body,
        data: { testId, eventId: e.id, deliveredAt: Date.now() },
        ...(Platform.OS === 'android' ? {} : { sound: false }),
      },
      trigger: Platform.OS === 'android' ? { channelId: txt.important ? 'events' : 'state' } : null,
    });
  } catch {
    // permesso negato: il test continua senza notifiche
  }
}

/** Aggiorna in silenzio la notifica di ritorno (distanza e minuti). */
export async function updateReturnNotification(testId: string, session: ParkingSession | null, ri: ReturnInfo | null): Promise<void> {
  // ParkingCT: la previsione di ritorno serve solo alla community, non va mostrata all'utente
  if (IS_PUBLIC) return;
  const txt = returnText(session, ri);
  try {
    await Notifications.scheduleNotificationAsync({
      identifier: returnId(testId),
      content: {
        title: txt.title,
        body: txt.body,
        data: { testId, kind: 'return-update', deliveredAt: Date.now() },
        ...(Platform.OS === 'android' ? {} : { sound: false }),
      },
      // canale silenzioso: l'avviso sonoro c'è già stato
      trigger: Platform.OS === 'android' ? { channelId: 'state' } : null,
    });
  } catch {
    // ignorato
  }
}

/** Avviso a chi cerca: un posto vicino si sta liberando (o si è appena liberato). */
export async function notifyNearbySpot(spot: {
  id: string;
  kind: 'FREED' | 'SOON';
  address: string | null;
  freeAt: number;
  distanceM: number;
}, now: number): Promise<void> {
  const where = spot.address ? `in ${spot.address}` : 'vicino a te';
  const when = spot.kind === 'FREED' ? 'appena liberato' : `si libera ${inMinutes(Math.max(0, (spot.freeAt - now) / 1000))}`;
  try {
    await Notifications.scheduleNotificationAsync({
      identifier: `spot-${spot.id}`,
      content: {
        title: spot.kind === 'FREED' ? '🅿️ Posto libero vicino a te' : '🅿️ Posto che si libera vicino a te',
        body: `Posto ${where}: ${when} · a ${spot.distanceM} m`,
        data: { kind: 'community-spot', spotId: spot.id, deliveredAt: Date.now() },
      },
      trigger: Platform.OS === 'android' ? { channelId: 'events' } : null,
    });
  } catch {
    // ignorato
  }
}

/** Avviso tecnico importante durante il test (es. risparmio energetico). */
export async function notifyWarning(title: string, body: string, id = 'warning'): Promise<void> {
  // ParkingCT: niente avvisi tecnici (parlano di "test" e di PARCHEGGIO);
  // se il telefono mette in pausa l'app, lo dice la schermata principale.
  if (IS_PUBLIC) return;
  try {
    await Notifications.scheduleNotificationAsync({
      identifier: id,
      content: { title, body, data: { kind: 'warning', deliveredAt: Date.now() } },
      trigger: Platform.OS === 'android' ? { channelId: 'events' } : null,
    });
  } catch {
    // ignorato
  }
}

// ---------------------------------------------------------------------------------------
// ParkingCT: promemoria ai Tester per diventare fondatori prima del lancio

const FOUNDER_REMINDER_PREFIX = 'founder-reminder-';

/**
 * Pianifica i promemoria "diventa fondatore" fino al giorno del lancio: uno a settimana
 * e poi a 7, 3 e 1 giorno dal lancio, sempre alle 10:00. Rifà la lista ogni volta (niente doppioni).
 */
export async function scheduleFounderReminders(launchAt: number, now: number): Promise<void> {
  await cancelFounderReminders();
  if (launchAt <= now) return;
  const at10 = (t: number) => {
    const d = new Date(t);
    d.setHours(10, 0, 0, 0);
    return d.getTime();
  };
  const days = Math.floor((launchAt - now) / 86_400_000);
  const when = new Set<number>();
  for (let k = 7; k < days; k += 7) when.add(at10(now + k * 86_400_000));
  for (const before of [7, 3, 1]) when.add(at10(launchAt - before * 86_400_000));
  const date = new Date(launchAt).toLocaleDateString('it-IT', { day: 'numeric', month: 'long' });
  let i = 0;
  for (const t of [...when].sort((a, b) => a - b)) {
    if (t <= now + 3600_000 || t >= launchAt) continue;
    const left = Math.max(1, Math.ceil((launchAt - t) / 86_400_000));
    try {
      await Notifications.scheduleNotificationAsync({
        identifier: `${FOUNDER_REMINDER_PREFIX}${i++}`,
        content: {
          title: left <= 1 ? '⭐ Ultimo giorno per diventare fondatore' : `⭐ Ancora ${left} giorni per diventare fondatore`,
          body: `Fino al ${date} puoi avere ParkingCT gratis per sempre con 3,90 €. Dopo non sarà più possibile.`,
          data: { kind: 'founder-reminder' },
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(t), ...(Platform.OS === 'android' ? { channelId: 'events' } : {}) },
      });
    } catch {
      // permesso negato: nessun promemoria
    }
  }
}

export async function cancelFounderReminders(): Promise<void> {
  try {
    const all = await Notifications.getAllScheduledNotificationsAsync();
    for (const n of all) if (n.identifier.startsWith(FOUNDER_REMINDER_PREFIX)) await Notifications.cancelScheduledNotificationAsync(n.identifier);
  } catch {
    // ignorato
  }
}

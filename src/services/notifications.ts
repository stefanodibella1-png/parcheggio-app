// Notifiche locali: servono a verificare il comportamento a app chiusa.
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { DetectionEvent, ParkingSession, ReturnInfo } from '../../engine/types.ts';

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
      return { title: '🅿️ Parcheggio confermato', body: `Auto parcheggiata${addr(session)}.`, important: true };
    case 'PARKED_USER_AWAY':
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
      return { title: '🚗 Movimento rilevato', body: 'Verifica in corso: auto o a piedi?', important: false };
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
      return { title: '❔ Rilevamento incerto', body: e.reason, important: false };
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
  const txt = textFor(e, session, ri);
  if (!txt) return;
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

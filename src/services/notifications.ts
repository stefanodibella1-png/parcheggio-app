// Notifiche locali: servono a verificare il comportamento a app chiusa.
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { DetectionEvent, ParkingSession } from '../../engine/types.ts';

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

/** Testo della notifica per un evento; null = nessuna notifica. */
export function textFor(e: DetectionEvent, session: ParkingSession | null): { title: string; body: string; important: boolean } | null {
  const conf = (x: number) => `confidence ${Math.round(x)}`;
  switch (e.type) {
    case 'POSSIBLE_PARKING':
      return { title: '🅿️ Possibile parcheggio', body: 'Auto ferma nello stesso punto.', important: false };
    case 'PARKED':
      return { title: '🅿️ Parcheggio confermato', body: `Auto parcheggiata${addr(session)}.`, important: true };
    case 'PARKED_USER_AWAY':
      return { title: "🚶 Ti stai allontanando dall'auto", body: 'Il parcheggio resta occupato.', important: false };
    case 'RETURN_PREDICTED':
      return { title: "↩️ Stai tornando all'auto", body: 'Previsione sperimentale (solo test).', important: false };
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

export async function notifyEvent(e: DetectionEvent, session: ParkingSession | null, testId: string): Promise<void> {
  const txt = textFor(e, session);
  if (!txt) return;
  try {
    await Notifications.scheduleNotificationAsync({
      // le notifiche di stato si sostituiscono a vicenda; quelle importanti restano
      identifier: txt.important ? `${testId}-${e.id}` : `${testId}-state`,
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

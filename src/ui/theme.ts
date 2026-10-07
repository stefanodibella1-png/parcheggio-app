// Tema: un colore per famiglia di stati, uguale in home, mappa, log e notifiche.
import { useColorScheme } from 'react-native';
import type { EngineState, EventType } from '../../engine/types.ts';

export type Family = 'vehicle' | 'parking' | 'walking' | 'released' | 'unknown' | 'error';

export const FAMILY_COLORS: Record<Family, string> = {
  vehicle: '#3B82F6',
  parking: '#F59E0B',
  walking: '#8B5CF6',
  released: '#22C55E',
  unknown: '#8A94A6',
  error: '#EF4444',
};

export function familyOf(s: EngineState | EventType): Family {
  switch (s) {
    case 'IN_VEHICLE':
    case 'VEHICLE_MOVING':
    case 'VEHICLE_DEPARTED':
    case 'DEPARTURE_CANDIDATE':
    case 'PARKING_SEARCH':
      return 'vehicle';
    case 'VEHICLE_STOPPED':
    case 'POSSIBLE_PARKING':
    case 'PARKED':
    case 'USER_RETURNING':
      return 'parking';
    case 'WALKING':
    case 'PARKED_USER_AWAY':
    case 'RETURN_PREDICTED':
      return 'walking';
    case 'PARKING_RELEASED':
    case 'PARKING_RELEASED_INFERRED':
      return 'released';
    case 'ERROR':
      return 'error';
    default:
      return 'unknown';
  }
}

export const STATE_TEXT: Record<EventType, { icon: string; label: string }> = {
  UNKNOWN: { icon: '◌', label: 'In attesa di movimento' },
  WALKING: { icon: '🚶', label: 'A piedi' },
  IN_VEHICLE: { icon: '🚗', label: 'In auto' },
  VEHICLE_MOVING: { icon: '🚗', label: 'In auto' },
  VEHICLE_STOPPED: { icon: '🚗', label: 'Auto ferma' },
  POSSIBLE_PARKING: { icon: '🅿️', label: 'Fermo — possibile parcheggio' },
  PARKED: { icon: '🅿️', label: 'Parcheggiato' },
  PARKED_USER_AWAY: { icon: '🚶', label: "Sei lontano dall'auto" },
  RETURN_PREDICTED: { icon: '↩️', label: "Stai tornando all'auto" },
  USER_RETURNING: { icon: '🅿️', label: "Vicino all'auto" },
  DEPARTURE_CANDIDATE: { icon: '🚗', label: 'Movimento rilevato' },
  VEHICLE_DEPARTED: { icon: '🚗', label: 'Ripartenza in auto' },
  PARKING_RELEASED: { icon: '✅', label: 'Posto probabilmente liberato' },
  PARKING_RELEASED_INFERRED: { icon: '✅', label: 'Posto probabilmente liberato (dedotto)' },
  PARKING_SEARCH: { icon: '🔎', label: 'Probabile ricerca di parcheggio' },
  LOW_CONFIDENCE: { icon: '❔', label: 'Rilevamento incerto' },
  ERROR: { icon: '⚠️', label: 'Errore' },
};

export interface Palette {
  bg: string;
  card: string;
  cardAlt: string;
  text: string;
  textDim: string;
  border: string;
  accent: string;
  warn: string;
  danger: string;
  ok: string;
  isDark: boolean;
}

const dark: Palette = {
  bg: '#0E1116',
  card: '#171B22',
  cardAlt: '#1F242D',
  text: '#F3F5F8',
  textDim: '#9AA3B2',
  border: '#2A303B',
  accent: '#3B82F6',
  warn: '#F59E0B',
  danger: '#EF4444',
  ok: '#22C55E',
  isDark: true,
};

const light: Palette = {
  bg: '#F4F6F9',
  card: '#FFFFFF',
  cardAlt: '#EEF1F5',
  text: '#0E1116',
  textDim: '#5B6575',
  border: '#DCE1E8',
  accent: '#2563EB',
  warn: '#B45309',
  danger: '#DC2626',
  ok: '#15803D',
  isDark: false,
};

export function usePalette(): Palette {
  return useColorScheme() === 'light' ? light : dark;
}

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };
export const radius = { md: 12, lg: 18 };
/** altezza minima dei pulsanti: si usa in auto, con una mano */
export const TOUCH = 56;

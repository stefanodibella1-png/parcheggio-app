// PARCHEGGIO — modelli dati del motore.
// TypeScript puro: nessun import di React Native / Expo.
// Convenzioni: tempi in millisecondi epoch, distanze in metri,
// velocità dei campioni in m/s (come i sensori), velocità mostrate in km/h.

export type Platform = 'ios' | 'android' | 'sim';

export interface LocationSample {
  t: number;
  latitude: number;
  longitude: number;
  /** precisione orizzontale in metri */
  accuracy: number;
  /** m/s; null se il sistema non la fornisce (iOS restituisce -1 → null) */
  speed: number | null;
  altitude?: number | null;
  /** gradi 0–360; null se fermi (< 1 m/s) o non affidabile */
  heading?: number | null;
  source?: string;
}

export type ActivityType =
  | 'IN_VEHICLE'
  | 'ON_BICYCLE'
  | 'WALKING'
  | 'RUNNING'
  | 'STILL'
  | 'UNKNOWN';

export interface ActivitySample {
  t: number;
  activity: ActivityType;
  /** 0–100 */
  confidence: number;
  platform?: Platform | string;
  /** sorgente nativa: 'coremotion', 'gms-updates', 'sim' … */
  source?: string;
}

/** Feature aggregate dell'accelerometro su una finestra (non dati grezzi). */
export interface MotionFeatures {
  t: number;
  windowMs: number;
  accMean: number;
  accVariance: number;
  accPeak: number;
  stepCount: number;
  gyroMean?: number | null;
}

export type EngineInput =
  | { kind: 'location'; sample: LocationSample }
  | { kind: 'activity'; sample: ActivitySample }
  | { kind: 'motion'; sample: MotionFeatures }
  | { kind: 'tick'; t: number }
  | { kind: 'geofence'; t: number; region: string; event: 'enter' | 'exit' };

export type EngineState =
  | 'UNKNOWN'
  | 'IN_VEHICLE'
  | 'VEHICLE_MOVING'
  | 'VEHICLE_STOPPED'
  | 'POSSIBLE_PARKING'
  | 'PARKED'
  | 'PARKED_USER_AWAY'
  | 'RETURN_PREDICTED'
  | 'USER_RETURNING'
  | 'DEPARTURE_CANDIDATE'
  | 'WALKING'
  | 'VEHICLE_DEPARTED'
  | 'PARKING_RELEASED'
  | 'LOW_CONFIDENCE'
  | 'ERROR';

/** PARKING_SEARCH è informativo: non cambia lo stato (sperimentale). */
export type EventType = EngineState | 'PARKING_RELEASED_INFERRED' | 'PARKING_SEARCH';

export interface Scores {
  vehicle: number;
  walking: number;
  parking: number;
  departure: number;
  release: number;
  return: number;
  /** probabile ricerca di parcheggio (sperimentale) */
  search: number;
}

export interface EventData {
  speedKmh: number | null;
  distanceM: number | null;
  gpsAccuracyM: number | null;
  /** il fix usato rispetta GPS_ACCURACY_LIMIT */
  gpsValid: boolean;
  /** età del fix rispetto all'evento, in secondi */
  gpsAgeS: number | null;
  latitude: number | null;
  longitude: number | null;
  activity: ActivityType | null;
  /** motivazioni puntuali (✓ / ✗) */
  checks?: string[];
}

export interface DetectionEvent {
  id: string;
  t: number;
  type: EventType;
  from: EngineState;
  to: EngineState;
  scores: Scores;
  reason: string;
  data: EventData;
  /** timestamp dei campioni di posizione che hanno portato alla decisione */
  sampleRefs: number[];
  parkingId: string | null;
}

export interface GeoPoint {
  latitude: number;
  longitude: number;
  /** precisione stimata del punto (m) */
  accuracyM: number;
  /** numero di fix usati */
  fixes: number;
  /** dispersione dei fix attorno al punto (m) */
  spreadM: number;
}

export type PointQuality = 'A' | 'B' | 'C';

export type GeocodeStatus = 'OK' | 'PENDING' | 'NO_NETWORK' | 'NOT_AVAILABLE' | 'ERROR';

export interface SpotAddress {
  street: string | null;
  streetNumber: string | null;
  postalCode: string | null;
  district: string | null;
  city: string | null;
  province: string | null;
  formatted: string | null;
}

export interface ParkingSpot {
  pointAtPark: GeoPoint | null;
  pointAtDeparture: GeoPoint | null;
  pointFinal: GeoPoint;
  pointQuality: PointQuality;
  /** distanza tra i due punti quando discordano (> 30 m) */
  pointsDisagreeM: number | null;
  arrivalHeading: number | null;
  departureHeading: number | null;
  address: SpotAddress | null;
  addressSource: string | null;
  addressDistanceM: number | null;
  geocodedAt: number | null;
  geocodeStatus: GeocodeStatus;
  recurringSpot: boolean;
}

export type SessionOutcome =
  | 'OPEN'
  | 'RELEASED'
  | 'RELEASED_INFERRED'
  | 'ABANDONED'
  | 'LOW_CONFIDENCE';

export interface ParkingSession {
  parkingId: string;
  /** inizio della sosta (per il flusso E: inizio della fase ferma osservata) */
  startT: number;
  parkedT: number | null;
  endT: number | null;
  durationS: number | null;
  outcome: SessionOutcome;
  inferred: boolean;
  spot: ParkingSpot;
  releaseConfidence: number | null;
  /** ricavato a posteriori dalla traccia (sezione 11) */
  realDepartureT: number | null;
  /** l'utente è sceso e si è allontanato a piedi (esclude code e attese in auto) */
  exitedOnFoot?: boolean;
  /** ricerca del posto prima della sosta (sperimentale) */
  searchStartT?: number | null;
  searchDurationS?: number | null;
  searchDistanceM?: number | null;
}

export interface ReturnInfo {
  distanceM: number;
  approachSpeedMs: number | null;
  etaS: number | null;
  headingToCarDeg: number | null;
  sinceParkS: number;
  /** stima di quando il posto sarà libero: arrivo all'auto + tempo per partire (s) */
  releaseEtaS: number | null;
}

export interface EngineSnapshot {
  t: number;
  state: EngineState;
  stateSinceT: number;
  scores: Scores;
  speedKmh: number | null;
  gpsAccuracyM: number | null;
  lastFixAgeS: number | null;
  distanceFromParkingM: number | null;
  activity: ActivityType | null;
  activityConfidence: number | null;
  lastReason: string | null;
  parkingId: string | null;
  returnInfo: ReturnInfo | null;
  /** inizio della probabile ricerca di parcheggio in corso */
  searchingSinceT: number | null;
}

export type ReviewVerdict = 'CORRECT' | 'FALSE_POSITIVE' | 'MISSED';

/** Etichette del tester, inserite a posteriori. MAI lette dal motore. */
export interface ReviewLabel {
  id: string;
  testId: string;
  /** id dell'evento o della sessione; null per un evento mancato aggiunto a mano */
  targetId: string | null;
  kind: 'RELEASE' | 'PARKING' | 'DEPARTURE';
  verdict: ReviewVerdict;
  t: number;
  latitude?: number;
  longitude?: number;
  createdAt: number;
}

export interface QualityWarning {
  code: string;
  severity: 'info' | 'warning';
  message: string;
}

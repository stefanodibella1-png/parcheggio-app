// PARCHEGGIO — tutti i parametri del rilevamento.
// Valori INIZIALI da tarare con i test reali (tools/sweep.ts). Nessuna soglia
// deve essere scritta altrove nel codice.

export interface DetectionConfig {
  // --- GPS ---
  /** fix con precisione peggiore di questo valore (m) vengono scartati */
  GPS_ACCURACY_LIMIT: number;
  /** oltre questo intervallo (s) tra due fix non si deriva la velocità */
  DERIVED_SPEED_MAX_GAP_S: number;
  /** sotto questa velocità (m/s) l'heading è considerato non affidabile */
  HEADING_MIN_SPEED_MS: number;

  // --- velocità (km/h) ---
  MAX_PARKING_SPEED: number;
  WALKING_SPEED_MAX: number;
  VEHICLE_SPEED_MIN: number;
  /** velocità che fa ripartire un veicolo fermo (km/h) */
  RESUME_SPEED: number;

  // --- activity recognition ---
  /** per quanto (s) un'activity valida resta "attuale" se arrivano solo UNKNOWN */
  ACTIVITY_HOLD_S: number;
  /** confidence minima perché un'activity nativa conti */
  ACTIVITY_MIN_CONFIDENCE: number;
  /** confidence IN_VEHICLE che abilita la conferma rapida */
  ACTIVITY_FAST_CONFIDENCE: number;

  // --- finestre e conferme (s) ---
  VEHICLE_WINDOW_S: number;
  VEHICLE_CONFIRM_S: number;
  /** conferma rapida: IN_VEHICLE forte + velocità sostenuta da almeno N s */
  VEHICLE_FAST_CONFIRM_S: number;
  WALKING_CONFIRM_S: number;
  STOP_CONFIRM_S: number;
  RESUME_CONFIRM_S: number;
  /** da WALKING torna a UNKNOWN se fermo per N s */
  STILL_RESET_S: number;
  /** sosta minima per passare a POSSIBLE_PARKING */
  POSSIBLE_PARKING_MIN_STOP_S: number;
  MIN_PARKING_DURATION_S: number;
  /** soste più brevi sono "semaforo/coda" */
  SHORT_STOP_MAX_S: number;
  DEPARTURE_CANDIDATE_TIMEOUT_S: number;

  // --- distanze (m) ---
  /** spostamento dal punto di sosta che indica ripartenza */
  RESUME_DISTANCE: number;
  DEPARTURE_START_RADIUS: number;
  MIN_DEPARTURE_DISTANCE: number;
  RETURN_RADIUS: number;
  /** distanza a piedi oltre la quale l'utente è "lontano dall'auto" */
  AWAY_DISTANCE: number;
  /** oltre questa distanza, fermi e senza veicolo per AWAY_STILL_S, si è "lontani dall'auto" anche senza camminata riconosciuta */
  AWAY_FAR_DISTANCE: number;
  AWAY_STILL_S: number;
  /** distanza percorsa senza conferma oltre la quale si chiude come LOW_CONFIDENCE */
  RELEASE_GIVE_UP_DISTANCE: number;

  // --- confidence (0–100) ---
  MIN_VEHICLE_CONFIDENCE: number;
  MIN_WALKING_CONFIDENCE: number;
  MIN_RELEASE_CONFIDENCE: number;
  MIN_INFERRED_RELEASE_CONFIDENCE: number;

  // --- flusso E (cold start) ---
  COLD_START_MIN_STILL_S: number;
  /** la camminata deve essere avvenuta entro N s prima della fase ferma */
  COLD_START_WALK_LOOKBACK_S: number;

  // --- punto del parcheggio ---
  SPOT_MIN_FIXES: number;
  SPOT_GOOD_ACCURACY: number;
  SPOT_FAIR_ACCURACY: number;
  /** se i punti all'arrivo e alla partenza distano più di così, non si fondono */
  SPOT_MERGE_MAX_M: number;
  RECURRING_SPOT_RADIUS: number;
  RECURRING_SPOT_MIN_SESSIONS: number;
  GEOCODE_MAX_RETRIES: number;

  // --- previsione di ritorno (11-bis) ---
  RETURN_MIN_APPROACH_TIME_S: number;
  RETURN_MIN_APPROACH_M: number;
  RETURN_MIN_CONFIDENCE: number;
  RETURN_CANCEL_S: number;
  RETURN_GEOFENCE_RADII: number[];

  // --- pesi degli score ---
  W_VEHICLE: { speed: number; activity: number; motion: number };
  W_WALKING: { speed: number; activity: number; steps: number };
  W_RELEASE: {
    parkedLongEnough: number;
    startNearSpot: number;
    vehicleScore: number;
    distance: number;
    maxSpeed: number;
    spotQuality: number;
  };
  W_INFERRED: {
    priorWalk: number;
    stillPhase: number;
    vehicleActivity: number;
    vehicleScore: number;
    startNearSpot: number;
    distance: number;
  };

  // --- export ---
  SNAPSHOT_EVERY_S: number;
}

export const DEFAULT_CONFIG: DetectionConfig = {
  GPS_ACCURACY_LIMIT: 30,
  DERIVED_SPEED_MAX_GAP_S: 10,
  HEADING_MIN_SPEED_MS: 1,

  MAX_PARKING_SPEED: 2,
  WALKING_SPEED_MAX: 7,
  VEHICLE_SPEED_MIN: 15,
  RESUME_SPEED: 10,

  ACTIVITY_HOLD_S: 30,
  ACTIVITY_MIN_CONFIDENCE: 50,
  ACTIVITY_FAST_CONFIDENCE: 85,

  VEHICLE_WINDOW_S: 10,
  VEHICLE_CONFIRM_S: 10,
  VEHICLE_FAST_CONFIRM_S: 5,
  WALKING_CONFIRM_S: 8,
  STOP_CONFIRM_S: 5,
  RESUME_CONFIRM_S: 3,
  STILL_RESET_S: 45,
  POSSIBLE_PARKING_MIN_STOP_S: 45,
  MIN_PARKING_DURATION_S: 120,
  SHORT_STOP_MAX_S: 90,
  DEPARTURE_CANDIDATE_TIMEOUT_S: 120,

  RESUME_DISTANCE: 25,
  DEPARTURE_START_RADIUS: 40,
  MIN_DEPARTURE_DISTANCE: 60,
  RETURN_RADIUS: 30,
  AWAY_DISTANCE: 30,
  AWAY_FAR_DISTANCE: 50,
  AWAY_STILL_S: 30,
  RELEASE_GIVE_UP_DISTANCE: 300,

  MIN_VEHICLE_CONFIDENCE: 70,
  MIN_WALKING_CONFIDENCE: 70,
  MIN_RELEASE_CONFIDENCE: 85,
  MIN_INFERRED_RELEASE_CONFIDENCE: 75,

  COLD_START_MIN_STILL_S: 15,
  COLD_START_WALK_LOOKBACK_S: 600,

  SPOT_MIN_FIXES: 5,
  SPOT_GOOD_ACCURACY: 10,
  SPOT_FAIR_ACCURACY: 25,
  SPOT_MERGE_MAX_M: 30,
  RECURRING_SPOT_RADIUS: 30,
  RECURRING_SPOT_MIN_SESSIONS: 3,
  GEOCODE_MAX_RETRIES: 5,

  RETURN_MIN_APPROACH_TIME_S: 60,
  RETURN_MIN_APPROACH_M: 30,
  RETURN_MIN_CONFIDENCE: 70,
  RETURN_CANCEL_S: 60,
  RETURN_GEOFENCE_RADII: [500, 200, 50],

  W_VEHICLE: { speed: 0.5, activity: 0.35, motion: 0.15 },
  W_WALKING: { speed: 0.3, activity: 0.45, steps: 0.25 },
  W_RELEASE: {
    parkedLongEnough: 15,
    startNearSpot: 20,
    vehicleScore: 30,
    distance: 15,
    maxSpeed: 10,
    spotQuality: 10,
  },
  W_INFERRED: {
    priorWalk: 20,
    stillPhase: 20,
    vehicleActivity: 15,
    vehicleScore: 25,
    startNearSpot: 10,
    distance: 10,
  },

  SNAPSHOT_EVERY_S: 5,
};

/** Unisce override parziali (schermata Debug, sweep) con i default. */
export function makeConfig(overrides: Partial<DetectionConfig> = {}): DetectionConfig {
  return { ...DEFAULT_CONFIG, ...overrides };
}

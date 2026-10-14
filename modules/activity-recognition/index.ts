// API JavaScript del modulo nativo di riconoscimento attività.
// Se il modulo nativo non è presente (es. Expo Go) tutto risulta "non disponibile",
// senza simulare dati.

import { requireOptionalNativeModule } from 'expo-modules-core';

export type NativeActivity = {
  t: number;
  activity: 'IN_VEHICLE' | 'ON_BICYCLE' | 'WALKING' | 'RUNNING' | 'STILL' | 'UNKNOWN';
  confidence: number;
  platform: string;
  source: string;
};

type Subscription = { remove(): void };

type NativeModuleShape = {
  isAvailable(): Promise<boolean>;
  authorizationStatus(): Promise<'granted' | 'denied' | 'restricted' | 'undetermined'>;
  requestPermission(): Promise<'granted' | 'denied'>;
  start(intervalMs: number): void;
  stop(): void;
  queryHistory(fromMs: number, toMs: number): Promise<NativeActivity[]>;
  getBuffered(): Promise<NativeActivity[]>;
  addListener(event: 'onActivity', cb: (a: NativeActivity) => void): Subscription;
  // solo Android
  startLocation?(intervalMs: number): void;
  stopLocation?(): void;
  getBufferedLocations?(): Promise<NativeLocation[]>;
  startLocationService?(intervalMs: number, title: string, text: string): void;
  stopLocationService?(): void;
  setLocationInterval?(intervalMs: number): boolean;
  locationServiceRunning?(): boolean;
  getServiceLog?(): Promise<ServiceLogEntry[]>;
};

/** Android: avvii, morti e riavvii del servizio GPS (registro nativo su file). */
export type ServiceLogEntry = { t: number; event: string; detail: string; build: string };

export type NativeLocation = {
  t: number;
  latitude: number;
  longitude: number;
  accuracy: number;
  speed: number; // -1 = sconosciuta
  heading: number; // -1 = sconosciuta
  altitude: number; // -99999 = sconosciuta
};

const Native = requireOptionalNativeModule<NativeModuleShape>('ActivityRecognition');

export const ActivityRecognition = {
  present: Native !== null,
  async isAvailable(): Promise<boolean> {
    return Native ? Native.isAvailable() : false;
  },
  async authorizationStatus(): Promise<string> {
    return Native ? Native.authorizationStatus() : 'unavailable';
  },
  async requestPermission(): Promise<string> {
    return Native ? Native.requestPermission() : 'unavailable';
  },
  start(intervalMs: number): void {
    Native?.start(intervalMs);
  },
  stop(): void {
    Native?.stop();
  },
  async queryHistory(fromMs: number, toMs: number): Promise<NativeActivity[]> {
    return Native ? Native.queryHistory(fromMs, toMs) : [];
  },
  async getBuffered(): Promise<NativeActivity[]> {
    return Native ? Native.getBuffered() : [];
  },
  /** Android: posizioni di riserva via PendingIntent (sopravvivono al congelamento dell'app). */
  locationBackupPresent: typeof Native?.startLocation === 'function',
  startLocation(intervalMs: number): void {
    if (typeof Native?.startLocation === 'function') Native.startLocation(intervalMs);
  },
  stopLocation(): void {
    if (typeof Native?.stopLocation === 'function') Native.stopLocation();
  },
  /** Android: GPS nel servizio in primo piano nativo */
  locationServicePresent: typeof Native?.startLocationService === 'function',
  startLocationService(intervalMs: number, title: string, text: string): void {
    if (typeof Native?.startLocationService === 'function') Native.startLocationService(intervalMs, title, text);
  },
  setLocationInterval(intervalMs: number): boolean {
    return typeof Native?.setLocationInterval === 'function' ? Native.setLocationInterval(intervalMs) : false;
  },
  stopLocationService(): void {
    if (typeof Native?.stopLocationService === 'function') Native.stopLocationService();
  },
  locationServiceRunning(): boolean {
    return typeof Native?.locationServiceRunning === 'function' ? Native.locationServiceRunning() : false;
  },
  async getBufferedLocations(): Promise<NativeLocation[]> {
    return typeof Native?.getBufferedLocations === 'function' ? Native.getBufferedLocations() : [];
  },
  async getServiceLog(): Promise<ServiceLogEntry[]> {
    return typeof Native?.getServiceLog === 'function' ? Native.getServiceLog() : [];
  },
  addListener(cb: (a: NativeActivity) => void): Subscription {
    return Native ? Native.addListener('onActivity', cb) : { remove() {} };
  },
};

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
  addListener(cb: (a: NativeActivity) => void): Subscription {
    return Native ? Native.addListener('onActivity', cb) : { remove() {} };
  },
};

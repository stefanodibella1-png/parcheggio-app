import * as Application from 'expo-application';
import * as Device from 'expo-device';
import * as Updates from 'expo-updates';
import { Platform } from 'react-native';

export function deviceInfo() {
  return {
    appVersion: Application.nativeApplicationVersion ?? null,
    buildNumber: Application.nativeBuildVersion ?? null,
    updateId: Updates.updateId ?? null,
    runtimeVersion: Updates.runtimeVersion ?? null,
    platform: Platform.OS,
    deviceModel: Device.modelName ?? null,
    osVersion: `${Device.osName ?? Platform.OS} ${Device.osVersion ?? Platform.Version}`,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'unknown',
  };
}

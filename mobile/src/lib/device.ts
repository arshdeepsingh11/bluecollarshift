import * as Location from 'expo-location';
import * as Crypto from 'expo-crypto';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { cacheGet, cacheSet } from './db';
import { api } from './api';

/** Stable, random per-install device id (not a hardware identifier). */
export async function deviceId(): Promise<string> {
  const c = await cacheGet<string>('device_id');
  if (c) return c.value;
  const id = `${Platform.OS}-${Crypto.randomUUID()}`;
  await cacheSet('device_id', id);
  return id;
}

export const uuid = () => Crypto.randomUUID();

/**
 * One-shot location for a clock event. Foreground only; never tracks continuously.
 * Returns null if permission is denied or GPS does not answer in time — the event is still saved.
 */
export async function currentLocation(): Promise<{ lat: number; lng: number; accuracyM: number | null } | null> {
  try {
    const perm = await Location.getForegroundPermissionsAsync();
    let granted = perm.granted;
    if (!granted && perm.canAskAgain) granted = (await Location.requestForegroundPermissionsAsync()).granted;
    if (!granted) return null;
    const pos = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
      new Promise<null>((r) => setTimeout(() => r(null), 10_000)),
    ]);
    if (!pos) {
      const last = await Location.getLastKnownPositionAsync({ maxAge: 120_000 });
      return last ? { lat: last.coords.latitude, lng: last.coords.longitude, accuracyM: last.coords.accuracy ?? null } : null;
    }
    return { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracyM: pos.coords.accuracy ?? null };
  } catch {
    return null;
  }
}

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: true }),
});

/** Register for push (Expo → APNs/FCM). Safe to call repeatedly. */
export async function registerPush(): Promise<boolean> {
  if (!Device.isDevice) return false;
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', { name: 'Blue Collar', importance: Notifications.AndroidImportance.HIGH, lightColor: '#016B93' });
  }
  let { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
  if (status !== 'granted') return false;
  const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId;
  const token = (await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined)).data;
  await api('/devices', { method: 'POST', body: { token, platform: Platform.OS === 'ios' ? 'ios' : 'android' } });
  await cacheSet('push_token', token);
  return true;
}

export async function unregisterPush() {
  const t = await cacheGet<string>('push_token');
  if (t) await api('/devices', { method: 'DELETE', body: { token: t.value } }).catch(() => undefined);
}

export const appVersion = Constants.expoConfig?.version ?? '1.0.0';

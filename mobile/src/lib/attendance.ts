import NetInfo from '@react-native-community/netinfo';
import * as TaskManager from 'expo-task-manager';
import * as BackgroundTask from 'expo-background-task';
import { SyncEngine } from './sync/engine';
import { sqliteEventStore } from './db';
import { syncTransport } from './api';
import { uuid } from './device';

/** Single engine for the app. */
export const engine = new SyncEngine(sqliteEventStore, syncTransport, { uuid });

let online = true;
export const isOnline = () => online;

/** Sync whenever connectivity returns, plus a periodic background task (OS decides timing, ≥15 min). */
export function startSyncTriggers() {
  const unsub = NetInfo.addEventListener((s) => {
    const now = !!(s.isConnected && s.isInternetReachable !== false);
    if (now && !online) void engine.retryNow();
    online = now;
  });
  void NetInfo.fetch().then((s) => {
    online = !!(s.isConnected && s.isInternetReachable !== false);
  });
  const timer = setInterval(() => online && void engine.sync(), 60_000);
  return () => {
    unsub();
    clearInterval(timer);
  };
}

const TASK = 'bluecollar-attendance-sync';
TaskManager.defineTask(TASK, async () => {
  try {
    await engine.sync();
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

export async function registerBackgroundSync() {
  try {
    const registered = await TaskManager.isTaskRegisteredAsync(TASK);
    if (!registered) await BackgroundTask.registerTaskAsync(TASK, { minimumInterval: 15 });
  } catch {
    /* Background tasks unavailable (e.g. Expo Go) — foreground + reconnect sync still work. */
  }
}

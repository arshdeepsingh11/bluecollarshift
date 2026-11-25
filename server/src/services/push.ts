import type { Config } from '../config';

export interface PushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

export interface PushResult {
  token: string;
  ok: boolean;
  /** Token is permanently invalid (device unregistered) and should be disabled. */
  invalidToken: boolean;
}

export interface PushSender {
  send(messages: PushMessage[]): Promise<PushResult[]>;
  readonly enabled: boolean;
}

/**
 * Expo Push Service (free) forwards to Apple APNs and Google FCM. No third-party paid provider.
 * Lock-screen text never contains message content or pay amounts — only a short generic summary.
 */
export function createPushSender(config: Config): PushSender {
  return {
    enabled: config.NODE_ENV !== 'test',
    async send(messages) {
      if (messages.length === 0) return [];
      const results: PushResult[] = [];
      for (let i = 0; i < messages.length; i += 100) {
        const chunk = messages.slice(i, i + 100);
        const res = await fetch('https://exp.host/--/api/v2/push/send', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            ...(config.EXPO_ACCESS_TOKEN ? { Authorization: `Bearer ${config.EXPO_ACCESS_TOKEN}` } : {}),
          },
          body: JSON.stringify(chunk.map((m) => ({ to: m.to, title: m.title, body: m.body, data: m.data ?? {}, sound: 'default', priority: 'high' }))),
          signal: AbortSignal.timeout(15_000),
        });
        if (!res.ok) {
          results.push(...chunk.map((m) => ({ token: m.to, ok: false, invalidToken: false })));
          continue;
        }
        const body = (await res.json()) as { data?: { status: string; details?: { error?: string } }[] };
        chunk.forEach((m, idx) => {
          const t = body.data?.[idx];
          results.push({ token: m.to, ok: t?.status === 'ok', invalidToken: t?.details?.error === 'DeviceNotRegistered' });
        });
      }
      return results;
    },
  };
}

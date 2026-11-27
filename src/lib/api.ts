import { supabase } from './supabaseClient';

export const API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? 'http://localhost:8080';

export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function token(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

type Body = Record<string, unknown> | unknown[] | undefined;

/**
 * Typed fetch wrapper for /api/v1. Adds the Supabase access token, a request id, a timeout,
 * and turns API errors into ApiError. GET requests are de-duplicated while in flight.
 */
const inflight = new Map<string, Promise<unknown>>();

export async function api<T = unknown>(path: string, opts: { method?: string; body?: Body; signal?: AbortSignal; raw?: boolean } = {}): Promise<T> {
  const method = opts.method ?? 'GET';
  const key = method === 'GET' ? path : '';
  if (key && inflight.has(key)) return inflight.get(key) as Promise<T>;
  const run = (async () => {
    const tk = await token();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20_000);
    opts.signal?.addEventListener('abort', () => ctrl.abort());
    let res: Response;
    try {
      res = await fetch(`${API_URL}/api/v1${path}`, {
        method,
        headers: {
          ...(tk ? { Authorization: `Bearer ${tk}` } : {}),
          ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          'X-Request-Id': crypto.randomUUID(),
        },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: ctrl.signal,
      });
    } catch {
      throw new ApiError(0, 'network', 'Can’t reach Blue Collar. Check your connection.');
    } finally {
      clearTimeout(timer);
    }
    if (opts.raw) {
      if (!res.ok) {
        const e = ((await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } }).error;
        throw new ApiError(res.status, e?.code ?? 'error', e?.message ?? 'Download failed');
      }
      return res as unknown as T;
    }
    if (res.status === 204) return undefined as T;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const e = (data as { error?: { code?: string; message?: string; details?: unknown } }).error;
      if (res.status === 401) await supabase.auth.refreshSession().catch(() => undefined);
      throw new ApiError(res.status, e?.code ?? 'error', e?.message ?? 'Something went wrong', e?.details);
    }
    return data as T;
  })();
  if (key) {
    inflight.set(key, run);
    run.finally(() => inflight.delete(key)).catch(() => undefined);
  }
  return run;
}

export const get = <T>(path: string, signal?: AbortSignal) => api<T>(path, { signal });
export const post = <T>(path: string, body?: Body) => api<T>(path, { method: 'POST', body: body ?? {} });
export const patch = <T>(path: string, body: Body) => api<T>(path, { method: 'PATCH', body });
export const put = <T>(path: string, body: Body) => api<T>(path, { method: 'PUT', body });

export async function download(path: string, filename: string) {
  const res = await api<Response>(path, { raw: true });
  // Use the server's file name when it sets one (e.g. ADP needs PRxxxEPI.csv).
  const named = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1];
  if (named) filename = named;
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === 'validation_failed' && Array.isArray(e.details)) {
      return `${e.message} ${(e.details as { path: string; message: string }[]).map((d) => `${d.path ? d.path + ': ' : ''}${d.message}`).join('; ')}`;
    }
    if (Array.isArray(e.details) && e.details.length && (e.details[0] as { message?: string }).message) {
      return `${e.message} ${(e.details as { message: string }[]).map((d) => d.message).join(' ')}`;
    }
    return e.message;
  }
  return 'Something went wrong. Please try again.';
}

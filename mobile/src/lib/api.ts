import type { SyncBatchResponse } from '@bluecollar/shared';
import { API_URL } from './config';
import { supabase } from './supabase';
import { AuthError, NetworkError, RejectedError, type Transport } from './sync/engine';

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

async function token() {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

export async function api<T>(path: string, init: { method?: string; body?: unknown; timeoutMs?: number } = {}): Promise<T> {
  const tk = await token();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), init.timeoutMs ?? 15_000);
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api/v1${path}`, {
      method: init.method ?? 'GET',
      headers: { ...(tk ? { Authorization: `Bearer ${tk}` } : {}), ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: ctrl.signal,
    });
  } catch {
    throw new ApiError(0, 'network', 'No connection');
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
  if (!res.ok) throw new ApiError(res.status, data.error?.code ?? 'error', data.error?.message ?? 'Something went wrong');
  return data as T;
}

/** Transport used by the offline sync engine. */
export const syncTransport: Transport = {
  async sendBatch(companyId, events) {
    try {
      return await api<SyncBatchResponse>(`/companies/${companyId}/sync/events`, { method: 'POST', body: { events }, timeoutMs: 20_000 });
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.status === 0 || e.status >= 500) throw new NetworkError(e.message);
        if (e.status === 401) throw new AuthError(e.message);
        throw new RejectedError(e.message, e.status);
      }
      throw new NetworkError('Network error');
    }
  },
};

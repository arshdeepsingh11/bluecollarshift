import type { Config } from '../config';

/**
 * Private file storage (Supabase Storage, bucket "uploads").
 *
 * Browsers and phones never get storage credentials. The API issues short-lived signed URLs:
 *  - upload:   PUT the file to the URL (valid 2 hours, one object path)
 *  - download: GET the URL (valid 10 minutes)
 * The service-role key stays on the server (Rules.md, Rule 1).
 */
export interface Storage {
  enabled: boolean;
  signedUpload(path: string): Promise<string | null>;
  signedDownload(path: string, seconds?: number): Promise<string | null>;
}

const BUCKET = 'uploads';

export function createStorage(config: Config, log: { error: (o: object, m: string) => void }): Storage {
  const key = config.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    return { enabled: false, signedUpload: async () => null, signedDownload: async () => null };
  }
  const base = `${config.SUPABASE_URL.replace(/\/$/, '')}/storage/v1`;
  const headers = { Authorization: `Bearer ${key}`, apikey: key, 'Content-Type': 'application/json' };
  const enc = (p: string) => p.split('/').map(encodeURIComponent).join('/');

  return {
    enabled: true,
    async signedUpload(path) {
      const res = await fetch(`${base}/object/upload/sign/${BUCKET}/${enc(path)}`, {
        method: 'POST', headers, body: '{}', signal: AbortSignal.timeout(8000),
      }).catch((err) => {
        log.error({ err: (err as Error).message }, 'storage sign upload failed');
        return null;
      });
      if (!res || !res.ok) {
        if (res) log.error({ status: res.status }, 'storage sign upload rejected');
        return null;
      }
      const body = (await res.json()) as { url?: string };
      return body.url ? `${base}${body.url}` : null;
    },
    async signedDownload(path, seconds = 600) {
      const res = await fetch(`${base}/object/sign/${BUCKET}/${enc(path)}`, {
        method: 'POST', headers, body: JSON.stringify({ expiresIn: seconds }), signal: AbortSignal.timeout(8000),
      }).catch(() => null);
      if (!res || !res.ok) return null;
      const body = (await res.json()) as { signedURL?: string };
      return body.signedURL ? `${base}${body.signedURL}` : null;
    },
  };
}

/** File extension for a content type (paths never use client-supplied names). */
export function extFor(contentType: string): string {
  const map: Record<string, string> = {
    'audio/mp4': 'm4a', 'audio/m4a': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac', 'audio/mpeg': 'mp3',
    'audio/webm': 'webm', 'audio/ogg': 'ogg', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
  };
  return map[contentType] ?? 'bin';
}

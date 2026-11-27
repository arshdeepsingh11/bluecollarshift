import type { UploadTarget } from '@bluecollar/shared';

/** Upload a local file (voice note or photo) to a short-lived signed URL from the API. */
export async function uploadFile(target: UploadTarget, uri: string): Promise<boolean> {
  try {
    const blob = await (await fetch(uri)).blob();
    const res = await fetch(target.url, { method: 'PUT', headers: { 'Content-Type': target.contentType, 'x-upsert': 'false' }, body: blob });
    return res.ok;
  } catch {
    return false;
  }
}

export async function fileSize(uri: string): Promise<number> {
  try {
    return (await (await fetch(uri)).blob()).size;
  } catch {
    return 0;
  }
}

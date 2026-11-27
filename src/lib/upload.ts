import type { UploadTarget } from '@bluecollar/shared';

/** PUT a file to a short-lived signed URL issued by the API (no storage keys in the browser). */
export async function uploadTo(target: UploadTarget, file: Blob): Promise<boolean> {
  try {
    const res = await fetch(target.url, { method: 'PUT', headers: { 'Content-Type': target.contentType, 'x-upsert': 'false' }, body: file });
    return res.ok;
  } catch {
    return false;
  }
}

/** Shrink a photo to max 1600 px JPEG (~200–400 KB) before upload. */
export async function compressImage(file: File, max = 1600, quality = 0.75): Promise<Blob> {
  if (!file.type.startsWith('image/')) return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', quality));
    return blob && blob.size < file.size ? blob : file;
  } catch {
    return file;
  }
}

import { z } from 'zod';
import { createHash, randomBytes } from 'node:crypto';
import type { FastifyRequest } from 'fastify';

export const companyParams = z.object({ companyId: z.string().uuid() });
export const companyIdParams = <K extends string>(key: K) =>
  z.object({ companyId: z.string().uuid() }).extend({ [key]: z.string().uuid() } as Record<K, z.ZodString>);

export const idParam = z.object({ id: z.string().uuid() });

export function newToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: sha256(token) };
}

export function sha256(v: string) {
  return createHash('sha256').update(v).digest('hex');
}

export function ctx(req: FastifyRequest) {
  return { ip: req.ip, requestId: req.id };
}

/** Keyset pagination cursor: "<iso timestamp>|<uuid>" base64url-encoded. */
export function encodeCursor(at: string, id: string) {
  return Buffer.from(`${at}|${id}`).toString('base64url');
}
export function decodeCursor(c: string | undefined): { at: string; id: string } | null {
  if (!c) return null;
  try {
    const [at, id] = Buffer.from(c, 'base64url').toString('utf8').split('|');
    if (!at || !id || Number.isNaN(Date.parse(at)) || !/^[0-9a-f-]{36}$/i.test(id)) return null;
    return { at, id };
  } catch {
    return null;
  }
}

export function minutesToHours(m: number) {
  return Math.round((m / 60) * 100) / 100;
}

/** Escape a CSV cell, and neutralise spreadsheet formula injection (=, +, -, @). */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: unknown[][]) {
  return [header.map(csvCell).join(','), ...rows.map((r) => r.map(csvCell).join(','))].join('\r\n') + '\r\n';
}

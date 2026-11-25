import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import type { Config } from './config';
import { unauthorized } from './lib/errors';

export interface AuthClaims {
  userId: string;
  email: string;
  /** Authenticator assurance level: 'aal2' after MFA. */
  aal: 'aal1' | 'aal2';
  sessionId: string | null;
  issuedAt: number; // seconds
  expiresAt: number; // seconds
}

export type TokenVerifier = (token: string) => Promise<AuthClaims>;

/**
 * Verifies Supabase access tokens. Supports asymmetric signing keys (JWKS, recommended) and the
 * legacy shared HS256 secret. Issuer, audience and expiry are always checked.
 */
export function createVerifier(config: Config): TokenVerifier {
  const issuer = `${config.SUPABASE_URL.replace(/\/$/, '')}/auth/v1`;
  const jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`), {
    cooldownDuration: 30_000,
    cacheMaxAge: 10 * 60_000,
  });
  const secret = config.SUPABASE_JWT_SECRET ? new TextEncoder().encode(config.SUPABASE_JWT_SECRET) : null;

  return async (token: string) => {
    if (!token || token.length > 8192) throw unauthorized();
    let payload: JWTPayload;
    try {
      const header = JSON.parse(Buffer.from(token.split('.')[0] ?? '', 'base64url').toString('utf8')) as { alg?: string };
      const opts = { issuer, audience: 'authenticated', clockTolerance: 5 } as const;
      if (header.alg === 'HS256') {
        if (!secret) throw new Error('HS256 token but no secret configured');
        ({ payload } = await jwtVerify(token, secret, { ...opts, algorithms: ['HS256'] }));
      } else {
        ({ payload } = await jwtVerify(token, jwks, { ...opts, algorithms: ['ES256', 'RS256'] }));
      }
    } catch {
      throw unauthorized('Your session is invalid or has expired. Please sign in again.');
    }
    const sub = payload.sub;
    if (!sub || !/^[0-9a-f-]{36}$/i.test(sub) || payload.role !== 'authenticated') throw unauthorized();
    return {
      userId: sub,
      email: String((payload as { email?: string }).email ?? '').toLowerCase(),
      aal: (payload as { aal?: string }).aal === 'aal2' ? 'aal2' : 'aal1',
      sessionId: (payload as { session_id?: string }).session_id ?? null,
      issuedAt: payload.iat ?? 0,
      expiresAt: payload.exp ?? 0,
    };
  };
}

export function bearer(header: string | undefined): string {
  if (!header?.startsWith('Bearer ')) throw unauthorized();
  return header.slice(7).trim();
}

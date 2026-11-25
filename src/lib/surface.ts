/**
 * One web codebase, three experiences:
 *   bluecollarshift.com        → public website
 *   app.bluecollarshift.com    → employer / employee application
 *   admin.bluecollarshift.com  → Blue Collar platform administration
 * In development (localhost / preview URLs) the same pages live under /, /app and /admin.
 * Domains are NOT a security boundary — the API authorises every request.
 */
export type Surface = 'public' | 'app' | 'admin';

export function currentSurface(host = typeof window !== 'undefined' ? window.location.hostname : ''): Surface | 'dev' {
  if (host.startsWith('app.')) return 'app';
  if (host.startsWith('admin.')) return 'admin';
  if (host === 'bluecollarshift.com' || host === 'www.bluecollarshift.com') return 'public';
  return 'dev';
}

const surface = currentSurface();
/** Path prefix for app/admin links (empty on their own subdomain). */
export const APP = surface === 'app' ? '' : '/app';
export const ADMIN = surface === 'admin' ? '' : '/admin';

export function appUrl(path = '') {
  if (surface === 'public') return `https://app.bluecollarshift.com${path}`;
  return `${APP}${path}`;
}

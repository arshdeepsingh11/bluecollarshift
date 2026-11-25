import { Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from '../hooks/useAuth';
import { Loading } from './ui';
import { ADMIN, APP } from '../lib/surface';

/**
 * Route guards improve UX only. They are NOT security: every request is authorised by the API
 * and by database row-level security (Rules.md, Rule 2).
 */
export function RequireAuth({ children, loginPath = `${APP}/login` }: { children: ReactNode; loginPath?: string }) {
  const { session, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <Loading />;
  if (!session) return <Navigate to={`${loginPath}?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  return <>{children}</>;
}

export function RequireMembership({ children, employeeOnly }: { children: ReactNode; employeeOnly?: boolean }) {
  const { me, membership, loading, error } = useAuth();
  if (loading) return <Loading />;
  if (error) return <div className="bc-main"><div className="bc-alert error">{error}</div></div>;
  if (!me) return <Navigate to={`${APP}/login`} replace />;
  if (me.needsOnboarding || !membership) return <Navigate to={`${APP}/onboarding`} replace />;
  if (employeeOnly && membership.role !== 'employee') return <Navigate to={`${APP}/`} replace />;
  if (!employeeOnly && membership.role === 'employee') return <Navigate to={`${APP}/me`} replace />;
  return <>{children}</>;
}

export function RequirePlatform({ children }: { children: ReactNode }) {
  const { me, loading } = useAuth();
  if (loading) return <Loading />;
  if (!me?.platform) return <Navigate to={`${ADMIN}/login?denied=1`} replace />;
  if (!me.platform.mfaVerified) return <Navigate to={`${ADMIN}/mfa`} replace />;
  return <>{children}</>;
}

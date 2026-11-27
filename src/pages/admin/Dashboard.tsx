import { lazy, Suspense, useState, type FormEvent, type ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { DashboardLayout } from '../../components/DashboardLayout';
import { Alert, Drawer, Field, Loading } from '../../components/ui';
import { useAuth } from '../../hooks/useAuth';
import { ApiError, errorMessage } from '../../lib/api';
import { reauthenticate } from '../auth/Mfa';
import { ADMIN } from '../../lib/surface';
import { t } from '../../i18n';

const Overview = lazy(() => import('./Overview'));
const Companies = lazy(() => import('./Companies'));
const Staff = lazy(() => import('./PlatformEmployees'));
const Audit = lazy(() => import('./AuditLog'));
const Security = lazy(() => import('./Security'));
const Support = lazy(() => import('./SupportAccess'));
const PlatformSettings = lazy(() => import('./Settings'));
const Feedback = lazy(() => import('./Feedback'));

export default function AdminDashboard() {
  const { me } = useAuth();
  const p = new Set(me?.platform?.permissions ?? []);
  const nav = [
    { label: t('nav.admin_overview'), to: `${ADMIN}/`, end: true, show: true },
    { label: t('nav.admin_companies'), to: `${ADMIN}/companies`, show: p.has('platform.companies.view') },
    { label: t('nav.admin_staff'), to: `${ADMIN}/staff`, show: p.has('platform.staff.view') },
    { label: t('nav.admin_audit'), to: `${ADMIN}/audit`, show: p.has('platform.audit.view') },
    { label: t('nav.admin_security'), to: `${ADMIN}/security`, show: p.has('platform.security.view') },
    { label: t('nav.admin_support'), to: `${ADMIN}/support`, show: p.has('platform.audit.view') || p.has('platform.support_access.request') },
    { label: t('nav.admin_feedback'), to: `${ADMIN}/feedback`, show: p.has('platform.feedback.view') },
    { label: t('nav.admin_settings'), to: `${ADMIN}/settings`, show: p.has('platform.overview.view') },
  ].filter((n) => n.show);
  return (
    <DashboardLayout subtitle={t('admin.title')} navItems={nav} showCompanySwitch={false}>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route index element={<Overview />} />
          <Route path="companies" element={<Companies />} />
          <Route path="staff" element={<Staff />} />
          <Route path="audit" element={<Audit />} />
          <Route path="security" element={<Security />} />
          <Route path="support" element={<Support />} />
          <Route path="settings" element={<PlatformSettings />} />
          <Route path="feedback" element={<Feedback />} />
          <Route path="*" element={<Navigate to={`${ADMIN}/`} replace />} />
        </Routes>
      </Suspense>
    </DashboardLayout>
  );
}

/**
 * Wraps a critical admin action: run it; if the API says re-authentication is required,
 * ask for a fresh TOTP code, verify, then retry once.
 */
export function useCritical() {
  const [pending, setPending] = useState<null | { run: () => Promise<void>; resolve: (ok: boolean) => void }>(null);
  async function critical(run: () => Promise<void>): Promise<boolean> {
    try {
      await run();
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.status === 403 && /confirm your identity/i.test(e.message)) {
        return new Promise((resolve) => setPending({ run, resolve }));
      }
      throw e;
    }
  }
  const dialog: ReactNode = pending ? <ReauthDialog onCancel={() => { pending.resolve(false); setPending(null); }} onVerified={async () => {
    try { await pending.run(); pending.resolve(true); } catch (e) { alert(errorMessage(e)); pending.resolve(false); } finally { setPending(null); }
  }} /> : null;
  return { critical, dialog };
}

function ReauthDialog({ onCancel, onVerified }: { onCancel: () => void; onVerified: () => Promise<void> }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (await reauthenticate(code)) await onVerified();
    else setError(t('auth.mfa_invalid'));
  }
  return (
    <Drawer title={t('auth.reauth_title')} onClose={onCancel} center>
      <p>{t('auth.reauth_body')}</p>
      {error && <Alert kind="error">{error}</Alert>}
      <form onSubmit={submit}>
        <Field label={t('auth.mfa_code')} htmlFor="rcode"><input id="rcode" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} /></Field>
        <div className="bc-actions"><button className="bc-btn" disabled={code.length !== 6}>{t('common.confirm')}</button></div>
      </form>
    </Drawer>
  );
}

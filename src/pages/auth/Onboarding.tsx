import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { errorMessage, post } from '../../lib/api';
import { useAuth } from '../../hooks/useAuth';
import { t } from '../../i18n';
import { Alert, Field, Loading } from '../../components/ui';
import { APP } from '../../lib/surface';

const ZONES = ['America/Edmonton', 'America/Vancouver', 'America/Regina', 'America/Winnipeg', 'America/Toronto', 'America/Halifax', 'America/St_Johns'];

export default function Onboarding() {
  const { me, session, loading, reload, selectCompany } = useAuth();
  const navigate = useNavigate();
  const [companyName, setCompanyName] = useState('');
  const [fullName, setFullName] = useState((session?.user.user_metadata?.full_name as string) ?? '');
  const [timezone, setTimezone] = useState('America/Edmonton');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (loading) return <Loading />;
  if (me && !me.needsOnboarding) return <Navigate to={`${APP}/`} replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const c = await post<{ id: string }>('/companies', { companyName, fullName, timezone });
      selectCompany(c.id);
      await reload();
      navigate(`${APP}/`, { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <div className="auth-card">
        <img className="auth-brand" src="/brand/logo.svg" alt="Blue Collar" width={84} height={84} />
        <h1 className="auth-title">{t('onboard.title')}</h1>
        <p className="auth-subtitle">{session?.user.email}</p>
        {error && <Alert kind="error">{error}</Alert>}
        <form onSubmit={submit}>
          <Field label={t('auth.full_name')} htmlFor="fn">
            <input id="fn" required minLength={2} value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </Field>
          <Field label={t('onboard.company_name')} htmlFor="cn">
            <input id="cn" required minLength={2} maxLength={120} value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
          </Field>
          <Field label={t('onboard.timezone')} htmlFor="tz">
            <select id="tz" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
              {ZONES.map((z) => <option key={z}>{z}</option>)}
            </select>
          </Field>
          <button className="bc-btn block" disabled={busy}>{busy ? t('common.saving') : t('onboard.create')}</button>
        </form>
      </div>
    </main>
  );
}

import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { errorMessage, post } from '../../lib/api';
import { useAuth } from '../../hooks/useAuth';
import { t } from '../../i18n';
import { Alert, Field, Loading } from '../../components/ui';
import { APP } from '../../lib/surface';

import { COUNTRY_OPTIONS, guessCountryZone, ZONES, type CountryCode } from '../../lib/zones';

export default function Onboarding() {
  const { me, session, loading, reload, selectCompany } = useAuth();
  const navigate = useNavigate();
  const [companyName, setCompanyName] = useState('');
  const [fullName, setFullName] = useState((session?.user.user_metadata?.full_name as string) ?? '');
  const guess = guessCountryZone();
  const [country, setCountry] = useState<CountryCode>(guess.country);
  const [timezone, setTimezone] = useState(guess.zone);
  const currency = COUNTRY_OPTIONS.find((c) => c.code === country)!.currency;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (loading) return <Loading />;
  if (me && !me.needsOnboarding) return <Navigate to={`${APP}/`} replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const c = await post<{ id: string }>('/companies', { companyName, fullName, timezone, country, currency });
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
          <Field label={t('onboard.country')} htmlFor="ct" hint={t('onboard.currency_hint', { currency })}>
            <select id="ct" value={country} onChange={(e) => { const c = e.target.value as CountryCode; setCountry(c); setTimezone(ZONES[c][0]!.id); }}>
              {COUNTRY_OPTIONS.map((c) => <option key={c.code} value={c.code}>{t(`country.${c.code}`)}</option>)}
            </select>
          </Field>
          <Field label={t('onboard.timezone')} htmlFor="tz">
            <select id="tz" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
              {ZONES[country].map((z) => <option key={z.id} value={z.id}>{z.label}</option>)}
            </select>
          </Field>
          <button className="bc-btn block" disabled={busy}>{busy ? t('common.saving') : t('onboard.create')}</button>
        </form>
      </div>
    </main>
  );
}

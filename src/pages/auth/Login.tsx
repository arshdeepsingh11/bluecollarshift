import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../../lib/supabaseClient';
import { t } from '../../i18n';
import { Alert, Field } from '../../components/ui';
import { ADMIN, APP } from '../../lib/surface';

/** Only allow same-site relative redirects (prevents open-redirect attacks). */
export function safeNext(next: string | null, fallback: string) {
  return next && next.startsWith('/') && !next.startsWith('//') && !next.includes('\\') ? next : fallback;
}

export function authErrorMessage(message: string) {
  const m = message.toLowerCase();
  if (m.includes('invalid login')) return t('auth.invalid_credentials');
  if (m.includes('not confirmed')) return t('auth.email_not_confirmed');
  if (m.includes('rate') || m.includes('too many')) return t('auth.rate_limited');
  return t('common.error');
}

export default function Login({ admin = false }: { admin?: boolean }) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(params.get('denied') ? 'This account does not have platform access.' : null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
    setBusy(false);
    if (err) return setError(authErrorMessage(err.message));
    navigate(safeNext(params.get('next'), admin ? `${ADMIN}/mfa` : `${APP}/`), { replace: true });
  }

  return (
    <main className="auth-page">
      <div className="auth-card">
        <img className="auth-brand" src="/brand/logo.svg" alt="Blue Collar" width={84} height={84} />
        <h1 className="auth-title">{admin ? 'Platform administration' : t('auth.sign_in_title')}</h1>
        <p className="auth-subtitle">{t('app.tagline')}</p>
        {error && <Alert kind="error">{error}</Alert>}
        <form onSubmit={submit} noValidate>
          <Field label={t('common.email')} htmlFor="email">
            <input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label={t('auth.password')} htmlFor="password">
            <input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <button className="bc-btn block" disabled={busy || !email || !password}>{busy ? t('common.loading') : t('auth.sign_in')}</button>
        </form>
        {!admin && (
          <div className="auth-links">
            <Link to={`${APP}/forgot-password`}>{t('auth.forgot')}</Link>
            <span>
              {t('auth.no_account')} <Link to={`${APP}/signup`}>{t('auth.create_company')}</Link>
            </span>
            <span>{t('auth.have_invite')}</span>
          </div>
        )}
      </div>
    </main>
  );
}

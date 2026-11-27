import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabaseClient';
import { t } from '../../i18n';
import { Captcha, captchaEnabled } from '../../components/Captcha';
import { LanguagePicker } from '../../components/LanguagePicker';
import { Alert, Field } from '../../components/ui';
import { APP } from '../../lib/surface';
import { authErrorMessage } from './Login';

export function passwordProblem(pw: string): string | null {
  if (pw.length < 12) return t('auth.password_rules');
  return null;
}

/**
 * Step 1: create the login (Supabase sends a verification email).
 * Step 2 (after verifying and signing in): /onboarding creates the company via the API.
 */
export default function EmployerSignup() {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [captchaReset, setCaptchaReset] = useState(0);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const pwErr = passwordProblem(password);
    if (pwErr) return setError(pwErr);
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.signUp({
      email: email.trim().toLowerCase(),
      password,
      options: { data: { full_name: fullName.trim() }, emailRedirectTo: `${window.location.origin}${APP}/onboarding`, captchaToken: captcha ?? undefined },
    });
    setBusy(false);
    setCaptchaReset((n) => n + 1);
    // Same response whether or not the email already exists (prevents account enumeration).
    if (err && !err.message.toLowerCase().includes('registered')) return setError(authErrorMessage(err.message));
    setSent(true);
  }

  return (
    <main className="auth-page">
      <div className="auth-card">
        <img className="auth-brand" src="/brand/logo.svg" alt="Blue Collar" width={84} height={84} />
        {sent ? (
          <>
            <h1 className="auth-title">{t('auth.check_email')}</h1>
            <p className="auth-subtitle">{t('auth.check_email_body', { email })}</p>
            <Link className="bc-btn block secondary" to={`${APP}/login`}>{t('auth.sign_in')}</Link>
          </>
        ) : (
          <>
            <h1 className="auth-title">{t('auth.signup_title')}</h1>
            <p className="auth-subtitle">{t('auth.signup_subtitle')}</p>
            {error && <Alert kind="error">{error}</Alert>}
            <form onSubmit={submit}>
              <Field label={t('auth.full_name')} htmlFor="name">
                <input id="name" autoComplete="name" required minLength={2} maxLength={120} value={fullName} onChange={(e) => setFullName(e.target.value)} />
              </Field>
              <Field label={t('common.email')} htmlFor="email">
                <input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
              </Field>
              <Field label={t('auth.password')} htmlFor="pw" hint={t('auth.password_rules')}>
                <input id="pw" type="password" autoComplete="new-password" required minLength={12} value={password} onChange={(e) => setPassword(e.target.value)} />
              </Field>
              <Captcha onToken={setCaptcha} resetKey={captchaReset} />
              <button className="bc-btn block" disabled={busy || (captchaEnabled && !captcha)}>{busy ? t('common.loading') : t('auth.create_company')}</button>
            </form>
            <div className="auth-links">
              <Link to={`${APP}/login`}>{t('auth.sign_in')}</Link>
            </div>
            <div className="auth-lang"><LanguagePicker className="" /></div>
          </>
        )}
      </div>
    </main>
  );
}

import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabaseClient';
import { t } from '../../i18n';
import { Alert, Field } from '../../components/ui';
import { APP, ADMIN } from '../../lib/surface';
import { Captcha, captchaEnabled } from '../../components/Captcha';
import { LanguagePicker } from '../../components/LanguagePicker';

/**
 * Email-based recovery only (security questions removed). Supabase sends a short-lived,
 * single-use link. The same message is shown whether or not the account exists.
 */
export default function ForgotPassword({ admin = false }: { admin?: boolean }) {
  const base = admin ? ADMIN : APP;
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [captcha, setCaptcha] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), { redirectTo: `${window.location.origin}${base}/reset-password`, captchaToken: captcha ?? undefined });
    setBusy(false);
    setSent(true);
  }

  return (
    <main className="auth-page">
      <div className="auth-card">
        <img className="auth-brand" src="/brand/logo.svg" alt="Blue Collar" width={84} height={84} />
        <h1 className="auth-title">{t('auth.reset_title')}</h1>
        {sent ? (
          <Alert kind="success">{t('auth.reset_sent')}</Alert>
        ) : (
          <>
            <p className="auth-subtitle">{t('auth.reset_body')}</p>
            <form onSubmit={submit}>
              <Field label={t('common.email')} htmlFor="email">
                <input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
              </Field>
              <Captcha onToken={setCaptcha} />
              <button className="bc-btn block" disabled={busy || !email || (captchaEnabled && !captcha)}>{t('auth.reset_send')}</button>
            </form>
          </>
        )}
        <div className="auth-links"><Link to={`${base}/login`}>{t('auth.sign_in')}</Link></div>
        <div className="auth-lang"><LanguagePicker className="" /></div>
      </div>
    </main>
  );
}

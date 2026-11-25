import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabaseClient';
import { t } from '../../i18n';
import { Alert, Field } from '../../components/ui';
import { APP } from '../../lib/surface';

/**
 * Email-based recovery only (security questions removed). Supabase sends a short-lived,
 * single-use link. The same message is shown whether or not the account exists.
 */
export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), { redirectTo: `${window.location.origin}${APP}/reset-password` });
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
              <button className="bc-btn block" disabled={busy || !email}>{t('auth.reset_send')}</button>
            </form>
          </>
        )}
        <div className="auth-links"><Link to={`${APP}/login`}>{t('auth.sign_in')}</Link></div>
      </div>
    </main>
  );
}

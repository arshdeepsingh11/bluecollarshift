import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabaseClient';
import { t } from '../../i18n';
import { Alert, Field } from '../../components/ui';
import { APP } from '../../lib/surface';
import { passwordProblem } from './EmployerSignup';

export default function ResetPassword() {
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    // The recovery link signs the user in with a short-lived recovery session.
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') setReady(true);
    });
    supabase.auth.getSession().then(({ data: s }) => s.session && setReady(true));
    return () => data.subscription.unsubscribe();
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const p = passwordProblem(password);
    if (p) return setError(p);
    const { error: err } = await supabase.auth.updateUser({ password });
    if (err) return setError(err.message);
    // End every other session after a password change.
    await supabase.auth.signOut({ scope: 'global' });
    setDone(true);
  }

  return (
    <main className="auth-page">
      <div className="auth-card">
        <img className="auth-brand" src="/brand/logo.svg" alt="Blue Collar" width={84} height={84} />
        <h1 className="auth-title">{t('auth.set_new_password')}</h1>
        {done ? (
          <>
            <Alert kind="success">{t('auth.password_updated')}</Alert>
            <Link className="bc-btn block" to={`${APP}/login`}>{t('auth.sign_in')}</Link>
          </>
        ) : !ready ? (
          <Alert kind="warning">{t('invite.expired')}</Alert>
        ) : (
          <form onSubmit={submit}>
            {error && <Alert kind="error">{error}</Alert>}
            <Field label={t('auth.password_new')} htmlFor="pw" hint={t('auth.password_rules')}>
              <input id="pw" type="password" autoComplete="new-password" required minLength={12} value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            <button className="bc-btn block">{t('common.save')}</button>
          </form>
        )}
      </div>
    </main>
  );
}

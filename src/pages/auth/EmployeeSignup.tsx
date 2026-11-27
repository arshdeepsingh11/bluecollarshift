import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../../lib/supabaseClient';
import { errorMessage, get, post } from '../../lib/api';
import { useAuth } from '../../hooks/useAuth';
import { t, type MessageKey } from '../../i18n';
import { Captcha, captchaEnabled } from '../../components/Captcha';
import { LanguagePicker } from '../../components/LanguagePicker';
import { Alert, Field, Loading } from '../../components/ui';
import { APP } from '../../lib/surface';
import { authErrorMessage } from './Login';
import { passwordProblem } from './EmployerSignup';

interface Preview {
  companyName: string;
  role: string;
  email: string;
  status: 'valid' | 'expired' | 'accepted' | 'revoked';
}

/** Invitation acceptance. The server checks that the signed-in, verified email matches the invite. */
export default function AcceptInvite() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const { session, reload } = useAuth();
  const navigate = useNavigate();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'signup' | 'signin'>('signup');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) return setError(t('invite.invalid'));
    get<Preview>(`/invitations/preview?token=${encodeURIComponent(token)}`).then(setPreview).catch(() => setError(t('invite.invalid')));
  }, [token]);

  async function accept() {
    setBusy(true);
    setError(null);
    try {
      await post('/invitations/accept', { token, fullName: fullName || undefined });
      await reload();
      setDone(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const [captcha, setCaptcha] = useState<string | null>(null);
  const [captchaReset, setCaptchaReset] = useState(0);

  async function authenticate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (mode === 'signup') {
      const p = passwordProblem(password);
      if (p) return setError(p);
    }
    setBusy(true);
    const redirect = `${window.location.origin}${APP}/invite?token=${encodeURIComponent(token)}`;
    const res =
      mode === 'signup'
        ? await supabase.auth.signUp({ email: email.trim().toLowerCase(), password, options: { data: { full_name: fullName }, emailRedirectTo: redirect, captchaToken: captcha ?? undefined } })
        : await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password, options: { captchaToken: captcha ?? undefined } });
    setBusy(false);
    setCaptchaReset((n) => n + 1);
    if (res.error) return setError(authErrorMessage(res.error.message));
    if (mode === 'signup' && !res.data.session) setSent(true);
  }

  const body = () => {
    if (error && !preview) return <Alert kind="error">{error}</Alert>;
    if (!preview) return <Loading />;
    if (preview.status !== 'valid') return <Alert kind="warning">{t(`invite.${preview.status}` as MessageKey)}</Alert>;
    if (done)
      return (
        <>
          <Alert kind="success">{t('invite.done', { company: preview.companyName })}</Alert>
          {preview.role === 'employee' && <p className="auth-subtitle">{t('invite.get_app')}</p>}
          <button className="bc-btn block" onClick={() => navigate(`${APP}/`)}>{t('common.next')}</button>
        </>
      );
    if (sent) return <Alert kind="info">{t('auth.check_email_body', { email })}</Alert>;
    if (session)
      return (
        <>
          {error && <Alert kind="error">{error}</Alert>}
          <button className="bc-btn block" disabled={busy} onClick={() => void accept()}>{busy ? t('common.loading') : t('invite.accept')}</button>
        </>
      );
    return (
      <>
        <p className="auth-subtitle">{t('invite.sign_in_first')}</p>
        {error && <Alert kind="error">{error}</Alert>}
        <form onSubmit={authenticate}>
          {mode === 'signup' && (
            <Field label={t('auth.full_name')} htmlFor="name">
              <input id="name" required minLength={2} value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </Field>
          )}
          <Field label={t('common.email')} htmlFor="email" hint={t('invite.sent_to', { email: preview.email })}>
            <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label={t('auth.password')} htmlFor="pw" hint={mode === 'signup' ? t('auth.password_rules') : undefined}>
            <input id="pw" type="password" required autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          {mode === 'signin' && (
            <div className="auth-forgot"><Link to={`${APP}/forgot-password`}>{t('auth.forgot')}</Link></div>
          )}
          <Captcha onToken={setCaptcha} resetKey={captchaReset} />
          <button className="bc-btn block" disabled={busy || (captchaEnabled && !captcha)}>{mode === 'signup' ? t('invite.create_account') : t('auth.sign_in')}</button>
        </form>
        <div className="auth-links">
          <button className="bc-btn ghost" onClick={() => setMode(mode === 'signup' ? 'signin' : 'signup')}>
            {mode === 'signup' ? t('auth.sign_in') : t('invite.create_account')}
          </button>
        </div>
      </>
    );
  };

  return (
    <main className="auth-page">
      <div className="auth-card">
        <img className="auth-brand" src="/brand/logo.svg" alt="Blue Collar" width={84} height={84} />
        <h1 className="auth-title">{t('invite.title')}</h1>
        {preview && <p className="auth-subtitle">{t('invite.body', { company: preview.companyName, role: t(`role.${preview.role}` as MessageKey) })}</p>}
        {body()}
        <div className="auth-links"><Link to={`${APP}/login`}>{t('auth.sign_in')}</Link></div>
        <div className="auth-lang"><LanguagePicker className="" /></div>
      </div>
    </main>
  );
}

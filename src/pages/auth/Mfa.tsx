import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../hooks/useAuth';
import { t } from '../../i18n';
import { Alert, Field, Loading } from '../../components/ui';
import { ADMIN } from '../../lib/surface';

/**
 * Mandatory TOTP MFA for platform staff (Supabase Auth MFA). Enrol on first visit,
 * otherwise verify. The API refuses all admin requests without an aal2 token.
 */
export default function Mfa() {
  const { reload } = useAuth();
  const navigate = useNavigate();
  const [factorId, setFactorId] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aal?.currentLevel === 'aal2') {
        await reload();
        return navigate(`${ADMIN}/`, { replace: true });
      }
      const { data } = await supabase.auth.mfa.listFactors();
      const verified = data?.totp.find((f) => f.status === 'verified');
      if (verified) setFactorId(verified.id);
      else {
        const { data: enrolled, error: err } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: `Blue Collar admin ${Date.now()}` });
        if (err || !enrolled) setError(err?.message ?? t('common.error'));
        else {
          setFactorId(enrolled.id);
          setQr(enrolled.totp.qr_code);
          setSecret(enrolled.totp.secret);
        }
      }
      setLoading(false);
    })();
  }, [navigate, reload]);

  async function verify(e: FormEvent) {
    e.preventDefault();
    if (!factorId) return;
    setError(null);
    const { error: err } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.trim() });
    if (err) return setError(t('auth.mfa_invalid'));
    await reload();
    navigate(`${ADMIN}/`, { replace: true });
  }

  if (loading) return <Loading />;
  return (
    <main className="auth-page">
      <div className="auth-card">
        <img className="auth-brand" src="/brand/logo.svg" alt="Blue Collar" width={84} height={84} />
        <h1 className="auth-title">{qr ? t('auth.mfa_enroll_title') : t('auth.mfa_title')}</h1>
        <p className="auth-subtitle">{qr ? t('auth.mfa_enroll_body') : t('auth.mfa_body')}</p>
        {qr && (
          <>
            <div className="auth-qr"><img src={qr} alt="Authenticator QR code" /></div>
            {secret && <p className="auth-secret">{secret}</p>}
          </>
        )}
        {error && <Alert kind="error">{error}</Alert>}
        <form onSubmit={verify}>
          <Field label={t('auth.mfa_code')} htmlFor="code">
            <input id="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value)} />
          </Field>
          <button className="bc-btn block" disabled={code.length !== 6}>{t('auth.mfa_verify')}</button>
        </form>
      </div>
    </main>
  );
}

/** Re-authentication for critical admin actions: a fresh TOTP verification issues a new token. */
export async function reauthenticate(code: string): Promise<boolean> {
  const { data } = await supabase.auth.mfa.listFactors();
  const f = data?.totp.find((x) => x.status === 'verified');
  if (!f) return false;
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: f.id, code });
  return !error;
}

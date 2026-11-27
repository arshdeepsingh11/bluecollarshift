import { useEffect, useRef } from 'react';
import { getLocale } from '../i18n';

/**
 * Cloudflare Turnstile (free) bot check for sign-up, sign-in and password reset.
 * Off until VITE_TURNSTILE_SITE_KEY is set. Supabase Auth verifies the token server-side
 * (Authentication > Attack Protection > CAPTCHA, provider Turnstile).
 */
export const CAPTCHA_SITE_KEY = (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined) || '';
export const captchaEnabled = !!CAPTCHA_SITE_KEY;

interface TurnstileApi {
  render: (el: HTMLElement, o: Record<string, unknown>) => string;
  reset: (id?: string) => void;
  remove: (id: string) => void;
}
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let scriptPromise: Promise<void> | null = null;
function loadScript() {
  if (window.turnstile) return Promise.resolve();
  scriptPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      scriptPromise = null;
      reject(new Error('captcha'));
    };
    document.head.appendChild(s);
  });
  return scriptPromise;
}

/** Renders the check and reports a token (null when expired). Change `resetKey` to get a fresh token after each use. */
export function Captcha({ onToken, resetKey = 0 }: { onToken: (token: string | null) => void; resetKey?: number }) {
  const box = useRef<HTMLDivElement>(null);
  const id = useRef<string | null>(null);
  useEffect(() => {
    if (!captchaEnabled || !box.current) return;
    let cancelled = false;
    loadScript()
      .then(() => {
        if (cancelled || !box.current || !window.turnstile) return;
        id.current = window.turnstile.render(box.current, {
          sitekey: CAPTCHA_SITE_KEY,
          language: getLocale() === 'pa' ? 'pa' : getLocale(),
          appearance: 'interaction-only',
          callback: (tk: string) => onToken(tk),
          'expired-callback': () => onToken(null),
          'error-callback': () => onToken(null),
        });
      })
      .catch(() => onToken(null));
    return () => {
      cancelled = true;
      if (id.current && window.turnstile) window.turnstile.remove(id.current);
      id.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (resetKey && id.current && window.turnstile) {
      onToken(null);
      window.turnstile.reset(id.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);
  if (!captchaEnabled) return null;
  return <div className="bc-captcha" ref={box} />;
}

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Config } from '../config';
import { emailText, HTML_LANG, type Locale } from '../i18n/messages';

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  tag: string;
}

export interface Mailer {
  send(m: EmailMessage): Promise<{ id: string | null; delivered: boolean }>;
}

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

/** Resend in production; a local outbox folder in development (no account needed). */
export function createMailer(config: Config, log: { info: (o: object, m: string) => void; error: (o: object, m: string) => void }): Mailer {
  if (config.RESEND_API_KEY) {
    return {
      async send(m) {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${config.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: config.EMAIL_FROM, to: [m.to], subject: m.subject, html: m.html, text: m.text, tags: [{ name: 'type', value: m.tag }] }),
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) {
          log.error({ status: res.status, tag: m.tag }, 'email send failed');
          return { id: null, delivered: false };
        }
        const body = (await res.json()) as { id?: string };
        return { id: body.id ?? null, delivered: true };
      },
    };
  }
  return {
    async send(m) {
      const dir = path.resolve(config.EMAIL_OUTBOX_DIR);
      await mkdir(dir, { recursive: true });
      const file = path.join(dir, `${Date.now()}-${m.tag}-${m.to.replace(/[^a-z0-9@.]/gi, '_')}.html`);
      await writeFile(file, `<!-- to: ${esc(m.to)} | subject: ${esc(m.subject)} -->\n${m.html}`);
      log.info({ file, tag: m.tag }, 'email written to local outbox (RESEND_API_KEY not set)');
      return { id: file, delivered: true };
    },
  };
}

// ---------- Templates (plain, accessible, brand blue) ----------
function layout(title: string, bodyHtml: string, cta: { label: string; url: string } | undefined, locale: Locale) {
  const button = cta
    ? `<p style="margin:28px 0"><a href="${esc(cta.url)}" style="background:#1F5FA6;color:#fff;padding:12px 22px;border-radius:10px;text-decoration:none;font-weight:600;display:inline-block">${esc(cta.label)}</a></p>
       <p style="font-size:12px;color:#5B6478">${esc(emailText(locale, 'copy'))} ${esc(cta.url)}</p>`
    : '';
  return `<!doctype html><html lang="${HTML_LANG[locale]}"><body style="margin:0;background:#F4F7FB;font-family:Segoe UI,Roboto,Helvetica,Arial,'Nirmala UI','Noto Sans Gurmukhi','Noto Sans Devanagari','Noto Sans Gujarati',sans-serif;color:#1B2233">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
  <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:16px;padding:32px">
  <tr><td><p style="font-weight:800;color:#1F5FA6;font-size:20px;margin:0 0 24px">Blue Collar</p>
  <h1 style="font-size:22px;margin:0 0 16px">${esc(title)}</h1>${bodyHtml}${button}
  <p style="font-size:12px;color:#5B6478;margin-top:32px">${esc(emailText(locale, 'footer'))}</p>
  </td></tr></table></td></tr></table></body></html>`;
}

export const templates = {
  invitation(p: { companyName: string; inviterName: string; role: string; url: string; expiresAt: string; locale?: Locale; timeZone?: string }): Omit<EmailMessage, 'to'> {
    const L = p.locale ?? 'en';
    const role = emailText(L, `role_${p.role}` as 'role_employee');
    const v = { company: p.companyName, inviter: p.inviterName, role, when: { date: p.expiresAt } };
    const title = emailText(L, 'invite_title', v, p.timeZone);
    const body = emailText(L, 'invite_body', v, p.timeZone);
    const expires = emailText(L, 'invite_expires', v, p.timeZone);
    return {
      tag: 'invitation',
      subject: emailText(L, 'invite_subject', v, p.timeZone),
      html: layout(title, `<p>${esc(body)}</p><p>${esc(expires)}</p>`, { label: emailText(L, 'invite_cta'), url: p.url }, L),
      text: `${title}\n${body}\n${p.url}\n${expires}`,
    };
  },
  /** Any notification (already translated for the recipient). */
  attendanceAlert(p: { title: string; body: string; url: string; locale?: Locale }): Omit<EmailMessage, 'to'> {
    const L = p.locale ?? 'en';
    return {
      tag: 'attendance',
      subject: p.title,
      html: layout(p.title, `<p>${esc(p.body)}</p>`, { label: emailText(L, 'open'), url: p.url }, L),
      text: `${p.title}\n${p.body}\n${p.url}`,
    };
  },
};

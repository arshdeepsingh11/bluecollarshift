import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Config } from '../config';

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
function layout(title: string, bodyHtml: string, cta?: { label: string; url: string }) {
  const button = cta
    ? `<p style="margin:28px 0"><a href="${esc(cta.url)}" style="background:#1F5FA6;color:#fff;padding:12px 22px;border-radius:10px;text-decoration:none;font-weight:600;display:inline-block">${esc(cta.label)}</a></p>
       <p style="font-size:12px;color:#5B6478">Or copy this link: ${esc(cta.url)}</p>`
    : '';
  return `<!doctype html><html lang="en"><body style="margin:0;background:#F4F7FB;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1B2233">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
  <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:16px;padding:32px">
  <tr><td><p style="font-weight:800;color:#1F5FA6;font-size:20px;margin:0 0 24px">Blue Collar</p>
  <h1 style="font-size:22px;margin:0 0 16px">${esc(title)}</h1>${bodyHtml}${button}
  <p style="font-size:12px;color:#5B6478;margin-top:32px">You received this email because of activity on your Blue Collar account. If this wasn't you, you can ignore it.</p>
  </td></tr></table></td></tr></table></body></html>`;
}

export const templates = {
  invitation(p: { companyName: string; inviterName: string; role: string; url: string; expiresAt: string }): Omit<EmailMessage, 'to'> {
    const title = `${p.inviterName} invited you to ${p.companyName}`;
    return {
      tag: 'invitation',
      subject: `You're invited to join ${p.companyName} on Blue Collar`,
      html: layout(
        title,
        `<p>You've been invited to join <strong>${esc(p.companyName)}</strong> as <strong>${esc(p.role)}</strong>.</p>
         <p>This invitation expires on ${esc(new Date(p.expiresAt).toUTCString())}.</p>`,
        { label: 'Accept invitation', url: p.url },
      ),
      text: `${title}\nRole: ${p.role}\nAccept: ${p.url}\nExpires: ${p.expiresAt}`,
    };
  },
  shiftAssigned(p: { siteName: string; when: string; url: string }): Omit<EmailMessage, 'to'> {
    return {
      tag: 'shift',
      subject: `New shift at ${p.siteName}`,
      html: layout('You have a new shift', `<p><strong>${esc(p.siteName)}</strong><br>${esc(p.when)}</p>`, { label: 'View schedule', url: p.url }),
      text: `New shift at ${p.siteName}: ${p.when}\n${p.url}`,
    };
  },
  attendanceAlert(p: { title: string; body: string; url: string }): Omit<EmailMessage, 'to'> {
    return {
      tag: 'attendance',
      subject: p.title,
      html: layout(p.title, `<p>${esc(p.body)}</p>`, { label: 'Open Blue Collar', url: p.url }),
      text: `${p.title}\n${p.body}\n${p.url}`,
    };
  },
};

import { useEffect, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { appUrl } from '../../lib/surface';

/** Sets title/description client-side; the prerender step writes the same tags into static HTML. */
export const SEO: Record<string, { title: string; description: string }> = {
  '/': { title: 'Blue Collar — Scheduling, GPS attendance & payroll prep for the trades', description: 'Schedule crews, verify clock-ins with GPS (even offline), approve timesheets transparently and prepare payroll. Built for construction, electrical, plumbing and HVAC companies across Canada, the United States and Mexico.' },
  '/features': { title: 'Features — Blue Collar', description: 'Offline clock-in with GPS, job-site maps, scheduling, transparent timesheet adjustments, your own overtime policy, crew clock-in, shift swaps, time off, safety forms, messaging and payroll exports.' },
  '/pricing': { title: 'Pricing — Blue Collar', description: 'Blue Collar is free during launch. No credit card required.' },
  '/contact': { title: 'Contact — Blue Collar', description: 'Questions, demos and support for Blue Collar.' },
  '/privacy': { title: 'Privacy policy — Blue Collar', description: 'How Blue Collar collects, uses and protects personal information.' },
  '/terms': { title: 'Terms of service — Blue Collar', description: 'The terms that apply when you use Blue Collar.' },
  '/security': { title: 'Security & vulnerability disclosure — Blue Collar', description: 'How we protect your data and how to report a security issue.' },
};

function useSeo(path: string) {
  useEffect(() => {
    const s = SEO[path];
    if (!s) return;
    document.title = s.title;
    document.querySelector('meta[name="description"]')?.setAttribute('content', s.description);
  }, [path]);
}

function Section({ children, tone }: { children: ReactNode; tone?: 'light' }) {
  return <section className={`pub-section ${tone ?? ''}`}><div className="pub-wrap">{children}</div></section>;
}

const FEATURES = [
  ['Clock in anywhere — even offline', 'Employees clock in and out from their phone. No signal on site? Events are saved on the phone and sync automatically when back online, with device and server times kept for review.'],
  ['GPS verification without tracking', 'Location is captured only at clock-in and clock-out and compared with the job-site radius. Out-of-range events are flagged for review, never silently rejected. No continuous tracking.'],
  ['Scheduling by job site', 'Create shifts and recurring weeks, assign crews, add instructions. Employees are notified instantly; changes keep a full history.'],
  ['Transparent timesheet adjustments', 'Correct hours with a required reason. The original record is never overwritten — employees see the original, the change, who made it and why, and can dispute it.'],
  ['Your overtime policy', 'Daily, weekly, both or none — you set the hours and the rate to match your company policy. Never double-counted, with a clear explanation of every number.'],
  ['Crew clock-in', 'A foreman clocks in the whole crew from one phone — even offline. Every entry records who made it.'],
  ['Shift swaps, open shifts & time off', 'Workers swap shifts, pick up open shifts and request time off from their phone. Managers approve in one tap and get warned about conflicts.'],
  ['Safety forms', 'Report incidents, near misses and hazards with a photo. Run toolbox talks and collect sign-offs on each worker’s phone.'],
  ['Your language', 'English, Español, Français, ਪੰਜਾਬੀ, हिन्दी and ગુજરાતી — each person picks their own, including emails and alerts.'],
  ['Payroll preparation', 'Approved hours flow into pay-period summaries with regular and overtime hours, gross estimates and an explanation of every number. Export for ADP, Gusto, QuickBooks, Wagepoint or a spreadsheet.'],
  ['Built-in messaging', 'Message employees and crews in real time, send announcements, see read receipts. No SMS fees, no third-party chat.'],
  ['Security first', 'Every request is authorised on our servers and again by the database. Company data is isolated. Administrators use two-step verification. All sensitive changes are audited.'],
];

export function Home() {
  useSeo('/');
  return (
    <>
      <section className="pub-hero">
        <div className="pub-wrap pub-hero-grid">
          <div>
            <p className="pub-kicker">For construction, electrical, plumbing & HVAC companies</p>
            <h1>Know who’s on site. Pay the right hours.</h1>
            <p className="pub-lead">Blue Collar connects your office and your crews: schedules, GPS clock-in that works without signal, honest timesheets and payroll-ready hours — in one place.</p>
            <div className="pub-hero-cta">
              <a className="pub-btn" href={appUrl('/signup')}>Create your free account</a>
              <Link className="pub-btn ghost" to="/features">See how it works</Link>
            </div>
            <p className="pub-note">Free during launch · No credit card · iPhone & Android</p>
          </div>
          <img className="pub-hero-logo" src="/brand/logo.svg" alt="Blue Collar logo" width={320} height={315} />
        </div>
      </section>
      <Section>
        <h2>Everything a trades business needs to run its crews</h2>
        <div className="pub-grid">
          {FEATURES.slice(0, 6).map(([title, body]) => <article key={title} className="pub-card"><h3>{title}</h3><p>{body}</p></article>)}
        </div>
      </Section>
      <Section tone="light">
        <div className="pub-split">
          <div>
            <h2>Fair to employers. Fair to employees.</h2>
            <p>Every adjustment keeps the original clock record, needs a reason, notifies the employee and can be disputed. Clear records prevent arguments on payday.</p>
          </div>
          <ol className="pub-steps">
            <li><strong>Clock in</strong> on the job site — online or offline.</li>
            <li><strong>Review</strong> flagged events and approve timesheets.</li>
            <li><strong>Adjust</strong> with a reason — the employee sees it.</li>
            <li><strong>Calculate</strong> overtime and gross pay by your own company policy.</li>
          </ol>
        </div>
      </Section>
      <Section>
        <div className="pub-final">
          <h2>Start in five minutes</h2>
          <p>Create your company, add a job site, invite your crew. They download the app and clock in.</p>
          <a className="pub-btn" href={appUrl('/signup')}>Get started free</a>
        </div>
      </Section>
    </>
  );
}

export function Features() {
  useSeo('/features');
  return (
    <Section>
      <h1>Features</h1>
      <p className="pub-lead">One connected platform: employer web dashboard, employee mobile app for iPhone and Android, and a secure backend.</p>
      <div className="pub-grid">{FEATURES.map(([title, body]) => <article key={title} className="pub-card"><h2 className="h3">{title}</h2><p>{body}</p></article>)}</div>
      <h2 style={{ marginTop: 48 }}>Roles that match how your company works</h2>
      <p>Owners, administrators, managers, supervisors (limited to their job sites), payroll staff and employees each see only what they need. Permissions are enforced by our servers, not just hidden in the screen.</p>
    </Section>
  );
}

export function Pricing() {
  useSeo('/pricing');
  return (
    <Section>
      <h1>Pricing</h1>
      <div className="pub-card pub-price">
        <h2>Launch plan</h2>
        <p className="pub-price-amount">$0</p>
        <p>Free while we launch. All features, unlimited employees, iPhone and Android apps.</p>
        <a className="pub-btn" href={appUrl('/signup')}>Create your account</a>
      </div>
      <p className="pub-note">Paid plans will be introduced later. Existing customers will get at least 60 days’ notice before any charge, and can export their data at any time.</p>
    </Section>
  );
}

export function Contact() {
  useSeo('/contact');
  return (
    <Section>
      <h1>Contact</h1>
      <div className="pub-grid">
        <article className="pub-card"><h2 className="h3">Sales & demos</h2><p><a href="mailto:hello@bluecollarshift.com">hello@bluecollarshift.com</a></p></article>
        <article className="pub-card"><h2 className="h3">Customer support</h2><p><a href="mailto:support@bluecollarshift.com">support@bluecollarshift.com</a></p><p>Mon–Fri, 8 am – 5 pm Mountain Time.</p></article>
        <article className="pub-card"><h2 className="h3">Security reports</h2><p><a href="mailto:security@bluecollarshift.com">security@bluecollarshift.com</a> — see our <Link to="/security">disclosure policy</Link>.</p></article>
      </div>
    </Section>
  );
}

function Legal({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <Section>
      <article className="pub-legal-doc">
        <h1>{title}</h1>
        <p className="pub-note">Last updated {updated}. <strong>Draft — to be reviewed by a lawyer before launch.</strong></p>
        {children}
      </article>
    </Section>
  );
}

export function Privacy() {
  useSeo('/privacy');
  return (
    <Legal title="Privacy policy" updated="November 27, 2026">
      <h2>What we collect</h2>
      <p>Account details (name, email), company information, schedules, attendance events (time, and location at the moment of clock-in/out when you allow it), timesheet adjustments, pay rates and pay summaries entered by your employer, messages you send in Blue Collar, and technical logs needed for security.</p>
      <h2>Location</h2>
      <p>The mobile app reads your location only when you clock in, clock out or start/end a break. We do not track location continuously or in the background.</p>
      <h2>How we use it</h2>
      <p>To provide the service to your employer, verify attendance, calculate hours, send notifications, keep the service secure and meet legal obligations. We do not sell personal information.</p>
      <h2>Who can see it</h2>
      <p>Your employer’s authorised staff, according to their role. Blue Collar staff cannot see company payroll, hours or messages except through time-limited, audited support access requested to resolve an issue.</p>
      <h2>Where it is stored</h2>
      <p>Our database is hosted by Supabase in Canada (Montréal region). Our application server is hosted by Render in the United States. Email delivery uses Resend; push notifications use Apple and Google services via Expo; sign-up and sign-in may use Cloudflare Turnstile to block bots. Voice notes, screenshots and safety photos are stored privately and are only shared through short-lived links.</p>
      <h2>Retention</h2>
      <p>Attendance and payroll records are kept while your employer’s account is active and as long as required by the employment-standards record-keeping rules that apply to your employer. Deleted accounts are removed from backups within 30 days of expiry.</p>
      <h2>Your rights</h2>
      <p>You can ask your employer, or us at <a href="mailto:privacy@bluecollarshift.com">privacy@bluecollarshift.com</a>, for access to or correction of your personal information under the privacy laws that apply where you work.</p>
    </Legal>
  );
}

export function Terms() {
  useSeo('/terms');
  return (
    <Legal title="Terms of service" updated="November 27, 2026">
      <h2>The service</h2>
      <p>Blue Collar provides scheduling, attendance tracking, timesheet management, messaging and payroll preparation tools. Payroll figures are gross-pay estimates. Blue Collar does not calculate taxes or statutory deductions and is not a payroll remittance service.</p>
      <h2>Employer responsibilities</h2>
      <p>Employers are responsible for complying with the employment laws that apply to them, setting their overtime policy correctly (including exemptions), reviewing and approving timesheets, and paying employees correctly.</p>
      <h2>Acceptable use</h2>
      <p>No attempts to access another company’s data, bypass security, or misuse location or messaging features. Users must be at least 18 years old.</p>
      <h2>Availability and data</h2>
      <p>We work to keep the service available and data backed up, but the service is provided “as is”. You can export your data at any time.</p>
      <h2>Contact</h2>
      <p><a href="mailto:legal@bluecollarshift.com">legal@bluecollarshift.com</a></p>
    </Legal>
  );
}

export function SecurityPolicy() {
  useSeo('/security');
  return (
    <Legal title="Security & vulnerability disclosure" updated="November 27, 2026">
      <h2>How we protect your data</h2>
      <ul>
        <li>Every request is authenticated and authorised on our servers, and again by row-level security in the database.</li>
        <li>Each company’s data is isolated. Original attendance records and audit logs cannot be modified.</li>
        <li>Platform administrators must use two-step verification. Support access is time-limited and audited.</li>
        <li>Encryption in transit (TLS) and at rest. Automated backups with point-in-time recovery.</li>
      </ul>
      <h2>Report a vulnerability</h2>
      <p>Email <a href="mailto:security@bluecollarshift.com">security@bluecollarshift.com</a> with steps to reproduce. Please do not access other customers’ data, degrade the service, or publicly disclose before we have fixed the issue. We aim to acknowledge reports within 2 business days and fix critical issues within 7 days. We will not take legal action against good-faith research that follows this policy.</p>
      <p>Machine-readable contact: <a href="/.well-known/security.txt">/.well-known/security.txt</a></p>
    </Legal>
  );
}

export function NotFound() {
  return <Section><h1>Page not found</h1><p><Link to="/">Go to the home page</Link></p></Section>;
}

import { Link, Route, Routes, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { Home, Features, Pricing, Contact, Privacy, Terms, SecurityPolicy, NotFound } from '../pages/public/Pages';
import { appUrl } from '../lib/surface';
import '../styles/public.css';

/** Public website. Pre-rendered to static HTML at build time (scripts/prerender.mjs). No auth code is loaded here. */
export function PublicRoutes() {
  return (
    <Routes>
      <Route index element={<Home />} />
      <Route path="features" element={<Features />} />
      <Route path="pricing" element={<Pricing />} />
      <Route path="contact" element={<Contact />} />
      <Route path="privacy" element={<Privacy />} />
      <Route path="terms" element={<Terms />} />
      <Route path="security" element={<SecurityPolicy />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

export function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="pub">
      <a href="#content" className="sr-only">Skip to content</a>
      <header className="pub-header">
        <Link to="/" className="pub-brand"><img src="/brand/logo.svg" alt="" width={44} height={44} /><span>Blue Collar</span></Link>
        <nav aria-label="Primary">
          <Link to="/features">Features</Link>
          <Link to="/pricing">Pricing</Link>
          <Link to="/contact">Contact</Link>
          <a href={appUrl('/login')}>Sign in</a>
          <a className="pub-cta" href={appUrl('/signup')}>Start free</a>
        </nav>
      </header>
      <main id="content">{children}</main>
      <footer className="pub-footer">
        <div>
          <strong>Blue Collar</strong>
          <p>Scheduling, GPS attendance and payroll preparation for the trades. Built in Alberta.</p>
        </div>
        <nav aria-label="Footer">
          <Link to="/privacy">Privacy</Link>
          <Link to="/terms">Terms</Link>
          <Link to="/security">Security</Link>
          <Link to="/contact">Contact</Link>
        </nav>
        <p className="pub-legal">© {new Date().getFullYear()} Blue Collar. All rights reserved.</p>
      </footer>
    </div>
  );
}

export default function PublicSite() {
  const loc = useLocation();
  useEffect(() => window.scrollTo(0, 0), [loc.pathname]);
  return (
    <PublicLayout>
      <PublicRoutes />
    </PublicLayout>
  );
}

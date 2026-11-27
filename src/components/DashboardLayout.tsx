import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { onConnectionChange, getSocket } from '../lib/realtime';
import { t } from '../i18n';
import { LanguagePicker } from './LanguagePicker';
import { FeedbackDialog } from './FeedbackDialog';
import '../styles/dashboard.css';

export interface NavItem {
  label: string;
  to: string;
  end?: boolean;
  count?: number;
}

export function DashboardLayout({ subtitle, navItems, children, showCompanySwitch = true }: { subtitle: string; navItems: NavItem[]; children: ReactNode; showCompanySwitch?: boolean }) {
  const { me, membership, selectCompany, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const [online, setOnline] = useState(false);
  const [feedback, setFeedback] = useState(false);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);
  useEffect(() => {
    getSocket();
    return onConnectionChange(setOnline);
  }, []);

  return (
    <div className="bc-shell">
      <aside className={`bc-sidebar ${open ? 'open' : ''}`} aria-label="Main navigation">
        <a className="bc-sidebar-brand" href="/">
          <img src="/brand/logo-white.svg" alt="" width={40} height={40} />
          <div>
            <strong>{t('app.name')}</strong>
            <span>{subtitle}</span>
          </div>
        </a>
        {showCompanySwitch && me && me.memberships.length > 1 && (
          <div className="bc-company-select">
            <label className="sr-only" htmlFor="company-switch">Company</label>
            <select id="company-switch" value={membership?.companyId} onChange={(e) => selectCompany(e.target.value)}>
              {me.memberships.map((m) => (
                <option key={m.companyId} value={m.companyId}>{m.companyName}</option>
              ))}
            </select>
          </div>
        )}
        <nav className="bc-nav">
          {navItems.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => (isActive ? 'active' : '')}>
              <span>{item.label}</span>
              {!!item.count && <span className="bc-count">{item.count}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="bc-sidebar-footer">
          {me && (
            <>
              <strong>{me.fullName || me.email}</strong>
              <span>{membership ? `${membership.companyName} · ${t(`role.${membership.role}`)}` : me.email}</span>
            </>
          )}
          <span className={`bc-connection ${online ? 'online' : ''}`} style={{ display: 'flex', marginTop: 8, color: '#9fbccb' }}>
            {online ? t('common.online') : t('common.offline')}
          </span>
          <LanguagePicker signedIn />
          <button className="bc-btn secondary small" onClick={() => setFeedback(true)}>💬 {t('feedback.open')}</button>
          <button className="bc-btn secondary small" onClick={() => void signOut()}>{t('common.sign_out')}</button>
        </div>
      </aside>
      <main className="bc-main" id="main">
        <button className="bc-btn secondary small bc-menu-toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open} style={{ marginBottom: 12 }}>
          ☰ {t('common.menu')}
        </button>
        {children}
      </main>
      {feedback && <FeedbackDialog companyId={membership?.companyId ?? null} onClose={() => setFeedback(false)} />}
    </div>
  );
}

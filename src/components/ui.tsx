import { useEffect, useRef, type ReactNode } from 'react';
import { t, type MessageKey } from '../i18n';

export function Page({ title, subtitle, actions, children }: { title: string; subtitle?: string; actions?: ReactNode; children: ReactNode }) {
  useEffect(() => {
    document.title = `${title} · Blue Collar`;
  }, [title]);
  return (
    <>
      <div className="bc-topbar">
        <div>
          <h1>{title}</h1>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {actions && <div className="bc-actions">{actions}</div>}
      </div>
      {children}
    </>
  );
}

export function Card({ title, actions, children }: { title?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="bc-card">
      {(title || actions) && (
        <div className="bc-card-header">
          {title && <h2>{title}</h2>}
          {actions && <div className="bc-actions">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Alert({ kind = 'info', children }: { kind?: 'info' | 'error' | 'success' | 'warning'; children: ReactNode }) {
  return (
    <div className={`bc-alert ${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}

export function Loading({ label }: { label?: string }) {
  return (
    <div className="bc-loading" role="status" aria-live="polite">
      <div className="bc-spinner" aria-hidden />
      {label ?? t('common.loading')}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="bc-empty">
      <strong>{title}</strong>
      {children}
    </div>
  );
}

export function Field({ label, hint, error, children, htmlFor }: { label: string; hint?: string; error?: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="bc-field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && <span className="bc-hint">{hint}</span>}
      {error && <span className="bc-field-error">{error}</span>}
    </div>
  );
}

export function Badge({ kind, children }: { kind?: 'success' | 'warning' | 'error' | 'info'; children: ReactNode }) {
  return <span className={`bc-badge ${kind ?? ''}`}>{children}</span>;
}

const REVIEW_FLAGS = new Set(['outside_geofence', 'out_of_order', 'duplicate_clock_in', 'no_open_session', 'device_clock_skew', 'break_not_started', 'not_assigned_to_shift', 'deactivated_while_open']);
export function Flags({ flags }: { flags: string[] }) {
  if (!flags?.length) return null;
  return (
    <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
      {flags.map((f) => (
        <Badge key={f} kind={REVIEW_FLAGS.has(f) ? 'warning' : 'info'}>
          {t(`flag.${f}` as MessageKey)}
        </Badge>
      ))}
    </span>
  );
}

export function SessionStatus({ status, approval }: { status: string; approval: string }) {
  if (status === 'open') return <Badge kind="info">{t('ts.status_open')}</Badge>;
  return (
    <span style={{ display: 'inline-flex', gap: 4 }}>
      {status === 'needs_review' && <Badge kind="warning">{t('ts.status_needs_review')}</Badge>}
      <Badge kind={approval === 'approved' ? 'success' : approval === 'rejected' ? 'error' : undefined}>{t(`ts.approval_${approval}` as MessageKey)}</Badge>
    </span>
  );
}

/** Accessible dialog: focus trap-lite, Escape to close, restores focus. */
export function Drawer({ title, onClose, children, center }: { title: string; onClose: () => void; children: ReactNode; center?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      prev?.focus();
    };
  }, [onClose]);
  return (
    <div className={`bc-overlay ${center ? 'bc-modal-center' : ''}`} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={center ? 'bc-modal' : 'bc-drawer'} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}>
        <div className="bc-drawer-header">
          <h2 style={{ fontSize: 20 }}>{title}</h2>
          <button className="bc-btn ghost small" onClick={onClose} aria-label={t('common.close')}>
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Logo({ size = 40, white = false }: { size?: number; white?: boolean }) {
  return <img src={white ? '/brand/logo-white.svg' : '/brand/logo.svg'} alt="Blue Collar" width={size} height={size} />;
}

import { useState } from 'react';
import { useApi } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import { errorMessage, post } from '../../lib/api';
import { fmtDate } from '../../lib/format';
import { t } from '../../i18n';
import { Alert, Badge, Drawer, Field, Loading } from '../../components/ui';

interface Detail {
  id: string; name: string; phone: string | null; address: string | null; timezone: string; status: string; suspended_reason: string | null; created_at: string;
  usage: { members: number; sites: number; shifts_30d: number; events_30d: number };
  owners: { full_name: string; email: string; role: string }[];
}

/** Registration info and usage only — never payroll, hours or messages. */
export default function CompanyDetail({ id, onClose, onChanged, critical }: { id: string; onClose: () => void; onChanged: () => void; critical: (run: () => Promise<void>) => Promise<boolean> }) {
  const { me } = useAuth();
  const { data, error, loading, reload } = useApi<Detail>(`/admin/companies/${id}`, [id]);
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const canManage = me?.platform?.permissions.includes('platform.companies.manage');

  async function setStatus(status: 'active' | 'suspended') {
    setMsg(null);
    try {
      const ok = await critical(() => post(`/admin/companies/${id}/status`, { status, reason }).then(() => undefined));
      if (ok) {
        setReason('');
        await reload();
        onChanged();
      }
    } catch (e) {
      setMsg(errorMessage(e));
    }
  }

  return (
    <Drawer title={data?.name ?? t('common.loading')} onClose={onClose}>
      {error && <Alert kind="error">{error}</Alert>}
      {msg && <Alert kind="error">{msg}</Alert>}
      {loading && !data ? <Loading /> : data && (
        <>
          <p><Badge kind={data.status === 'active' ? 'success' : 'error'}>{data.status}</Badge> {data.suspended_reason && <span className="bc-muted">— {data.suspended_reason}</span>}</p>
          <p className="bc-muted">{data.address ?? '—'} · {data.phone ?? '—'} · {data.timezone} · created {fmtDate(data.created_at)}</p>
          <div className="bc-grid cols-2">
            <div className="bc-stat"><span>Members</span><strong>{data.usage.members}</strong></div>
            <div className="bc-stat"><span>Job sites</span><strong>{data.usage.sites}</strong></div>
            <div className="bc-stat"><span>Shifts (30d)</span><strong>{data.usage.shifts_30d}</strong></div>
            <div className="bc-stat"><span>Clock events (30d)</span><strong>{data.usage.events_30d}</strong></div>
          </div>
          <h3 style={{ fontSize: 16, margin: '16px 0 8px' }}>Owners & administrators</h3>
          <ul>{data.owners.map((o) => <li key={o.email}>{o.full_name} — {o.email} ({o.role})</li>)}</ul>
          {canManage && (
            <>
              <Field label={t('admin.suspend_reason')} htmlFor="reason"><textarea id="reason" minLength={5} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
              <div className="bc-actions">
                {data.status === 'active'
                  ? <button className="bc-btn danger" disabled={reason.trim().length < 5} onClick={() => void setStatus('suspended')}>{t('admin.suspend')}</button>
                  : <button className="bc-btn" disabled={reason.trim().length < 5} onClick={() => void setStatus('active')}>{t('admin.restore')}</button>}
              </div>
            </>
          )}
        </>
      )}
    </Drawer>
  );
}

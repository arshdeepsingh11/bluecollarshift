import { Fragment, useState } from 'react';
import { useApi } from '../../hooks/useApi';
import { fmtDateTime } from '../../lib/format';
import { t } from '../../i18n';
import { Alert, Badge, Card, Field, Loading, Page } from '../../components/ui';

interface Row { id: number; company_id: string | null; actor_type: string; action: string; target_type: string | null; target_id: string | null; metadata: unknown; ip: string | null; request_id: string | null; success: boolean; created_at: string; actor_email: string | null }

/** Read-only. Audit records are append-only in the database for every role. */
export default function AuditLog() {
  const [action, setAction] = useState('');
  const [q, setQ] = useState('');
  const { data, error, loading } = useApi<{ items: Row[] }>(`/admin/audit?limit=200${q ? `&action=${encodeURIComponent(q)}` : ''}`, [q]);
  const [open, setOpen] = useState<number | null>(null);
  return (
    <Page title={t('nav.admin_audit')}>
      {error && <Alert kind="error">{error}</Alert>}
      <Card>
        <form className="bc-row" onSubmit={(e) => { e.preventDefault(); setQ(action); }}>
          <Field label="Action prefix" htmlFor="ap"><input id="ap" placeholder="platform. / timesheet. / payroll." value={action} onChange={(e) => setAction(e.target.value)} /></Field>
          <button className="bc-btn" style={{ marginBottom: 16 }}>{t('common.search')}</button>
        </form>
        {loading && !data ? <Loading /> : (
          <div className="bc-table-wrap">
            <table className="bc-table">
              <thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Target</th><th>IP</th><th /></tr></thead>
              <tbody>{data?.items.map((r) => (
                <Fragment key={r.id}>
                  <tr className="clickable" onClick={() => setOpen(open === r.id ? null : r.id)}>
                    <td className="bc-muted">{fmtDateTime(r.created_at)}</td>
                    <td>{r.actor_email ?? r.actor_type}</td>
                    <td><code>{r.action}</code></td>
                    <td className="bc-muted">{r.target_type} {r.target_id?.slice(0, 8)}</td>
                    <td className="bc-muted">{r.ip ?? '—'}</td>
                    <td>{r.success ? <Badge kind="success">ok</Badge> : <Badge kind="error">denied</Badge>}</td>
                  </tr>
                  {open === r.id && <tr><td colSpan={6}><pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, margin: 0 }}>{JSON.stringify({ company: r.company_id, request: r.request_id, metadata: r.metadata }, null, 2)}</pre></td></tr>}
                </Fragment>
              ))}</tbody>
            </table>
          </div>
        )}
      </Card>
    </Page>
  );
}

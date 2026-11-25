import { useState } from 'react';
import { useApi } from '../../hooks/useApi';
import { fmtDateTime } from '../../lib/format';
import { t } from '../../i18n';
import { Alert, Badge, Card, Loading, Page } from '../../components/ui';

interface Ev { id: number; user_id: string | null; type: string; severity: 'info' | 'warning' | 'critical'; ip: string | null; metadata: unknown; created_at: string }

export default function Security() {
  const [severity, setSeverity] = useState('all');
  const { data, error, loading } = useApi<{ items: Ev[]; last24h: { type: string; n: number }[] }>(`/admin/security-events?severity=${severity}`, [severity]);
  return (
    <Page title={t('nav.admin_security')} actions={
      <select className="bc-input" style={{ width: 'auto' }} value={severity} onChange={(e) => setSeverity(e.target.value)}>
        <option value="all">{t('common.all')}</option><option value="warning">warning</option><option value="critical">critical</option><option value="info">info</option>
      </select>
    }>
      {error && <Alert kind="error">{error}</Alert>}
      {loading && !data ? <Loading /> : data && (
        <>
          <div className="bc-grid cols-4">{data.last24h.map((s) => <div key={s.type} className="bc-stat"><span>{s.type} (24h)</span><strong>{s.n}</strong></div>)}</div>
          <Card>
            <table className="bc-table">
              <thead><tr><th>When</th><th>Type</th><th>Severity</th><th>IP</th><th>Details</th></tr></thead>
              <tbody>{data.items.map((e) => (
                <tr key={e.id}>
                  <td className="bc-muted">{fmtDateTime(e.created_at)}</td>
                  <td><code>{e.type}</code></td>
                  <td><Badge kind={e.severity === 'critical' ? 'error' : e.severity === 'warning' ? 'warning' : undefined}>{e.severity}</Badge></td>
                  <td className="bc-muted">{e.ip ?? '—'}</td>
                  <td className="bc-muted" style={{ fontSize: 12 }}>{JSON.stringify(e.metadata)}</td>
                </tr>
              ))}</tbody>
            </table>
          </Card>
        </>
      )}
    </Page>
  );
}

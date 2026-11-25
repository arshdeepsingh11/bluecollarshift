import { useState } from 'react';
import type { Dispute } from '@bluecollar/shared';
import { useApi } from '../../hooks/useApi';
import { useAuth, useMembership } from '../../hooks/useAuth';
import { fmtDateTime } from '../../lib/format';
import { t } from '../../i18n';
import { Alert, Badge, Card, Empty, Loading, Page } from '../../components/ui';
import { TimesheetDetail } from '../../components/TimesheetDetail';

export default function Disputes() {
  const m = useMembership();
  const { can } = useAuth();
  const [status, setStatus] = useState('open');
  const { data, error, loading, reload } = useApi<{ items: Dispute[] }>(`/companies/${m.companyId}/disputes?status=${status}`, [m.companyId, status]);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <Page title={t('disputes.title')} actions={
      <select className="bc-input" style={{ width: 'auto' }} value={status} onChange={(e) => setStatus(e.target.value)}>
        <option value="open">Open</option><option value="resolved">{t('disputes.resolved')}</option><option value="rejected">{t('disputes.rejected')}</option><option value="all">{t('common.all')}</option>
      </select>
    }>
      {error && <Alert kind="error">{error}</Alert>}
      <Card>
        {loading && !data ? <Loading /> : !data?.items.length ? <Empty title={t('disputes.none')} /> : (
          <table className="bc-table">
            <tbody>
              {data.items.map((d) => (
                <tr key={d.id} className="clickable" onClick={() => setOpen(d.sessionId)}>
                  <td><strong>{d.raisedBy.fullName}</strong><div className="bc-muted">{fmtDateTime(d.createdAt)}</div></td>
                  <td>{d.explanation}</td>
                  <td><Badge kind={d.status === 'open' ? 'warning' : 'success'}>{d.status}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {open && <TimesheetDetail companyId={m.companyId} sessionId={open} onClose={() => setOpen(null)} onChanged={() => void reload()}
        mode={{ canAdjust: can('timesheets.adjust'), canApprove: can('timesheets.approve'), canResolve: can('disputes.resolve'), isOwn: false }} />}
    </Page>
  );
}

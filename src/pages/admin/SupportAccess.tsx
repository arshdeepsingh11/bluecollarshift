import { useApi } from '../../hooks/useApi';
import { fmtDateTime } from '../../lib/format';
import { t } from '../../i18n';
import { Alert, Badge, Card, Empty, Loading, Page } from '../../components/ui';

interface Grant { id: string; company_name: string; staff_email: string; reason: string; expires_at: string; revoked_at: string | null; created_at: string }

export default function SupportAccess() {
  const { data, error, loading } = useApi<{ items: Grant[] }>('/admin/support-access');
  return (
    <Page title={t('nav.admin_support')} subtitle="Every support access is time-limited, requires a reason, and is audited.">
      {error && <Alert kind="error">{error}</Alert>}
      <Card>
        {loading && !data ? <Loading /> : !data?.items.length ? <Empty title={t('common.none')} /> : (
          <table className="bc-table">
            <thead><tr><th>Company</th><th>Staff</th><th>{t('common.reason')}</th><th>Granted</th><th>Expires</th></tr></thead>
            <tbody>{data.items.map((g) => (
              <tr key={g.id}>
                <td>{g.company_name}</td><td>{g.staff_email}</td><td>{g.reason}</td><td className="bc-muted">{fmtDateTime(g.created_at)}</td>
                <td>{Date.parse(g.expires_at) > Date.now() && !g.revoked_at ? <Badge kind="warning">{fmtDateTime(g.expires_at)}</Badge> : <Badge>expired</Badge>}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </Card>
    </Page>
  );
}

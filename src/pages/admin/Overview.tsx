import { useApi } from '../../hooks/useApi';
import { fmtDateTime } from '../../lib/format';
import { t } from '../../i18n';
import { Alert, Badge, Card, Loading, Page } from '../../components/ui';

interface OverviewData {
  companies: number; active_companies: number; suspended_companies: number; users: number; employers: number; employees: number;
  active_users_24h: number; events_24h: number; flagged_events_24h: number; failed_push_24h: number; security_warnings_24h: number;
  recentCompanies: { id: string; name: string; status: string; created_at: string }[];
  jobs: { job: string; status: string; started_at: string; error: string | null }[];
}
interface Metrics { uptimeSeconds: number; memoryMb: number; database: { latencyMs: number; pool: { total: number; idle: number; waiting: number } }; routes: { route: string; count: number; errors: number; p50: number; p95: number }[] }

export default function AdminOverview() {
  const { data, error, loading } = useApi<OverviewData>('/admin/overview');
  const metrics = useApi<Metrics>('/ops/metrics');
  const stats: [string, number | undefined, string?][] = [
    ['Companies', data?.companies], ['Active', data?.active_companies], ['Suspended', data?.suspended_companies, 'warn'],
    ['Users', data?.users], ['Employers', data?.employers], ['Employees', data?.employees], ['Active users (24h)', data?.active_users_24h],
    ['Clock events (24h)', data?.events_24h], ['Flagged events (24h)', data?.flagged_events_24h, 'warn'], ['Failed push (24h)', data?.failed_push_24h, 'bad'],
    ['Security warnings (24h)', data?.security_warnings_24h, 'bad'],
  ];
  return (
    <Page title={t('nav.admin_overview')} subtitle={t('admin.no_company_data')}>
      {error && <Alert kind="error">{error}</Alert>}
      {loading && !data ? <Loading /> : data && (
        <>
          <div className="bc-grid cols-4">
            {stats.map(([label, v, tone]) => <div key={label} className={`bc-stat ${v && tone ? tone : ''}`}><span>{label}</span><strong>{v ?? 0}</strong></div>)}
          </div>
          <div className="bc-grid cols-2" style={{ marginTop: 16 }}>
            <Card title="Background jobs">
              <table className="bc-table"><tbody>{data.jobs.map((j) => (
                <tr key={j.job}><td><code>{j.job}</code></td><td><Badge kind={j.status === 'succeeded' ? 'success' : j.status === 'failed' ? 'error' : 'info'}>{j.status}</Badge></td><td className="bc-muted">{fmtDateTime(j.started_at)}</td></tr>
              ))}</tbody></table>
            </Card>
            <Card title="System health">
              {metrics.data ? (
                <>
                  <p>DB latency <strong>{metrics.data.database.latencyMs} ms</strong> · pool {metrics.data.database.pool.total} (idle {metrics.data.database.pool.idle}, waiting {metrics.data.database.pool.waiting}) · memory {metrics.data.memoryMb} MB · uptime {Math.round(metrics.data.uptimeSeconds / 3600)} h</p>
                  <table className="bc-table"><thead><tr><th>Route</th><th className="num">Count</th><th className="num">5xx</th><th className="num">p95 ms</th></tr></thead>
                    <tbody>{metrics.data.routes.slice(0, 12).map((r) => <tr key={r.route}><td><code>{r.route}</code></td><td className="num">{r.count}</td><td className="num">{r.errors}</td><td className="num">{r.p95}</td></tr>)}</tbody></table>
                </>
              ) : <Loading />}
            </Card>
          </div>
        </>
      )}
    </Page>
  );
}

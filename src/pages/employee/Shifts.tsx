import type { Shift } from '@bluecollar/shared';
import { useApi } from '../../hooks/useApi';
import { useMembership } from '../../hooks/useAuth';
import { fmtDateTime, fmtTime, fmtWeekday } from '../../lib/format';
import { t } from '../../i18n';
import { Alert, Badge, Card, Empty, Loading, Page } from '../../components/ui';

export default function MyShifts() {
  const m = useMembership();
  const from = new Date(Date.now() - 7 * 86400_000).toISOString();
  const to = new Date(Date.now() + 28 * 86400_000).toISOString();
  const { data, error, loading } = useApi<{ items: Shift[] }>(`/companies/${m.companyId}/shifts?mine=true&from=${from}&to=${to}`, [m.companyId]);
  const upcoming = data?.items.filter((s) => Date.parse(s.endsAt) > Date.now()) ?? [];
  const past = data?.items.filter((s) => Date.parse(s.endsAt) <= Date.now()).reverse() ?? [];
  return (
    <Page title={t('nav.my_shifts')}>
      {error && <Alert kind="error">{error}</Alert>}
      {loading && !data ? <Loading /> : (
        <>
          <Card title={t('emp.next_shift')}>
            {!upcoming.length ? <Empty title={t('emp.no_shift')} /> : (
              <table className="bc-table"><tbody>{upcoming.map((s) => (
                <tr key={s.id}>
                  <td><strong>{fmtWeekday(s.startsAt)}</strong><div className="bc-muted">{fmtTime(s.startsAt)} – {fmtTime(s.endsAt)}</div></td>
                  <td>{s.siteName}{s.instructions && <div className="bc-muted">{s.instructions}</div>}</td>
                  <td>{s.status === 'cancelled' && <Badge kind="error">{t('schedule.cancelled')}</Badge>}</td>
                </tr>
              ))}</tbody></table>
            )}
          </Card>
          {past.length > 0 && (
            <Card title="Past 7 days">
              <table className="bc-table"><tbody>{past.map((s) => <tr key={s.id}><td>{fmtDateTime(s.startsAt)}</td><td>{s.siteName}</td></tr>)}</tbody></table>
            </Card>
          )}
        </>
      )}
    </Page>
  );
}

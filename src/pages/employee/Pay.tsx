import { useState } from 'react';
import type { PayrollRecord } from '@bluecollar/shared';
import { useApi } from '../../hooks/useApi';
import { useMembership } from '../../hooks/useAuth';
import { fmtDate, fmtHours, fmtMoney } from '../../lib/format';
import { t } from '../../i18n';
import { Alert, Badge, Card, Empty, Loading, Page } from '../../components/ui';
import { TraceDrawer } from '../employer/Pay';

type MyRecord = PayrollRecord & { startsOn: string; endsOn: string; payDate: string };

export default function MyPay() {
  const m = useMembership();
  const { data, error, loading } = useApi<{ items: MyRecord[] }>(`/companies/${m.companyId}/my-pay`, [m.companyId]);
  const [trace, setTrace] = useState<MyRecord | null>(null);
  return (
    <Page title={t('nav.my_pay')}>
      <Alert kind="info">{t('payroll.disclaimer')}</Alert>
      {error && <Alert kind="error">{error}</Alert>}
      <Card>
        {loading && !data ? <Loading /> : !data?.items.length ? <Empty title={t('payroll.none')} /> : (
          <table className="bc-table">
            <thead><tr><th>{t('common.date')}</th><th className="num">{t('payroll.regular')}</th><th className="num">{t('payroll.overtime')}</th><th className="num">{t('payroll.gross')}</th><th>{t('common.status')}</th><th /></tr></thead>
            <tbody>
              {data.items.map((r) => (
                <tr key={r.id}>
                  <td>{fmtDate(r.startsOn)} – {fmtDate(r.endsOn)}<div className="bc-muted">{t('payroll.pay_date')}: {fmtDate(r.payDate)}</div></td>
                  <td className="num">{fmtHours(r.regularMinutes)}h</td>
                  <td className="num">{fmtHours(r.overtimeMinutes)}h</td>
                  <td className="num"><strong>{fmtMoney(r.grossTotalCents)}</strong></td>
                  <td><Badge kind={r.status === 'paid' ? 'success' : 'info'}>{r.status}</Badge></td>
                  <td className="num"><button className="bc-btn ghost small" onClick={() => setTrace(r)}>{t('payroll.trace')}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {trace && <TraceDrawer record={trace} onClose={() => setTrace(null)} />}
    </Page>
  );
}

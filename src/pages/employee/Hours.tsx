import { useState } from 'react';
import type { WorkSession } from '@bluecollar/shared';
import { useApi } from '../../hooks/useApi';
import { useMembership } from '../../hooks/useAuth';
import { fmtDateTime, fmtMinutes, today } from '../../lib/format';
import { t } from '../../i18n';
import { Alert, Card, Empty, Field, Flags, Loading, Page, SessionStatus } from '../../components/ui';
import { TimesheetDetail } from '../../components/TimesheetDetail';

/** Employees see original AND adjusted times, who changed them and why, and can dispute. */
export default function MyHours() {
  const m = useMembership();
  const [range, setRange] = useState({ from: today(-30), to: today() });
  const { data, error, loading, reload } = useApi<{ items: WorkSession[] }>(`/companies/${m.companyId}/timesheets?from=${range.from}&to=${range.to}`, [m.companyId, range.from, range.to]);
  const [open, setOpen] = useState<string | null>(null);
  const total = data?.items.reduce((s, x) => s + (x.paidMinutes ?? 0), 0) ?? 0;
  return (
    <Page title={t('nav.my_hours')} subtitle={`${fmtMinutes(total)}`}>
      {error && <Alert kind="error">{error}</Alert>}
      <Card>
        <div className="bc-row">
          <Field label={t('common.from')} htmlFor="hf"><input id="hf" type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></Field>
          <Field label={t('common.to')} htmlFor="ht"><input id="ht" type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></Field>
        </div>
        {loading && !data ? <Loading /> : !data?.items.length ? <Empty title={t('ts.none')} /> : (
          <table className="bc-table">
            <thead><tr><th>{t('ts.effective')}</th><th className="num">{t('ts.paid')}</th><th>{t('common.status')}</th><th /></tr></thead>
            <tbody>
              {data.items.map((s) => (
                <tr key={s.id} className="clickable" onClick={() => setOpen(s.id)}>
                  <td>
                    {fmtDateTime(s.effectiveStart)} → {s.effectiveEnd ? fmtDateTime(s.effectiveEnd) : '…'}
                    {s.adjusted && <div className="bc-muted"><span className="bc-strike">{fmtDateTime(s.originalStart)} → {fmtDateTime(s.originalEnd)}</span> · {t('ts.adjust')}</div>}
                  </td>
                  <td className="num">{fmtMinutes(s.paidMinutes)}</td>
                  <td><SessionStatus status={s.status} approval={s.approvalStatus} /></td>
                  <td><Flags flags={s.flags.filter((f) => f !== 'offline_device_time')} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {open && <TimesheetDetail companyId={m.companyId} sessionId={open} onClose={() => setOpen(null)} onChanged={() => void reload()} mode={{ canAdjust: false, canApprove: false, canResolve: false, isOwn: true }} />}
    </Page>
  );
}

import { useState, type FormEvent } from 'react';
import type { PayPeriod, PayrollRecord } from '@bluecollar/shared';
import { useApi } from '../../hooks/useApi';
import { useAuth, useMembership } from '../../hooks/useAuth';
import { download, errorMessage, post } from '../../lib/api';
import { fmtDate, fmtHours, fmtMoney, today } from '../../lib/format';
import { t, type MessageKey } from '../../i18n';
import { Alert, Badge, Card, Drawer, Empty, Field, Loading, Page } from '../../components/ui';

export default function Pay() {
  const [format, setFormat] = useState('generic');
  const m = useMembership();
  const { can } = useAuth();
  const base = `/companies/${m.companyId}`;
  const periods = useApi<{ items: PayPeriod[] }>(`${base}/pay-periods`, [m.companyId]);
  const [periodId, setPeriodId] = useState<string | null>(null);
  const current = periods.data?.items.find((p) => p.id === periodId) ?? periods.data?.items[0] ?? null;
  const records = useApi<{ items: PayrollRecord[] }>(current ? `${base}/pay-periods/${current.id}/records` : null, [current?.id]);
  const [creating, setCreating] = useState(false);
  const [trace, setTrace] = useState<PayrollRecord | null>(null);
  const [msg, setMsg] = useState<{ kind: 'error' | 'success' | 'warning'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function act(path: string) {
    if (!current) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await post<{ warnings?: { fullName: string; message: string }[] }>(`${base}/pay-periods/${current.id}/${path}`);
      if (r?.warnings?.length) setMsg({ kind: 'warning', text: r.warnings.map((w) => `${w.fullName}: ${w.message}`).join(' · ') });
      await periods.reload();
      await records.reload();
    } catch (e) {
      setMsg({ kind: 'error', text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page title={t('payroll.title')} actions={can('payroll.manage') && <button className="bc-btn" onClick={() => setCreating(true)}>{t('payroll.new_period')}</button>}>
      <Alert kind="info">{t('payroll.disclaimer')}</Alert>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      {periods.loading && !periods.data ? <Loading /> : !periods.data?.items.length ? <Card><Empty title={t('payroll.none')} /></Card> : (
        <>
          <Card>
            <div className="bc-row">
              <Field label={t('payroll.title')} htmlFor="pp">
                <select id="pp" value={current?.id} onChange={(e) => setPeriodId(e.target.value)}>
                  {periods.data.items.map((p) => <option key={p.id} value={p.id}>{fmtDate(p.startsOn)} – {fmtDate(p.endsOn)} ({t(`payroll.status_${p.status}` as MessageKey)})</option>)}
                </select>
              </Field>
              {current && can('payroll.manage') && (
                <div className="bc-actions" style={{ marginBottom: 16 }}>
                  {(current.status === 'open' || current.status === 'calculated') && <button className="bc-btn secondary" disabled={busy} onClick={() => void act('calculate')}>{current.status === 'open' ? t('payroll.calculate') : t('payroll.recalculate')}</button>}
                  {current.status === 'calculated' && <button className="bc-btn" disabled={busy} onClick={() => void act('approve')}>{t('payroll.approve')}</button>}
                  {current.status === 'approved' && <button className="bc-btn" disabled={busy} onClick={() => window.confirm(t('payroll.mark_paid') + '?') && void act('mark-paid')}>{t('payroll.mark_paid')}</button>}
                </div>
              )}
              {current && (
                <div className="bc-actions" style={{ marginBottom: 16, justifyContent: 'flex-start' }}>
                  <label className="sr-only" htmlFor="xfmt">{t('payroll.export_format')}</label>
                  <select id="xfmt" value={format} onChange={(e) => setFormat(e.target.value)} style={{ width: 'auto' }}>
                    {(['generic', 'adp', 'gusto', 'quickbooks', 'wagepoint'] as const).map((f) => <option key={f} value={f}>{t(`payroll.export_${f}`)}</option>)}
                  </select>
                  <button className="bc-btn secondary" onClick={async () => {
                    try { await download(`${base}/pay-periods/${current.id}/export.csv?format=${format}`, `payroll-${current.startsOn}-${format}.csv`); }
                    catch (e) { setMsg({ kind: 'error', text: errorMessage(e) }); }
                  }}>{t('payroll.export')}</button>
                </div>
              )}
              {current && <p className="bc-muted" style={{ marginTop: -8 }}>{t(`payroll.export_${format as 'generic'}_hint`)}</p>}
            </div>
            {current && (
              <div className="bc-grid cols-4">
                <div className="bc-stat"><span>{t('payroll.pay_date')}</span><strong style={{ fontSize: 20 }}>{fmtDate(current.payDate)}</strong></div>
                <div className="bc-stat"><span>{t('payroll.regular')}</span><strong>{fmtHours(current.totals.regularMinutes)}h</strong></div>
                <div className="bc-stat"><span>{t('payroll.overtime')}</span><strong>{fmtHours(current.totals.overtimeMinutes)}h</strong></div>
                <div className="bc-stat"><span>{t('payroll.gross')}</span><strong>{fmtMoney(current.totals.grossCents)}</strong></div>
              </div>
            )}
          </Card>
          <Card>
            {records.loading && !records.data ? <Loading /> : !records.data?.items.length ? <Empty title={t('payroll.calculate')} /> : (
              <div className="bc-table-wrap">
                <table className="bc-table">
                  <thead><tr><th>{t('ts.employee')}</th><th className="num">{t('payroll.regular')}</th><th className="num">{t('payroll.overtime')}</th><th className="num">{t('payroll.rate')}</th><th className="num">{t('payroll.gross')}</th><th>{t('common.status')}</th><th /></tr></thead>
                  <tbody>
                    {records.data.items.map((r) => (
                      <tr key={r.id}>
                        <td><strong>{r.employeeName}</strong>{r.pendingSessions > 0 && <div><Badge kind="warning">{r.pendingSessions} {t('payroll.pending_ts')}</Badge></div>}</td>
                        <td className="num">{fmtHours(r.regularMinutes)}</td>
                        <td className="num">{fmtHours(r.overtimeMinutes)}</td>
                        <td className="num">{fmtMoney(r.hourlyRateCents)}</td>
                        <td className="num"><strong>{fmtMoney(r.grossTotalCents)}</strong></td>
                        <td><Badge kind={r.status === 'paid' ? 'success' : r.status === 'approved' ? 'info' : undefined}>{r.status}</Badge></td>
                        <td className="num"><button className="bc-btn ghost small" onClick={() => setTrace(r)}>{t('payroll.trace')}</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
      {creating && <NewPeriod base={base} onClose={() => setCreating(false)} onDone={(id) => { setCreating(false); setPeriodId(id); void periods.reload(); }} />}
      {trace && <TraceDrawer record={trace} onClose={() => setTrace(null)} />}
    </Page>
  );
}

function NewPeriod({ base, onClose, onDone }: { base: string; onClose: () => void; onDone: (id: string) => void }) {
  const [f, setF] = useState({ startsOn: today(-13), endsOn: today(), payDate: today(5) });
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      const r = await post<{ id: string }>(`${base}/pay-periods`, f);
      onDone(r.id);
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  return (
    <Drawer title={t('payroll.new_period')} onClose={onClose} center>
      {error && <Alert kind="error">{error}</Alert>}
      <form onSubmit={submit}>
        <Field label={t('common.from')} htmlFor="pfrom"><input id="pfrom" type="date" required value={f.startsOn} onChange={(e) => setF({ ...f, startsOn: e.target.value })} /></Field>
        <Field label={t('common.to')} htmlFor="pto"><input id="pto" type="date" required value={f.endsOn} onChange={(e) => setF({ ...f, endsOn: e.target.value })} /></Field>
        <Field label={t('payroll.pay_date')} htmlFor="pdate"><input id="pdate" type="date" required value={f.payDate} onChange={(e) => setF({ ...f, payDate: e.target.value })} /></Field>
        <div className="bc-actions"><button className="bc-btn">{t('common.create')}</button></div>
      </form>
    </Drawer>
  );
}

interface Trace {
  days: { date: string; workedMinutes: number; dailyOvertimeMinutes: number }[];
  blocks: { start: string; end: string; workedMinutes: number; overtimeMinutes: number; rule: string }[];
  warnings: { message: string }[];
  ruleProfile: string;
}

export function TraceDrawer({ record, onClose }: { record: PayrollRecord; onClose: () => void }) {
  const tr = record.trace as Trace;
  return (
    <Drawer title={`${record.employeeName} · ${t('payroll.trace')}`} onClose={onClose}>
      <p className="bc-muted">{tr.ruleProfile} · {fmtMoney(record.hourlyRateCents)}/h · OT × {record.overtimeMultiplier}</p>
      {tr.warnings?.map((w, i) => <Alert key={i} kind="warning">{w.message}</Alert>)}
      <table className="bc-table">
        <thead><tr><th>{t('common.date')}</th><th className="num">{t('common.hours')}</th><th className="num">Daily OT</th></tr></thead>
        <tbody>{tr.days.map((d) => <tr key={d.date}><td>{fmtDate(d.date)}</td><td className="num">{fmtHours(d.workedMinutes)}</td><td className="num">{fmtHours(d.dailyOvertimeMinutes)}</td></tr>)}</tbody>
      </table>
      <h3 style={{ fontSize: 16, margin: '16px 0 8px' }}>Overtime</h3>
      <ul className="bc-timeline">
        {tr.blocks.map((b) => <li key={b.start}><strong>{fmtDate(b.start)} – {fmtDate(b.end)}</strong>: {fmtHours(b.workedMinutes)}h worked, {fmtHours(b.overtimeMinutes)}h OT<div className="bc-muted">{b.rule}</div></li>)}
      </ul>
      <div className="bc-compare" style={{ marginTop: 12 }}>
        <div><h4>{t('payroll.regular')}</h4>{fmtHours(record.regularMinutes)}h · {fmtMoney(record.grossRegularCents)}</div>
        <div><h4>{t('payroll.overtime')}</h4>{fmtHours(record.overtimeMinutes)}h · {fmtMoney(record.grossOvertimeCents)}</div>
      </div>
      <p><strong>{t('payroll.gross')}: {fmtMoney(record.grossTotalCents)}</strong></p>
    </Drawer>
  );
}

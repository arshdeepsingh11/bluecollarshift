import { useEffect, useState } from 'react';
import type { Member, WorkSession } from '@bluecollar/shared';
import { useApi } from '../../hooks/useApi';
import { useAuth, useMembership } from '../../hooks/useAuth';
import { errorMessage, post } from '../../lib/api';
import { getSocket } from '../../lib/realtime';
import { fmtDateTime, fmtMinutes, today } from '../../lib/format';
import { t } from '../../i18n';
import { Alert, Card, Empty, Field, Flags, Loading, Page, SessionStatus } from '../../components/ui';
import { TimesheetDetail } from '../../components/TimesheetDetail';

export default function Timesheets() {
  const m = useMembership();
  const { can } = useAuth();
  const base = `/companies/${m.companyId}`;
  const [q, setQ] = useState({ from: today(-14), to: today(), membershipId: '', approval: '' });
  const qs = new URLSearchParams({ from: q.from, to: q.to, ...(q.membershipId ? { membershipId: q.membershipId } : {}), ...(q.approval ? { approval: q.approval } : {}) });
  const list = useApi<{ items: WorkSession[] }>(`${base}/timesheets?${qs}`, [m.companyId, qs.toString()]);
  const members = useApi<{ items: Member[] }>(can('members.view') ? `${base}/members` : null, [m.companyId]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    const s = getSocket();
    const r = () => void list.reload();
    s.on('attendance:update', r);
    s.on('timesheet:changed', r);
    return () => {
      s.off('attendance:update', r);
      s.off('timesheet:changed', r);
    };
  }, [list]);

  async function approveSelected() {
    setMsg(null);
    try {
      const r = await post<{ updated: string[]; skipped: string[] }>(`${base}/timesheets/approve`, { sessionIds: [...selected], decision: 'approved' });
      setSelected(new Set());
      setMsg(`${r.updated.length} ✓${r.skipped.length ? ` · ${r.skipped.length} skipped` : ''}`);
      void list.reload();
    } catch (e) {
      setMsg(errorMessage(e));
    }
  }

  const items = list.data?.items ?? [];
  const selectable = items.filter((s) => s.status !== 'open' && s.membershipId !== m.membershipId);

  return (
    <Page title={t('ts.title')} actions={can('timesheets.approve') && selected.size > 0 && <button className="bc-btn" onClick={() => void approveSelected()}>{t('ts.approve_selected')} ({selected.size})</button>}>
      {msg && <Alert kind="info">{msg}</Alert>}
      {list.error && <Alert kind="error">{list.error}</Alert>}
      <Card>
        <div className="bc-row">
          <Field label={t('common.from')} htmlFor="tfrom"><input id="tfrom" type="date" value={q.from} onChange={(e) => setQ({ ...q, from: e.target.value })} /></Field>
          <Field label={t('common.to')} htmlFor="tto"><input id="tto" type="date" value={q.to} onChange={(e) => setQ({ ...q, to: e.target.value })} /></Field>
          <Field label={t('ts.employee')} htmlFor="tmem">
            <select id="tmem" value={q.membershipId} onChange={(e) => setQ({ ...q, membershipId: e.target.value })}>
              <option value="">{t('common.all')}</option>
              {members.data?.items.filter((p) => p.role === 'employee').map((p) => <option key={p.membershipId} value={p.membershipId}>{p.fullName}</option>)}
            </select>
          </Field>
          <Field label={t('common.status')} htmlFor="tappr">
            <select id="tappr" value={q.approval} onChange={(e) => setQ({ ...q, approval: e.target.value })}>
              <option value="">{t('common.all')}</option>
              <option value="pending">{t('ts.approval_pending')}</option>
              <option value="approved">{t('ts.approval_approved')}</option>
              <option value="rejected">{t('ts.approval_rejected')}</option>
            </select>
          </Field>
        </div>
      </Card>
      <Card>
        {list.loading && !list.data ? <Loading /> : !items.length ? <Empty title={t('ts.none')} /> : (
          <div className="bc-table-wrap">
            <table className="bc-table">
              <thead>
                <tr>
                  {can('timesheets.approve') && (
                    <th><input type="checkbox" aria-label="Select all" checked={selectable.length > 0 && selectable.every((s) => selected.has(s.id))}
                      onChange={(e) => setSelected(e.target.checked ? new Set(selectable.map((s) => s.id)) : new Set())} /></th>
                  )}
                  <th>{t('ts.employee')}</th><th>{t('ts.effective')}</th><th className="num">{t('ts.paid')}</th><th>{t('common.status')}</th><th>{t('ts.flags')}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((s) => (
                  <tr key={s.id} className="clickable" onClick={() => setOpen(s.id)}>
                    {can('timesheets.approve') && (
                      <td onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" aria-label={`Select ${s.employeeName}`} disabled={!selectable.includes(s)} checked={selected.has(s.id)}
                          onChange={(e) => { const n = new Set(selected); if (e.target.checked) n.add(s.id); else n.delete(s.id); setSelected(n); }} />
                      </td>
                    )}
                    <td><strong>{s.employeeName}</strong><div className="bc-muted">{s.siteName ?? '—'}</div></td>
                    <td>
                      {fmtDateTime(s.effectiveStart)} → {s.effectiveEnd ? fmtDateTime(s.effectiveEnd) : '…'}
                      {s.adjusted && <div className="bc-muted bc-strike">{fmtDateTime(s.originalStart)} → {fmtDateTime(s.originalEnd)}</div>}
                    </td>
                    <td className="num">{fmtMinutes(s.paidMinutes)}</td>
                    <td><SessionStatus status={s.status} approval={s.approvalStatus} />{s.openDisputes > 0 && <> <span className="bc-badge warning">{t('ts.dispute')}</span></>}</td>
                    <td><Flags flags={s.flags} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {open && (
        <TimesheetDetail companyId={m.companyId} sessionId={open} onClose={() => setOpen(null)} onChanged={() => void list.reload()}
          mode={{ canAdjust: can('timesheets.adjust'), canApprove: can('timesheets.approve'), canResolve: can('disputes.resolve'), isOwn: items.find((x) => x.id === open)?.membershipId === m.membershipId }} />
      )}
    </Page>
  );
}

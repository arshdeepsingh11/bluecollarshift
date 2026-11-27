import { useEffect, useState } from 'react';
import type { ShiftRequest, TimeOffRequest } from '@bluecollar/shared';
import { useApi } from '../../hooks/useApi';
import { useMembership } from '../../hooks/useAuth';
import { errorMessage, post } from '../../lib/api';
import { fmtDate, fmtDateTime, fmtTime } from '../../lib/format';
import { getSocket } from '../../lib/realtime';
import { t, type MessageKey } from '../../i18n';
import { Alert, Badge, Card, Empty, Loading, Page } from '../../components/ui';

/** Approve or decline shift pickups / drops / swaps and time-off requests. */
export default function Requests() {
  const m = useMembership();
  const base = `/companies/${m.companyId}`;
  const [show, setShow] = useState<'open' | 'all'>('open');
  const shiftReqs = useApi<{ items: ShiftRequest[] }>(`${base}/shift-requests?scope=team&status=${show}`, [m.companyId, show]);
  const timeOff = useApi<{ items: TimeOffRequest[] }>(`${base}/time-off?scope=team&status=${show === 'open' ? 'pending' : 'all'}`, [m.companyId, show]);
  const [msg, setMsg] = useState<{ kind: 'success' | 'error' | 'warning'; text: string } | null>(null);

  useEffect(() => {
    const s = getSocket();
    const refresh = () => { void shiftReqs.reload(); void timeOff.reload(); };
    s.on('requests:changed', refresh);
    return () => void s.off('requests:changed', refresh);
  }, [shiftReqs, timeOff]);

  async function decide(kind: 'shift' | 'time', id: string, decision: 'approved' | 'rejected') {
    setMsg(null);
    const note = decision === 'rejected' ? window.prompt(t('requests.reason_prompt')) ?? undefined : undefined;
    try {
      const r = await post<{ warnings?: unknown[] }>(`${base}/${kind === 'shift' ? 'shift-requests' : 'time-off'}/${id}/decide`, { decision, note: note || null });
      setMsg(r?.warnings?.length ? { kind: 'warning', text: t('requests.approved_with_warning') } : { kind: 'success', text: t(decision === 'approved' ? 'requests.approved' : 'requests.declined') });
      void shiftReqs.reload();
      void timeOff.reload();
    } catch (e) {
      setMsg({ kind: 'error', text: errorMessage(e) });
    }
  }

  return (
    <Page title={t('requests.title')} subtitle={t('requests.subtitle')} actions={
      <div className="bc-chips" style={{ margin: 0 }}>
        <button className="bc-chip" aria-pressed={show === 'open'} onClick={() => setShow('open')}>{t('requests.waiting')}</button>
        <button className="bc-chip" aria-pressed={show === 'all'} onClick={() => setShow('all')}>{t('common.all')}</button>
      </div>
    }>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      <Card title={t('requests.shift_requests')}>
        {shiftReqs.loading && !shiftReqs.data ? <Loading /> : !shiftReqs.data?.items.length ? <Empty title={t('requests.none')} /> : (
          <div className="bc-table-wrap"><table className="bc-table">
            <thead><tr><th>{t('requests.type')}</th><th>{t('requests.who')}</th><th>{t('requests.shift')}</th><th>{t('common.notes')}</th><th>{t('common.status')}</th><th /></tr></thead>
            <tbody>{shiftReqs.data.items.map((r) => (
              <tr key={r.id}>
                <td>{t(`requests.kind_${r.kind}`)}</td>
                <td>{r.requester.fullName}{r.target && <> → {r.target.fullName}</>}</td>
                <td>{r.shift.siteName}<div className="bc-muted">{fmtDateTime(r.shift.startsAt)}–{fmtTime(r.shift.endsAt)}</div></td>
                <td>{r.note ?? '—'}</td>
                <td><StatusBadge status={r.status} /></td>
                <td className="bc-actions">{r.status === 'pending' && <>
                  <button className="bc-btn small" onClick={() => void decide('shift', r.id, 'approved')}>{t('requests.approve')}</button>
                  <button className="bc-btn secondary small" onClick={() => void decide('shift', r.id, 'rejected')}>{t('requests.decline')}</button>
                </>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
      <Card title={t('requests.time_off')}>
        {timeOff.loading && !timeOff.data ? <Loading /> : !timeOff.data?.items.length ? <Empty title={t('requests.none')} /> : (
          <div className="bc-table-wrap"><table className="bc-table">
            <thead><tr><th>{t('requests.who')}</th><th>{t('requests.type')}</th><th>{t('common.from')}</th><th>{t('common.to')}</th><th>{t('common.notes')}</th><th>{t('common.status')}</th><th /></tr></thead>
            <tbody>{timeOff.data.items.map((r) => (
              <tr key={r.id}>
                <td>{r.fullName}</td>
                <td>{t(`timeoff.kind_${r.kind}`)}</td>
                <td>{fmtDate(r.startsOn)}</td>
                <td>{fmtDate(r.endsOn)}</td>
                <td>{r.note ?? '—'}</td>
                <td><StatusBadge status={r.status} /></td>
                <td className="bc-actions">{r.status === 'pending' && r.membershipId !== m.membershipId && <>
                  <button className="bc-btn small" onClick={() => void decide('time', r.id, 'approved')}>{t('requests.approve')}</button>
                  <button className="bc-btn secondary small" onClick={() => void decide('time', r.id, 'rejected')}>{t('requests.decline')}</button>
                </>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
    </Page>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const kind = status === 'approved' ? 'success' : status === 'rejected' ? 'error' : status === 'cancelled' ? undefined : 'warning';
  return <Badge kind={kind}>{t(`requests.status_${status}` as MessageKey)}</Badge>;
}

import { useState, type FormEvent } from 'react';
import type { AvailabilityDay, ShiftRequest, TimeOffRequest } from '@bluecollar/shared';
import { useApi } from '../../hooks/useApi';
import { useMembership } from '../../hooks/useAuth';
import { errorMessage, post, put } from '../../lib/api';
import { fmtDate, fmtDateTime, fmtTime, today } from '../../lib/format';
import { t, type MessageKey } from '../../i18n';
import { Alert, Card, Drawer, Empty, Field, Loading, Page } from '../../components/ui';
import { StatusBadge } from '../employer/Requests';

interface OpenShift { id: string; siteName: string; startsAt: string; endsAt: string; instructions: string | null; openSlots: number; myRequest: string | null }
interface MyShift { id: string; startsAt: string; endsAt: string; siteName: string }
interface Coworker { membershipId: string; fullName: string }

const minToTime = (m: number | null) => (m == null ? '' : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
const timeToMin = (v: string) => { const [h, mm] = v.split(':').map(Number); return (h ?? 0) * 60 + (mm ?? 0); };

/** Employee: open shifts, swap/drop requests, time off and weekly availability. */
export default function MyRequests() {
  const m = useMembership();
  const base = `/companies/${m.companyId}`;
  const open = useApi<{ items: OpenShift[] }>(`${base}/open-shifts`, [m.companyId]);
  const mine = useApi<{ items: ShiftRequest[] }>(`${base}/shift-requests?status=all`, [m.companyId]);
  const timeOff = useApi<{ items: TimeOffRequest[] }>(`${base}/time-off`, [m.companyId]);
  const avail = useApi<{ days: AvailabilityDay[] }>(`${base}/availability/me`, [m.companyId]);
  const from = new Date().toISOString();
  const to = new Date(Date.now() + 45 * 86400_000).toISOString();
  const shifts = useApi<{ items: MyShift[] }>(`${base}/shifts?mine=true&from=${from}&to=${to}`, [m.companyId]);
  const people = useApi<{ items: Coworker[] }>(`${base}/coworkers`, [m.companyId]);
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [changing, setChanging] = useState<MyShift | null>(null);
  const [asking, setAsking] = useState(false);

  const refresh = () => { void open.reload(); void mine.reload(); void timeOff.reload(); void shifts.reload(); };
  async function act(fn: () => Promise<unknown>, ok: MessageKey) {
    setMsg(null);
    try { await fn(); setMsg({ kind: 'success', text: t(ok) }); refresh(); } catch (e) { setMsg({ kind: 'error', text: errorMessage(e) }); }
  }
  const pendingFor = (shiftId: string) => mine.data?.items.find((r) => r.shift.id === shiftId && r.requester.membershipId === m.membershipId && ['pending', 'pending_peer'].includes(r.status));

  return (
    <Page title={t('myreq.title')} actions={<button className="bc-btn" onClick={() => setAsking(true)}>{t('timeoff.request')}</button>}>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}

      {(mine.data?.items ?? []).filter((r) => r.status === 'pending_peer' && r.target?.membershipId === m.membershipId).map((r) => (
        <Alert key={r.id} kind="warning">
          {t('myreq.swap_ask', { name: r.requester.fullName, site: r.shift.siteName, when: fmtDateTime(r.shift.startsAt) })}{' '}
          <button className="bc-btn small" onClick={() => void act(() => post(`${base}/shift-requests/${r.id}/respond`, { accept: true }), 'myreq.accepted')}>{t('myreq.accept')}</button>{' '}
          <button className="bc-btn secondary small" onClick={() => void act(() => post(`${base}/shift-requests/${r.id}/respond`, { accept: false }), 'myreq.declined')}>{t('myreq.decline')}</button>
        </Alert>
      ))}

      <Card title={t('myreq.open_shifts')}>
        {open.loading && !open.data ? <Loading /> : !open.data?.items.length ? <Empty title={t('myreq.no_open')} /> : open.data.items.map((s) => (
          <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--bc-border)' }}>
            <span><strong>{s.siteName}</strong><div className="bc-muted">{fmtDateTime(s.startsAt)}–{fmtTime(s.endsAt)} · {t('schedule.open_badge', { n: s.openSlots })}</div></span>
            {s.myRequest && ['pending', 'pending_peer'].includes(s.myRequest) ? <StatusBadge status={s.myRequest} /> : (
              <button className="bc-btn small" onClick={() => void act(() => post(`${base}/shift-requests`, { shiftId: s.id, kind: 'pickup' }), 'myreq.pickup_sent')}>{t('myreq.pick_up')}</button>
            )}
          </div>
        ))}
      </Card>

      <Card title={t('myreq.my_shifts')}>
        {shifts.loading && !shifts.data ? <Loading /> : !shifts.data?.items.length ? <Empty title={t('myreq.no_shifts')} /> : shifts.data.items.map((s) => {
          const p = pendingFor(s.id);
          return (
            <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--bc-border)' }}>
              <span><strong>{s.siteName}</strong><div className="bc-muted">{fmtDateTime(s.startsAt)}–{fmtTime(s.endsAt)}</div></span>
              {p ? <span><StatusBadge status={p.status} /> <button className="bc-btn ghost small" onClick={() => void act(() => post(`${base}/shift-requests/${p.id}/cancel`), 'myreq.cancelled')}>{t('common.cancel')}</button></span>
                : <button className="bc-btn secondary small" onClick={() => setChanging(s)}>{t('myreq.cant_work')}</button>}
            </div>
          );
        })}
      </Card>

      <Card title={t('requests.time_off')}>
        {timeOff.loading && !timeOff.data ? <Loading /> : !timeOff.data?.items.length ? <Empty title={t('requests.none')} /> : (
          <div className="bc-table-wrap"><table className="bc-table">
            <thead><tr><th>{t('requests.type')}</th><th>{t('common.from')}</th><th>{t('common.to')}</th><th>{t('common.status')}</th><th /></tr></thead>
            <tbody>{timeOff.data.items.map((r) => (
              <tr key={r.id}>
                <td>{t(`timeoff.kind_${r.kind}`)}</td><td>{fmtDate(r.startsOn)}</td><td>{fmtDate(r.endsOn)}</td>
                <td><StatusBadge status={r.status} />{r.decisionNote && <div className="bc-muted">{r.decisionNote}</div>}</td>
                <td>{(r.status === 'pending' || (r.status === 'approved' && r.startsOn > today())) && (
                  <button className="bc-btn ghost small" onClick={() => void act(() => post(`${base}/time-off/${r.id}/cancel`), 'myreq.cancelled')}>{t('common.cancel')}</button>
                )}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>

      <Card title={t('avail.title')}>
        {avail.data ? <AvailabilityForm days={avail.data.days} onSave={(days) => act(() => put(`${base}/availability/me`, { days }).then((r) => { avail.setData(r as { days: AvailabilityDay[] }); }), 'common.saved')} /> : <Loading />}
      </Card>

      {changing && (
        <ChangeShiftDrawer shift={changing} coworkers={(people.data?.items ?? []).filter((p) => p.membershipId !== m.membershipId)} onClose={() => setChanging(null)}
          onSubmit={async (kind, targetMembershipId, note) => {
            await act(() => post(`${base}/shift-requests`, { shiftId: changing.id, kind, targetMembershipId: kind === 'swap' ? targetMembershipId : null, note: note || null }), kind === 'swap' ? 'myreq.swap_sent' : 'myreq.drop_sent');
            setChanging(null);
          }} />
      )}
      {asking && <TimeOffDrawer onClose={() => setAsking(false)} onSubmit={async (body) => { await act(() => post(`${base}/time-off`, body), 'timeoff.sent'); setAsking(false); }} />}
    </Page>
  );
}

function AvailabilityForm({ days, onSave }: { days: AvailabilityDay[]; onSave: (d: AvailabilityDay[]) => Promise<void> }) {
  const [d, setD] = useState(days);
  const set = (i: number, v: Partial<AvailabilityDay>) => setD(d.map((x, j) => (j === i ? { ...x, ...v } : x)));
  return (
    <form onSubmit={(e) => { e.preventDefault(); void onSave(d); }}>
      <p className="bc-muted">{t('avail.hint')}</p>
      <div className="bc-day-grid">
        {d.map((x, i) => (
          <div key={x.dow} style={{ display: 'contents' }}>
            <strong>{t(`dow.${x.dow}` as MessageKey)}</strong>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <select value={!x.available ? 'no' : x.startMinute == null ? 'all' : 'hours'} style={{ width: 'auto' }} onChange={(e) => {
                const v = e.target.value;
                set(i, v === 'no' ? { available: false, startMinute: null, endMinute: null } : v === 'all' ? { available: true, startMinute: null, endMinute: null } : { available: true, startMinute: 420, endMinute: 1020 });
              }}>
                <option value="all">{t('avail.all_day')}</option><option value="hours">{t('avail.hours')}</option><option value="no">{t('avail.not_available')}</option>
              </select>
              {x.available && x.startMinute != null && <>
                <input type="time" value={minToTime(x.startMinute)} onChange={(e) => set(i, { startMinute: timeToMin(e.target.value) })} style={{ width: 'auto' }} aria-label={t('schedule.start')} />
                –
                <input type="time" value={minToTime(x.endMinute)} onChange={(e) => set(i, { endMinute: timeToMin(e.target.value) })} style={{ width: 'auto' }} aria-label={t('schedule.end')} />
              </>}
            </div>
          </div>
        ))}
      </div>
      <div className="bc-actions"><button className="bc-btn">{t('common.save')}</button></div>
    </form>
  );
}

function ChangeShiftDrawer({ shift, coworkers, onClose, onSubmit }: { shift: MyShift; coworkers: Coworker[]; onClose: () => void; onSubmit: (kind: 'drop' | 'swap', target: string, note: string) => Promise<void> }) {
  const [kind, setKind] = useState<'drop' | 'swap'>('swap');
  const [target, setTarget] = useState('');
  const [note, setNote] = useState('');
  return (
    <Drawer title={`${shift.siteName} · ${fmtDateTime(shift.startsAt)}`} onClose={onClose}>
      <div className="bc-chips">
        <button type="button" className="bc-chip" aria-pressed={kind === 'swap'} onClick={() => setKind('swap')}>{t('myreq.ask_coworker')}</button>
        <button type="button" className="bc-chip" aria-pressed={kind === 'drop'} onClick={() => setKind('drop')}>{t('myreq.give_up')}</button>
      </div>
      <p className="bc-muted">{t(kind === 'swap' ? 'myreq.swap_hint' : 'myreq.drop_hint')}</p>
      {kind === 'swap' && (
        <Field label={t('myreq.coworker')} htmlFor="cw">
          <select id="cw" value={target} onChange={(e) => setTarget(e.target.value)}><option value="">—</option>{coworkers.map((c) => <option key={c.membershipId} value={c.membershipId}>{c.fullName}</option>)}</select>
        </Field>
      )}
      <Field label={t('common.notes')} htmlFor="cn"><textarea id="cn" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      <div className="bc-actions"><button className="bc-btn secondary" onClick={onClose}>{t('common.cancel')}</button>
        <button className="bc-btn" disabled={kind === 'swap' && !target} onClick={() => void onSubmit(kind, target, note)}>{t('myreq.send')}</button></div>
    </Drawer>
  );
}

function TimeOffDrawer({ onClose, onSubmit }: { onClose: () => void; onSubmit: (b: Record<string, unknown>) => Promise<void> }) {
  const [f, setF] = useState({ kind: 'vacation', startsOn: today(1), endsOn: today(1), note: '' });
  return (
    <Drawer title={t('timeoff.request')} onClose={onClose}>
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); void onSubmit({ ...f, note: f.note || null }); }}>
        <Field label={t('requests.type')} htmlFor="tk">
          <select id="tk" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
            {(['vacation', 'sick', 'personal', 'unpaid', 'other'] as const).map((k) => <option key={k} value={k}>{t(`timeoff.kind_${k}`)}</option>)}
          </select>
        </Field>
        <div className="bc-row">
          <Field label={t('common.from')} htmlFor="tf"><input id="tf" type="date" required value={f.startsOn} onChange={(e) => setF({ ...f, startsOn: e.target.value, endsOn: e.target.value > f.endsOn ? e.target.value : f.endsOn })} /></Field>
          <Field label={t('common.to')} htmlFor="tt"><input id="tt" type="date" required min={f.startsOn} value={f.endsOn} onChange={(e) => setF({ ...f, endsOn: e.target.value })} /></Field>
        </div>
        <Field label={t('common.notes')} htmlFor="tn"><textarea id="tn" maxLength={500} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
        <div className="bc-actions"><button type="button" className="bc-btn secondary" onClick={onClose}>{t('common.cancel')}</button><button className="bc-btn">{t('myreq.send')}</button></div>
      </form>
    </Drawer>
  );
}

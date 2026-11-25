import { useMemo, useState, type FormEvent } from 'react';
import type { JobSite, Member, Shift } from '@bluecollar/shared';
import { useApi } from '../../hooks/useApi';
import { useAuth, useMembership } from '../../hooks/useAuth';
import { ApiError, errorMessage, patch, post } from '../../lib/api';
import { fmtTime, fmtWeekday, fromLocalInput, startOfWeek, toLocalInput } from '../../lib/format';
import { t } from '../../i18n';
import { Alert, Card, Drawer, Field, Loading, Page } from '../../components/ui';

export default function Shifts() {
  const m = useMembership();
  const { can } = useAuth();
  const base = `/companies/${m.companyId}`;
  const [weekStart, setWeekStart] = useState(() => startOfWeek());
  const weekEnd = useMemo(() => new Date(weekStart.getTime() + 7 * 86400_000), [weekStart]);
  const [siteId, setSiteId] = useState('');
  const shifts = useApi<{ items: Shift[] }>(`${base}/shifts?from=${weekStart.toISOString()}&to=${weekEnd.toISOString()}${siteId ? `&siteId=${siteId}` : ''}`, [m.companyId, weekStart, siteId]);
  const sites = useApi<{ items: JobSite[] }>(`${base}/sites`, [m.companyId]);
  const members = useApi<{ items: Member[] }>(can('members.view') ? `${base}/members` : null, [m.companyId]);
  const [editing, setEditing] = useState<Shift | 'new' | null>(null);

  const days = Array.from({ length: 7 }, (_, i) => new Date(weekStart.getTime() + i * 86400_000));
  const todayKey = new Date().toDateString();

  return (
    <Page title={t('schedule.title')} actions={
      <>
        <button className="bc-btn secondary small" onClick={() => setWeekStart(new Date(weekStart.getTime() - 7 * 86400_000))}>‹ {t('schedule.prev_week')}</button>
        <button className="bc-btn secondary small" onClick={() => setWeekStart(startOfWeek())}>{t('schedule.this_week')}</button>
        <button className="bc-btn secondary small" onClick={() => setWeekStart(new Date(weekStart.getTime() + 7 * 86400_000))}>{t('schedule.next_week')} ›</button>
        <select className="bc-input" style={{ width: 'auto' }} value={siteId} onChange={(e) => setSiteId(e.target.value)} aria-label={t('schedule.site')}>
          <option value="">{t('common.all')}</option>
          {sites.data?.items.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        {can('shifts.manage') && <button className="bc-btn" onClick={() => setEditing('new')}>{t('schedule.new_shift')}</button>}
      </>
    }>
      {shifts.error && <Alert kind="error">{shifts.error}</Alert>}
      <Card>
        {shifts.loading && !shifts.data ? <Loading /> : (
          <div className="bc-week">
            {days.map((d) => {
              const items = (shifts.data?.items ?? []).filter((s) => new Date(s.startsAt).toDateString() === d.toDateString());
              return (
                <div key={d.toISOString()} className={`bc-day ${d.toDateString() === todayKey ? 'today' : ''}`}>
                  <h4>{fmtWeekday(d.toISOString())}</h4>
                  {items.map((s) => (
                    <div key={s.id} className={`bc-shift-chip ${s.status}`} role="button" tabIndex={0} onClick={() => can('shifts.manage') && setEditing(s)} onKeyDown={(e) => e.key === 'Enter' && can('shifts.manage') && setEditing(s)}>
                      <strong>{fmtTime(s.startsAt)}–{fmtTime(s.endsAt)}</strong>
                      <div>{s.siteName}</div>
                      <div className="bc-muted">{s.assignees.map((a) => a.fullName).join(', ')}</div>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </Card>
      {editing && (
        <ShiftDrawer base={base} shift={editing === 'new' ? null : editing} sites={sites.data?.items.filter((s) => s.status === 'active') ?? []}
          people={(members.data?.items ?? []).filter((p) => p.status === 'active' && p.role === 'employee')}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void shifts.reload(); }} />
      )}
    </Page>
  );
}

function ShiftDrawer({ base, shift, sites, people, onClose, onSaved }: { base: string; shift: Shift | null; sites: JobSite[]; people: Member[]; onClose: () => void; onSaved: () => void }) {
  const start = new Date();
  start.setHours(7, 0, 0, 0);
  start.setDate(start.getDate() + 1);
  const [f, setF] = useState({
    siteId: shift?.siteId ?? sites[0]?.id ?? '',
    startsAt: toLocalInput(shift?.startsAt ?? start.toISOString()),
    endsAt: toLocalInput(shift?.endsAt ?? new Date(start.getTime() + 8.5 * 3600_000).toISOString()),
    breakMinutes: String(shift?.breakMinutes ?? 30),
    instructions: shift?.instructions ?? '',
    membershipIds: shift?.assignees.map((a) => a.membershipId) ?? [],
    repeatWeeks: '0',
  });
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent, status?: 'cancelled') {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (shift) {
        await patch(`${base}/shifts/${shift.id}`, {
          version: shift.version, siteId: f.siteId, startsAt: fromLocalInput(f.startsAt), endsAt: fromLocalInput(f.endsAt),
          breakMinutes: Number(f.breakMinutes), instructions: f.instructions || null, membershipIds: f.membershipIds, ...(status ? { status } : {}),
        });
        onSaved();
      } else {
        const r = await post<{ warnings: unknown[] }>(`${base}/shifts`, {
          siteId: f.siteId, startsAt: fromLocalInput(f.startsAt), endsAt: fromLocalInput(f.endsAt), breakMinutes: Number(f.breakMinutes),
          instructions: f.instructions || null, membershipIds: f.membershipIds, repeatWeeks: Number(f.repeatWeeks),
        });
        if (r.warnings?.length) {
          setWarning(t('schedule.conflicts'));
          setTimeout(onSaved, 1500);
        } else onSaved();
      }
    } catch (err) {
      setError(err instanceof ApiError && err.status === 409 ? t('schedule.changed_elsewhere') : errorMessage(err));
      if (err instanceof ApiError && err.status === 409) setTimeout(onSaved, 1200);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer title={shift ? `${shift.siteName} · ${fmtWeekday(shift.startsAt)}` : t('schedule.new_shift')} onClose={onClose}>
      {error && <Alert kind="error">{error}</Alert>}
      {warning && <Alert kind="warning">{warning}</Alert>}
      <form onSubmit={submit}>
        <Field label={t('schedule.site')} htmlFor="ssite">
          <select id="ssite" required value={f.siteId} onChange={(e) => setF({ ...f, siteId: e.target.value })}>
            {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <div className="bc-row">
          <Field label={t('schedule.start')} htmlFor="sstart"><input id="sstart" type="datetime-local" required value={f.startsAt} onChange={(e) => setF({ ...f, startsAt: e.target.value })} /></Field>
          <Field label={t('schedule.end')} htmlFor="send"><input id="send" type="datetime-local" required value={f.endsAt} onChange={(e) => setF({ ...f, endsAt: e.target.value })} /></Field>
        </div>
        <div className="bc-row">
          <Field label={t('schedule.break')} htmlFor="sbreak"><input id="sbreak" type="number" min={0} max={240} value={f.breakMinutes} onChange={(e) => setF({ ...f, breakMinutes: e.target.value })} /></Field>
          {!shift && <Field label={t('schedule.repeat')} htmlFor="srep"><input id="srep" type="number" min={0} max={12} value={f.repeatWeeks} onChange={(e) => setF({ ...f, repeatWeeks: e.target.value })} /></Field>}
        </div>
        <Field label={t('schedule.instructions')} htmlFor="sinst"><textarea id="sinst" maxLength={2000} value={f.instructions} onChange={(e) => setF({ ...f, instructions: e.target.value })} /></Field>
        <Field label={t('schedule.assign')}>
          <div style={{ maxHeight: 220, overflowY: 'auto' }}>
            {people.map((p) => (
              <label key={p.membershipId} className="bc-check">
                <input type="checkbox" checked={f.membershipIds.includes(p.membershipId)} onChange={(e) => setF({ ...f, membershipIds: e.target.checked ? [...f.membershipIds, p.membershipId] : f.membershipIds.filter((x) => x !== p.membershipId) })} />
                {p.fullName}
              </label>
            ))}
          </div>
        </Field>
        <div className="bc-actions">
          {shift && shift.status === 'scheduled' && <button type="button" className="bc-btn danger" disabled={busy} onClick={(e) => void submit(e as unknown as FormEvent, 'cancelled')}>{t('schedule.cancel_shift')}</button>}
          <button className="bc-btn" disabled={busy || !f.membershipIds.length || !f.siteId}>{busy ? t('common.saving') : t('common.save')}</button>
        </div>
      </form>
    </Drawer>
  );
}

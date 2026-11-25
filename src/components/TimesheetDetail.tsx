import { useState, type FormEvent } from 'react';
import type { WorkSessionDetail } from '@bluecollar/shared';
import { useApi } from '../hooks/useApi';
import { ApiError, errorMessage, post } from '../lib/api';
import { fmtDateTime, fmtMinutes, fromLocalInput, toLocalInput } from '../lib/format';
import { t, type MessageKey } from '../i18n';
import { Alert, Badge, Drawer, Field, Flags, Loading, SessionStatus } from './ui';

/**
 * Full transparency view used by employers AND employees: original record, effective values,
 * every clock event (with device vs server time, GPS, flags), every adjustment (who/when/why),
 * and disputes.
 */
export function TimesheetDetail({ companyId, sessionId, mode, onClose, onChanged }: {
  companyId: string; sessionId: string; mode: { canAdjust: boolean; canApprove: boolean; canResolve: boolean; isOwn: boolean };
  onClose: () => void; onChanged: () => void;
}) {
  const base = `/companies/${companyId}`;
  const { data, error, loading, reload, setData } = useApi<WorkSessionDetail>(`${base}/timesheets/${sessionId}`, [sessionId]);
  const [adjusting, setAdjusting] = useState(false);
  const [disputing, setDisputing] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'error' | 'success' | 'warning'; text: string } | null>(null);

  const refresh = async () => {
    await reload();
    onChanged();
  };

  async function decide(decision: 'approved' | 'rejected') {
    setMsg(null);
    try {
      await post(`${base}/timesheets/approve`, { sessionIds: [sessionId], decision });
      await refresh();
    } catch (e) {
      setMsg({ kind: 'error', text: errorMessage(e) });
    }
  }

  if (loading && !data) return <Drawer title={t('ts.title')} onClose={onClose}><Loading /></Drawer>;
  if (!data) return <Drawer title={t('ts.title')} onClose={onClose}><Alert kind="error">{error ?? t('common.not_found')}</Alert></Drawer>;
  const s = data;
  const openDispute = s.disputes.find((d) => d.status === 'open');

  return (
    <Drawer title={`${s.employeeName} · ${fmtDateTime(s.originalStart)}`} onClose={onClose}>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      <p><SessionStatus status={s.status} approval={s.approvalStatus} /> <Flags flags={s.flags} /></p>
      <div className="bc-compare">
        <div>
          <h4>{t('ts.original')}</h4>
          <div>{fmtDateTime(s.originalStart)} → {fmtDateTime(s.originalEnd)}</div>
          <div className="bc-muted">{t('ts.break')}: {s.originalBreakMinutes} min</div>
        </div>
        <div>
          <h4>{t('ts.effective')}</h4>
          <div className={s.adjusted ? '' : 'bc-muted'}>{fmtDateTime(s.effectiveStart)} → {fmtDateTime(s.effectiveEnd)}</div>
          <div className="bc-muted">{t('ts.break')}: {s.effectiveBreakMinutes} min · {t('ts.paid')}: {fmtMinutes(s.paidMinutes)}</div>
        </div>
      </div>

      <div className="bc-actions" style={{ margin: '16px 0' }}>
        {mode.isOwn && s.status !== 'open' && !openDispute && <button className="bc-btn secondary" onClick={() => setDisputing(true)}>{t('ts.dispute')}</button>}
        {mode.canAdjust && !mode.isOwn && s.status !== 'open' && <button className="bc-btn secondary" onClick={() => setAdjusting(true)}>{t('ts.adjust')}</button>}
        {mode.canApprove && !mode.isOwn && s.status !== 'open' && s.approvalStatus !== 'rejected' && <button className="bc-btn ghost" onClick={() => void decide('rejected')}>{t('ts.reject')}</button>}
        {mode.canApprove && !mode.isOwn && s.status !== 'open' && s.approvalStatus !== 'approved' && <button className="bc-btn" onClick={() => void decide('approved')}>{t('ts.approve')}</button>}
      </div>

      {adjusting && (
        <AdjustForm base={base} session={s} onCancel={() => setAdjusting(false)} onDone={async (fresh) => { setAdjusting(false); setData(fresh); onChanged(); }}
          onConflict={async () => { setAdjusting(false); setMsg({ kind: 'warning', text: t('ts.version_conflict') }); await refresh(); }} />
      )}
      {disputing && <DisputeForm base={base} sessionId={s.id} adjustmentId={s.adjustments.find((a) => a.active)?.id ?? null} onCancel={() => setDisputing(false)}
        onDone={async () => { setDisputing(false); setMsg({ kind: 'success', text: t('ts.dispute_sent') }); await refresh(); }} />}

      {s.adjustments.length > 0 && (
        <>
          <h3 style={{ fontSize: 16, margin: '16px 0 8px' }}>{t('ts.history')}</h3>
          <ul className="bc-timeline">
            {s.adjustments.map((a) => (
              <li key={a.id}>
                <strong>{t('ts.adjusted_by', { name: a.createdBy.fullName, date: fmtDateTime(a.createdAt) })}</strong> {a.active && <Badge kind="info">{t('ts.effective')}</Badge>}
                <div>{fmtDateTime(a.adjustedStart)} → {fmtDateTime(a.adjustedEnd)} · {t('ts.break')} {a.adjustedBreakMinutes} min</div>
                <div className="bc-muted">“{a.reason}”</div>
              </li>
            ))}
          </ul>
        </>
      )}

      {s.disputes.length > 0 && (
        <>
          <h3 style={{ fontSize: 16, margin: '16px 0 8px' }}>{t('nav.disputes')}</h3>
          {s.disputes.map((d) => (
            <div key={d.id} className="bc-card" style={{ padding: 12 }}>
              <Badge kind={d.status === 'open' ? 'warning' : d.status === 'resolved' ? 'success' : undefined}>{d.status}</Badge> <strong>{d.raisedBy.fullName}</strong> · <span className="bc-muted">{fmtDateTime(d.createdAt)}</span>
              <p style={{ margin: '6px 0' }}>{d.explanation}</p>
              {d.resolutionNote && <p className="bc-muted">↳ {d.resolvedBy?.fullName}: {d.resolutionNote}</p>}
              {d.status === 'open' && mode.canResolve && !mode.isOwn && <ResolveForm base={base} disputeId={d.id} onDone={refresh} />}
            </div>
          ))}
        </>
      )}

      <h3 style={{ fontSize: 16, margin: '16px 0 8px' }}>{t('ts.events')}</h3>
      <ul className="bc-timeline">
        {s.events.map((e) => (
          <li key={e.id}>
            <strong>{e.type.replace('_', ' ')}</strong> · {fmtDateTime(e.occurredAt)}
            <div className="bc-muted">
              {t(e.source === 'offline' ? 'ts.source_offline' : 'ts.source_online')}
              {e.source === 'offline' && <> · received {fmtDateTime(e.serverReceivedAt)}</>}
              {e.distanceFromSiteM !== null && <> · {t('ts.distance', { m: e.distanceFromSiteM })}</>}
              {e.accuracyM !== null && <> · ±{Math.round(e.accuracyM)} m</>}
            </div>
            <Flags flags={e.flags} />
          </li>
        ))}
      </ul>
    </Drawer>
  );
}

function AdjustForm({ base, session, onCancel, onDone, onConflict }: { base: string; session: WorkSessionDetail; onCancel: () => void; onDone: (d: WorkSessionDetail) => void; onConflict: () => void }) {
  const [f, setF] = useState({ start: toLocalInput(session.effectiveStart), end: toLocalInput(session.effectiveEnd ?? session.effectiveStart), breakMinutes: String(session.effectiveBreakMinutes), reason: '' });
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const d = await post<WorkSessionDetail>(`${base}/timesheets/${session.id}/adjustments`, {
        expectedVersion: session.version, adjustedStart: fromLocalInput(f.start), adjustedEnd: fromLocalInput(f.end), adjustedBreakMinutes: Number(f.breakMinutes), reason: f.reason,
      });
      onDone(d);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) return onConflict();
      setError(errorMessage(err));
    }
  }
  return (
    <form onSubmit={submit} className="bc-card" style={{ marginBottom: 16 }}>
      <Alert kind="info">{t('ts.adjust_note')}</Alert>
      {error && <Alert kind="error">{error}</Alert>}
      <div className="bc-row">
        <Field label={t('schedule.start')} htmlFor="astart"><input id="astart" type="datetime-local" required value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} /></Field>
        <Field label={t('schedule.end')} htmlFor="aend"><input id="aend" type="datetime-local" required value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} /></Field>
        <Field label={t('schedule.break')} htmlFor="abreak"><input id="abreak" type="number" min={0} max={600} value={f.breakMinutes} onChange={(e) => setF({ ...f, breakMinutes: e.target.value })} /></Field>
      </div>
      <Field label={t('ts.adjust_reason')} htmlFor="areason"><textarea id="areason" required minLength={5} maxLength={1000} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
      <div className="bc-actions"><button type="button" className="bc-btn secondary" onClick={onCancel}>{t('common.cancel')}</button><button className="bc-btn" disabled={f.reason.trim().length < 5}>{t('common.save')}</button></div>
    </form>
  );
}

function DisputeForm({ base, sessionId, adjustmentId, onCancel, onDone }: { base: string; sessionId: string; adjustmentId: string | null; onCancel: () => void; onDone: () => void }) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      await post(`${base}/timesheets/${sessionId}/disputes`, { explanation: text, adjustmentId });
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  return (
    <form onSubmit={submit} className="bc-card" style={{ marginBottom: 16 }}>
      {error && <Alert kind="error">{error}</Alert>}
      <Field label={t('ts.dispute_explain')} htmlFor="dtext"><textarea id="dtext" required minLength={5} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} /></Field>
      <div className="bc-actions"><button type="button" className="bc-btn secondary" onClick={onCancel}>{t('common.cancel')}</button><button className="bc-btn" disabled={text.trim().length < 5}>{t('ts.dispute')}</button></div>
    </form>
  );
}

export function ResolveForm({ base, disputeId, onDone }: { base: string; disputeId: string; onDone: () => void }) {
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  async function act(status: 'resolved' | 'rejected') {
    try {
      await post(`${base}/disputes/${disputeId}/resolve`, { status, resolutionNote: note });
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  return (
    <div style={{ marginTop: 8 }}>
      {error && <Alert kind="error">{error}</Alert>}
      <Field label={t('ts.resolution')} htmlFor={`res-${disputeId}`}><textarea id={`res-${disputeId}`} minLength={5} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      <div className="bc-actions">
        <button className="bc-btn ghost" disabled={note.trim().length < 5} onClick={() => void act('rejected')}>{t('disputes.rejected' as MessageKey)}</button>
        <button className="bc-btn" disabled={note.trim().length < 5} onClick={() => void act('resolved')}>{t('disputes.resolved')}</button>
      </div>
    </div>
  );
}

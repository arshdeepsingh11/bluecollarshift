import { useState, type FormEvent } from 'react';
import type { JobSite, Member, SafetyReport, ToolboxTalk, UploadTarget } from '@bluecollar/shared';
import { useApi } from '../../hooks/useApi';
import { useAuth, useMembership } from '../../hooks/useAuth';
import { errorMessage, get, post } from '../../lib/api';
import { fmtDateTime, fromLocalInput, toLocalInput } from '../../lib/format';
import { compressImage, uploadTo } from '../../lib/upload';
import { t } from '../../i18n';
import { Alert, Badge, Card, Drawer, Empty, Field, Loading, Page } from '../../components/ui';

/** Safety: incident / near-miss / hazard reports and toolbox talks. Used by staff and employees. */
export default function Safety() {
  const m = useMembership();
  const { can } = useAuth();
  const base = `/companies/${m.companyId}`;
  const staff = can('safety.manage');
  const reports = useApi<{ items: SafetyReport[] }>(`${base}/safety/reports`, [m.companyId]);
  const talks = useApi<{ items: ToolboxTalk[] }>(`${base}/safety/talks`, [m.companyId]);
  const sites = useApi<{ items: JobSite[] }>(`${base}/sites`, [m.companyId]);
  const [reporting, setReporting] = useState(false);
  const [talking, setTalking] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const canLeadTalk = staff || !!m.crewLead;
  const toSign = (talks.data?.items ?? []).filter((x) => x.attendees.some((a) => a.membershipId === m.membershipId && !a.signedAt));

  return (
    <Page title={t('safety.title')} actions={<>
      {canLeadTalk && <button className="bc-btn secondary" onClick={() => setTalking(true)}>{t('safety.new_talk')}</button>}
      <button className="bc-btn" onClick={() => setReporting(true)}>{t('safety.report')}</button>
    </>}>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      {toSign.length > 0 && (
        <Card title={t('safety.to_sign')}>
          {toSign.map((x) => (
            <div key={x.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '8px 0' }}>
              <span><strong>{x.topic}</strong><div className="bc-muted">{x.ledBy} · {fmtDateTime(x.heldAt)}</div></span>
              <button className="bc-btn small" onClick={async () => {
                try { await post(`${base}/safety/talks/${x.id}/sign`); setMsg({ kind: 'success', text: t('safety.signed') }); void talks.reload(); } catch (e) { setMsg({ kind: 'error', text: errorMessage(e) }); }
              }}>{t('safety.sign')}</button>
            </div>
          ))}
        </Card>
      )}
      <Card title={staff ? t('safety.reports') : t('safety.my_reports')}>
        {reports.loading && !reports.data ? <Loading /> : !reports.data?.items.length ? <Empty title={t('safety.no_reports')} /> : (
          <div className="bc-table-wrap"><table className="bc-table">
            <thead><tr><th>{t('common.date')}</th><th>{t('requests.type')}</th><th>{t('schedule.site')}</th><th>{t('safety.what')}</th><th>{t('safety.by')}</th><th>{t('common.status')}</th><th /></tr></thead>
            <tbody>{reports.data.items.map((r) => (
              <tr key={r.id}>
                <td>{fmtDateTime(r.occurredAt)}</td>
                <td>{t(`safety.kind_${r.kind}`)}{r.injured && <> <Badge kind="error">{t('safety.injury')}</Badge></>}</td>
                <td>{r.siteName ?? '—'}</td>
                <td style={{ maxWidth: 360 }}>{r.description}{r.actionTaken && <div className="bc-muted">{t('safety.action')}: {r.actionTaken}</div>}{r.closeNote && <div className="bc-muted">✓ {r.closeNote}</div>}</td>
                <td>{r.reportedBy}</td>
                <td><Badge kind={r.status === 'open' ? 'warning' : 'success'}>{t(`safety.status_${r.status}`)}</Badge></td>
                <td className="bc-actions">
                  {r.hasPhoto && <button className="bc-btn ghost small" onClick={async () => {
                    try { const { url } = await get<{ url: string }>(`${base}/safety/reports/${r.id}/photo`); window.open(url, '_blank', 'noopener'); } catch (e) { setMsg({ kind: 'error', text: errorMessage(e) }); }
                  }}>{t('safety.photo')}</button>}
                  {staff && r.status === 'open' && <button className="bc-btn secondary small" onClick={async () => {
                    const note = window.prompt(t('safety.close_prompt'));
                    if (!note || note.trim().length < 3) return;
                    try { await post(`${base}/safety/reports/${r.id}/close`, { note }); void reports.reload(); } catch (e) { setMsg({ kind: 'error', text: errorMessage(e) }); }
                  }}>{t('safety.close')}</button>}
                </td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
      <Card title={t('safety.talks')}>
        {talks.loading && !talks.data ? <Loading /> : !talks.data?.items.length ? <Empty title={t('safety.no_talks')} /> : (
          <div className="bc-table-wrap"><table className="bc-table">
            <thead><tr><th>{t('common.date')}</th><th>{t('safety.topic')}</th><th>{t('schedule.site')}</th><th>{t('safety.led_by')}</th><th>{t('safety.signed_count')}</th></tr></thead>
            <tbody>{talks.data.items.map((x) => (
              <tr key={x.id}>
                <td>{fmtDateTime(x.heldAt)}</td><td>{x.topic}</td><td>{x.siteName ?? '—'}</td><td>{x.ledBy}</td>
                <td title={x.attendees.filter((a) => !a.signedAt).map((a) => a.fullName).join(', ')}>{x.attendees.filter((a) => a.signedAt).length} / {x.attendees.length}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
      {reporting && <ReportDrawer base={base} sites={sites.data?.items ?? []} onClose={() => setReporting(false)} onDone={(text) => { setReporting(false); setMsg({ kind: 'success', text }); void reports.reload(); }} />}
      {talking && <TalkDrawer base={base} sites={sites.data?.items ?? []} me={m.membershipId} canMembers={can('members.view')} onClose={() => setTalking(false)} onDone={() => { setTalking(false); setMsg({ kind: 'success', text: t('safety.talk_saved') }); void talks.reload(); }} />}
    </Page>
  );
}

function ReportDrawer({ base, sites, onClose, onDone }: { base: string; sites: JobSite[]; onClose: () => void; onDone: (msg: string) => void }) {
  const [f, setF] = useState({ kind: 'incident' as SafetyReport['kind'], siteId: '', occurredAt: toLocalInput(new Date().toISOString()), description: '', injured: false, injuryDetails: '', actionTaken: '' });
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await post<SafetyReport & { photoUpload: UploadTarget | null }>(`${base}/safety/reports`, {
        kind: f.kind, siteId: f.siteId || null, occurredAt: fromLocalInput(f.occurredAt), description: f.description, injured: f.injured,
        injuryDetails: f.injured ? f.injuryDetails || null : null, actionTaken: f.actionTaken || null,
        photo: photo ? { contentType: photo.type || 'image/jpeg', size: photo.size } : null,
      });
      const ok = photo && r.photoUpload ? await uploadTo(r.photoUpload, photo) : true;
      onDone(ok ? t('safety.reported') : t('feedback.upload_failed'));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Drawer title={t('safety.report')} onClose={onClose}>
      {error && <Alert kind="error">{error}</Alert>}
      <form onSubmit={submit}>
        <div className="bc-chips" role="group" aria-label={t('requests.type')}>
          {(['incident', 'near_miss', 'hazard'] as const).map((k) => <button key={k} type="button" className="bc-chip" aria-pressed={f.kind === k} onClick={() => setF({ ...f, kind: k })}>{t(`safety.kind_${k}`)}</button>)}
        </div>
        <div className="bc-row">
          <Field label={t('common.date')} htmlFor="soc"><input id="soc" type="datetime-local" required value={f.occurredAt} onChange={(e) => setF({ ...f, occurredAt: e.target.value })} /></Field>
          <Field label={t('schedule.site')} htmlFor="ssite"><select id="ssite" value={f.siteId} onChange={(e) => setF({ ...f, siteId: e.target.value })}><option value="">—</option>{sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        </div>
        <Field label={t('safety.what')} htmlFor="sdesc"><textarea id="sdesc" required minLength={5} maxLength={4000} rows={4} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        {f.kind === 'incident' && <label className="bc-check"><input type="checkbox" checked={f.injured} onChange={(e) => setF({ ...f, injured: e.target.checked })} />{t('safety.someone_hurt')}</label>}
        {f.injured && <Field label={t('safety.injury_details')} htmlFor="sinj"><textarea id="sinj" maxLength={2000} value={f.injuryDetails} onChange={(e) => setF({ ...f, injuryDetails: e.target.value })} /></Field>}
        <Field label={t('safety.action')} htmlFor="sact"><textarea id="sact" maxLength={2000} value={f.actionTaken} onChange={(e) => setF({ ...f, actionTaken: e.target.value })} /></Field>
        <Field label={t('safety.photo')} htmlFor="sph"><input id="sph" type="file" accept="image/*" onChange={async (e) => { const file = e.target.files?.[0]; setPhoto(file ? await compressImage(file) : null); }} /></Field>
        <div className="bc-actions"><button type="button" className="bc-btn secondary" onClick={onClose}>{t('common.cancel')}</button><button className="bc-btn" disabled={busy}>{busy ? t('common.saving') : t('safety.submit')}</button></div>
      </form>
    </Drawer>
  );
}

function TalkDrawer({ base, sites, me, canMembers, onClose, onDone }: { base: string; sites: JobSite[]; me: string; canMembers: boolean; onClose: () => void; onDone: () => void }) {
  // Staff pick from everyone; a crew lead picks from their crew.
  const people = useApi<{ items: (Pick<Member, 'membershipId' | 'fullName'> & { status?: string })[] }>(canMembers ? `${base}/members` : `${base}/crew`, [base]);
  const [f, setF] = useState({ topic: '', notes: '', siteId: '', heldAt: toLocalInput(new Date().toISOString()), attendeeIds: [me] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await post(`${base}/safety/talks`, { topic: f.topic, notes: f.notes || null, siteId: f.siteId || null, heldAt: fromLocalInput(f.heldAt), attendeeIds: f.attendeeIds });
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  const list = (people.data?.items ?? []).filter((p) => !p.status || p.status === 'active');
  return (
    <Drawer title={t('safety.new_talk')} onClose={onClose}>
      {error && <Alert kind="error">{error}</Alert>}
      <form onSubmit={submit}>
        <Field label={t('safety.topic')} htmlFor="ttopic"><input id="ttopic" required minLength={3} maxLength={200} value={f.topic} onChange={(e) => setF({ ...f, topic: e.target.value })} placeholder={t('safety.topic_example')} /></Field>
        <div className="bc-row">
          <Field label={t('common.date')} htmlFor="tat"><input id="tat" type="datetime-local" required value={f.heldAt} onChange={(e) => setF({ ...f, heldAt: e.target.value })} /></Field>
          <Field label={t('schedule.site')} htmlFor="tsite"><select id="tsite" value={f.siteId} onChange={(e) => setF({ ...f, siteId: e.target.value })}><option value="">—</option>{sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        </div>
        <Field label={t('common.notes')} htmlFor="tnotes"><textarea id="tnotes" maxLength={4000} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        <Field label={t('safety.attendees')}>
          {people.loading && !people.data ? <Loading /> : (
            <div style={{ maxHeight: 240, overflowY: 'auto' }}>
              {list.map((p) => (
                <label key={p.membershipId} className="bc-check">
                  <input type="checkbox" checked={f.attendeeIds.includes(p.membershipId)} onChange={(e) => setF({ ...f, attendeeIds: e.target.checked ? [...f.attendeeIds, p.membershipId] : f.attendeeIds.filter((x) => x !== p.membershipId) })} />
                  {p.fullName}
                </label>
              ))}
            </div>
          )}
        </Field>
        <div className="bc-actions"><button type="button" className="bc-btn secondary" onClick={onClose}>{t('common.cancel')}</button><button className="bc-btn" disabled={busy || !f.attendeeIds.length}>{t('common.save')}</button></div>
      </form>
    </Drawer>
  );
}

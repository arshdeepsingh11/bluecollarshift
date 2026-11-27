import { useState, type FormEvent } from 'react';
import { ASSIGNABLE_ROLES, type CompanyRole, type Invitation, type JobSite, type Member } from '@bluecollar/shared';
import { useApi } from '../../hooks/useApi';
import { useAuth, useMembership } from '../../hooks/useAuth';
import { errorMessage, patch, post } from '../../lib/api';
import { fmtDate, money, today } from '../../lib/format';
import { getLocale, LANGUAGES, t } from '../../i18n';
import { Alert, Badge, Card, Drawer, Empty, Field, Loading, Page } from '../../components/ui';

export default function Employees() {
  const m = useMembership();
  const { can } = useAuth();
  const base = `/companies/${m.companyId}`;
  const members = useApi<{ items: Member[] }>(`${base}/members`, [m.companyId]);
  const invites = useApi<{ items: Invitation[] }>(can('members.invite') ? `${base}/invitations` : null, [m.companyId]);
  const sites = useApi<{ items: JobSite[] }>(`${base}/sites`, [m.companyId]);
  const [inviting, setInviting] = useState(false);
  const [selected, setSelected] = useState<Member | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const pending = invites.data?.items.filter((i) => !i.acceptedAt && !i.revokedAt) ?? [];

  return (
    <Page title={t('people.title')} actions={can('members.invite') && <button className="bc-btn" onClick={() => setInviting(true)}>{t('people.invite')}</button>}>
      {notice && <Alert kind="success">{notice}</Alert>}
      {members.error && <Alert kind="error">{members.error}</Alert>}
      <Card>
        {members.loading && !members.data ? <Loading /> : !members.data?.items.length ? <Empty title={t('people.no_people')} /> : (
          <div className="bc-table-wrap">
            <table className="bc-table">
              <thead><tr><th>{t('common.name')}</th><th>{t('common.role')}</th><th>{t('people.job_title')}</th>{can('payrates.view') && <th className="num">{t('payroll.rate')}</th>}<th>{t('common.status')}</th></tr></thead>
              <tbody>
                {members.data.items.map((p) => (
                  <tr key={p.membershipId} className="clickable" onClick={() => setSelected(p)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setSelected(p)}>
                    <td><strong>{p.fullName}</strong><div className="bc-muted">{p.email}</div></td>
                    <td>{t(`role.${p.role}`)}</td>
                    <td>{p.jobTitle ?? '—'}</td>
                    {can('payrates.view') && <td className="num">{p.hourlyRate ? money(p.hourlyRate) : '—'}</td>}
                    <td><Badge kind={p.status === 'active' ? 'success' : undefined}>{t(p.status === 'active' ? 'people.status_active' : 'people.status_inactive')}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {pending.length > 0 && (
        <Card title={t('people.invitations')}>
          <table className="bc-table">
            <tbody>
              {pending.map((i) => (
                <tr key={i.id}>
                  <td><strong>{i.fullName}</strong><div className="bc-muted">{i.email}</div></td>
                  <td>{t(`role.${i.role}`)}</td>
                  <td className="bc-muted">{t('people.expires', { date: fmtDate(i.expiresAt) })}</td>
                  <td className="num">
                    <button className="bc-btn ghost small" onClick={async () => { await post(`${base}/invitations/${i.id}/revoke`); void invites.reload(); }}>{t('people.revoke')}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      {inviting && (
        <InviteDrawer base={base} role={m.role} canRate={can('payrates.manage')} sites={sites.data?.items ?? []} onClose={() => setInviting(false)}
          onDone={(email) => { setInviting(false); setNotice(t('people.invite_sent', { email })); void invites.reload(); }} />
      )}
      {selected && (
        <MemberDrawer base={base} member={selected} myRole={m.role} isMe={selected.membershipId === m.membershipId} sites={sites.data?.items ?? []}
          canManage={can('members.manage')} canRates={can('payrates.view')} canSetRates={can('payrates.manage')} canRoles={can('roles.manage')}
          onClose={() => setSelected(null)} onSaved={() => { setSelected(null); void members.reload(); }} />
      )}
    </Page>
  );
}

function SitePicker({ sites, value, onChange }: { sites: JobSite[]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div>
      {sites.map((s) => (
        <label className="bc-check" key={s.id}>
          <input type="checkbox" checked={value.includes(s.id)} onChange={(e) => onChange(e.target.checked ? [...value, s.id] : value.filter((x) => x !== s.id))} />
          {s.name}
        </label>
      ))}
    </div>
  );
}

function InviteDrawer({ base, role, canRate, sites, onClose, onDone }: { base: string; role: CompanyRole; canRate: boolean; sites: JobSite[]; onClose: () => void; onDone: (email: string) => void }) {
  const roles = ASSIGNABLE_ROLES[role];
  const [form, setForm] = useState({ email: '', fullName: '', role: roles.includes('employee') ? 'employee' : roles[0] ?? 'employee', hourlyRate: '', siteIds: [] as string[], locale: getLocale() as string });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await post(`${base}/invitations`, { email: form.email, fullName: form.fullName, role: form.role, siteIds: form.siteIds, locale: form.locale, ...(form.hourlyRate ? { hourlyRate: Number(form.hourlyRate) } : {}) });
      onDone(form.email);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Drawer title={t('people.invite')} onClose={onClose}>
      {error && <Alert kind="error">{error}</Alert>}
      <form onSubmit={submit}>
        <Field label={t('common.name')} htmlFor="iname"><input id="iname" required minLength={2} value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} /></Field>
        <Field label={t('common.email')} htmlFor="iemail"><input id="iemail" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
        <Field label={t('common.role')} htmlFor="irole">
          <select id="irole" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as CompanyRole })}>
            {roles.map((r) => <option key={r} value={r}>{t(`role.${r}`)}</option>)}
          </select>
        </Field>
        <Field label={t('people.invite_language')} htmlFor="ilang" hint={t('people.invite_language_hint')}>
          <select id="ilang" value={form.locale} onChange={(e) => setForm({ ...form, locale: e.target.value })}>
            {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
          </select>
        </Field>
        {canRate && <Field label={t('people.hourly_rate')} htmlFor="irate"><input id="irate" type="number" min="0" step="0.01" value={form.hourlyRate} onChange={(e) => setForm({ ...form, hourlyRate: e.target.value })} /></Field>}
        {sites.length > 0 && <Field label={t('people.sites_scope')}><SitePicker sites={sites} value={form.siteIds} onChange={(siteIds) => setForm({ ...form, siteIds })} /></Field>}
        <div className="bc-actions"><button type="button" className="bc-btn secondary" onClick={onClose}>{t('common.cancel')}</button><button className="bc-btn" disabled={busy}>{t('people.invite')}</button></div>
      </form>
    </Drawer>
  );
}

function MemberDrawer(p: {
  base: string; member: Member; myRole: CompanyRole; isMe: boolean; sites: JobSite[]; canManage: boolean; canRates: boolean; canSetRates: boolean; canRoles: boolean;
  onClose: () => void; onSaved: () => void;
}) {
  const { member } = p;
  const [form, setForm] = useState({ role: member.role, jobTitle: member.jobTitle ?? '', overtimeExempt: member.overtimeExempt, siteIds: member.siteIds, payrollId: member.payrollId ?? '', crewLead: member.crewLead });
  const [error, setError] = useState<string | null>(null);
  const [rate, setRate] = useState({ hourlyRate: '', effectiveFrom: today() });
  const rates = useApi<{ items: { id: string; hourlyRate: string; effectiveFrom: string }[] }>(p.canRates || p.isMe ? `${p.base}/members/${member.membershipId}/pay-rates` : null, [member.membershipId]);
  const editable = p.canManage && !p.isMe && member.role !== 'owner';
  const assignable = [member.role, ...ASSIGNABLE_ROLES[p.myRole].filter((r) => r !== member.role)];

  async function save(extra: Record<string, unknown> = {}) {
    setError(null);
    try {
      await patch(`${p.base}/members/${member.membershipId}`, { role: form.role, jobTitle: form.jobTitle || null, overtimeExempt: form.overtimeExempt, siteIds: form.siteIds, payrollId: form.payrollId.trim() || null, crewLead: form.crewLead, ...extra });
      p.onSaved();
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  async function addRate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await post(`${p.base}/members/${member.membershipId}/pay-rates`, { hourlyRate: Number(rate.hourlyRate), effectiveFrom: rate.effectiveFrom });
      setRate({ hourlyRate: '', effectiveFrom: today() });
      void rates.reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <Drawer title={member.fullName} onClose={p.onClose}>
      <p className="bc-muted">{member.email}</p>
      {error && <Alert kind="error">{error}</Alert>}
      <Field label={t('common.role')} htmlFor="mrole">
        <select id="mrole" disabled={!editable} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as CompanyRole })}>
          {assignable.map((r) => <option key={r} value={r}>{t(`role.${r}`)}</option>)}
        </select>
      </Field>
      <Field label={t('people.job_title')} htmlFor="mtitle"><input id="mtitle" disabled={!editable} value={form.jobTitle} onChange={(e) => setForm({ ...form, jobTitle: e.target.value })} /></Field>
      <label className="bc-check"><input type="checkbox" disabled={!editable} checked={form.overtimeExempt} onChange={(e) => setForm({ ...form, overtimeExempt: e.target.checked })} />{t('people.overtime_exempt')}</label>
      {form.role === 'employee' && (
        <label className="bc-check"><input type="checkbox" disabled={!editable} checked={form.crewLead} onChange={(e) => setForm({ ...form, crewLead: e.target.checked })} />{t('people.crew_lead')}</label>
      )}
      <Field label={t('people.payroll_id')} htmlFor="mpid" hint={t('people.payroll_id_hint')}><input id="mpid" disabled={!editable} maxLength={32} value={form.payrollId} onChange={(e) => setForm({ ...form, payrollId: e.target.value })} /></Field>
      {p.sites.length > 0 && <Field label={t('people.sites_scope')}><SitePicker sites={p.sites} value={form.siteIds} onChange={(siteIds) => editable && setForm({ ...form, siteIds })} /></Field>}
      {editable && (
        <div className="bc-actions" style={{ marginBottom: 24 }}>
          {member.status === 'active'
            ? <button className="bc-btn danger" onClick={() => window.confirm(t('people.deactivate_confirm', { name: member.fullName })) && void save({ status: 'inactive' })}>{t('people.deactivate')}</button>
            : <button className="bc-btn secondary" onClick={() => void save({ status: 'active' })}>{t('people.reactivate')}</button>}
          <button className="bc-btn" onClick={() => void save()}>{t('common.save')}</button>
        </div>
      )}
      {(p.canRates || p.isMe) && (
        <>
          <h3 style={{ fontSize: 16, margin: '8px 0' }}>{t('people.rate_history')}</h3>
          {rates.data?.items.length ? (
            <table className="bc-table"><tbody>{rates.data.items.map((r) => <tr key={r.id}><td>{fmtDate(r.effectiveFrom)}</td><td className="num">{money(r.hourlyRate)}</td></tr>)}</tbody></table>
          ) : <p className="bc-muted">{t('common.none')}</p>}
          {p.canSetRates && !p.isMe && (
            <form onSubmit={addRate} className="bc-row" style={{ marginTop: 12 }}>
              <Field label={t('people.new_rate')} htmlFor="nrate"><input id="nrate" type="number" min="0.01" step="0.01" required value={rate.hourlyRate} onChange={(e) => setRate({ ...rate, hourlyRate: e.target.value })} /></Field>
              <Field label={t('people.effective_from')} htmlFor="nfrom"><input id="nfrom" type="date" required value={rate.effectiveFrom} onChange={(e) => setRate({ ...rate, effectiveFrom: e.target.value })} /></Field>
              <button className="bc-btn" style={{ marginBottom: 16 }}>{t('common.add')}</button>
            </form>
          )}
        </>
      )}
    </Drawer>
  );
}

import { useEffect, useState, type FormEvent } from 'react';
import type { Company, PayrollSettingsInput } from '@bluecollar/shared';
import { useApi } from '../../hooks/useApi';
import { useAuth, useMembership } from '../../hooks/useAuth';
import { errorMessage, patch, post, put } from '../../lib/api';
import { t } from '../../i18n';
import { Alert, Card, Field, Loading, Page } from '../../components/ui';

const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
type Settings = PayrollSettingsInput & { profile: { name: string; legalReviewNotes: string[] } };

export default function SettingsPage() {
  const m = useMembership();
  const { can, reload } = useAuth();
  const base = `/companies/${m.companyId}`;
  const company = useApi<Company>(`${base}`, [m.companyId]);
  const payroll = useApi<Settings>(can('payroll.view') || can('company.settings.manage') ? `${base}/payroll-settings` : null, [m.companyId]);
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  return (
    <Page title={t('settings.title')}>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      {company.data && <CompanyForm company={company.data} editable={can('company.settings.manage')} onSave={async (body) => {
        try { await patch(base, body); setMsg({ kind: 'success', text: '✓' }); void company.reload(); void reload(); } catch (e) { setMsg({ kind: 'error', text: errorMessage(e) }); }
      }} />}
      {payroll.loading && !payroll.data ? <Loading /> : payroll.data && <PayrollRules value={payroll.data} editable={can('payroll.manage')} onSave={async (body) => {
        try { await put(`${base}/payroll-settings`, body); setMsg({ kind: 'success', text: '✓' }); void payroll.reload(); } catch (e) { setMsg({ kind: 'error', text: errorMessage(e) }); }
      }} />}
      <Card title={t('settings.security')}>
        <button className="bc-btn secondary" onClick={async () => { await post('/me/sign-out-everywhere'); setMsg({ kind: 'success', text: t('settings.sign_out_everywhere_done') }); }}>{t('settings.sign_out_everywhere')}</button>
      </Card>
    </Page>
  );
}

function CompanyForm({ company, editable, onSave }: { company: Company; editable: boolean; onSave: (b: Record<string, unknown>) => Promise<void> }) {
  const [f, setF] = useState({ name: company.name, phone: company.phone ?? '', address: company.address ?? '' });
  return (
    <Card title={t('settings.company')}>
      <form onSubmit={(e) => { e.preventDefault(); void onSave({ name: f.name, phone: f.phone || null, address: f.address || null }); }}>
        <fieldset disabled={!editable} style={{ border: 0, padding: 0, margin: 0 }}>
          <Field label={t('onboard.company_name')} htmlFor="cname"><input id="cname" required minLength={2} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <div className="bc-row">
            <Field label={t('common.phone')} htmlFor="cphone"><input id="cphone" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
            <Field label={t('common.address')} htmlFor="caddr"><input id="caddr" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
          </div>
          <p className="bc-muted">{t('onboard.timezone')}: {company.timezone}</p>
          {editable && <div className="bc-actions"><button className="bc-btn">{t('common.save')}</button></div>}
        </fieldset>
      </form>
    </Card>
  );
}

function PayrollRules({ value, editable, onSave }: { value: Settings; editable: boolean; onSave: (b: PayrollSettingsInput) => Promise<void> }) {
  const [f, setF] = useState(value);
  useEffect(() => setF(value), [value]);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setF({ ...f, [k]: v });
  function submit(e: FormEvent) {
    e.preventDefault();
    const { profile: _p, ...body } = f;
    void _p;
    void onSave(body);
  }
  return (
    <Card title={t('payroll.settings')}>
      <Alert kind="info">
        {t('payroll.legal_note')}
        <ul style={{ margin: '6px 0 0 18px', padding: 0 }}>{value.profile.legalReviewNotes.map((n) => <li key={n}>{n}</li>)}</ul>
      </Alert>
      <form onSubmit={submit}>
        <fieldset disabled={!editable} style={{ border: 0, padding: 0, margin: 0 }}>
          <p className="bc-muted">{t('payroll.rules_profile')}: <strong>{value.profile.name}</strong></p>
          <div className="bc-row">
            <Field label={t('payroll.daily_ot')} htmlFor="d"><input id="d" type="number" step="0.25" min={1} max={8} value={f.dailyThresholdMinutes / 60} onChange={(e) => set('dailyThresholdMinutes', Math.round(Number(e.target.value) * 60))} /></Field>
            <Field label={t('payroll.weekly_ot')} htmlFor="w"><input id="w" type="number" step="0.5" min={1} max={44} value={f.weeklyThresholdMinutes / 60} onChange={(e) => set('weeklyThresholdMinutes', Math.round(Number(e.target.value) * 60))} /></Field>
            <Field label={t('payroll.ot_rate')} htmlFor="r"><input id="r" type="number" step="0.25" min={1.5} max={5} value={f.overtimeMultiplier} onChange={(e) => set('overtimeMultiplier', Number(e.target.value))} /></Field>
          </div>
          <div className="bc-row">
            <Field label={t('payroll.week_start')} htmlFor="ws">
              <select id="ws" value={f.workWeekStartDow} onChange={(e) => set('workWeekStartDow', Number(e.target.value))}>{DOW.map((d, i) => <option key={d} value={i}>{d}</option>)}</select>
            </Field>
            <Field label={t('payroll.frequency')} htmlFor="pf">
              <select id="pf" value={f.payFrequency} onChange={(e) => set('payFrequency', e.target.value as Settings['payFrequency'])}>
                <option value="weekly">Weekly</option><option value="biweekly">Every 2 weeks</option><option value="semimonthly">Twice a month</option><option value="monthly">Monthly</option>
              </select>
            </Field>
            <Field label={t('payroll.anchor')} htmlFor="pa"><input id="pa" type="date" value={f.payPeriodAnchor} onChange={(e) => set('payPeriodAnchor', e.target.value)} /></Field>
          </div>
          <label className="bc-check"><input type="checkbox" checked={f.paidBreaks} onChange={(e) => set('paidBreaks', e.target.checked)} />{t('payroll.paid_breaks')}</label>
          <label className="bc-check"><input type="checkbox" checked={f.overtimeAgreementBanking} onChange={(e) => set('overtimeAgreementBanking', e.target.checked)} />{t('payroll.banking')}</label>
          <label className="bc-check"><input type="checkbox" checked={!!f.averaging?.enabled} onChange={(e) => set('averaging', e.target.checked ? { enabled: true, periodWeeks: 2, anchorDate: f.payPeriodAnchor } : null)} />{t('payroll.averaging')}</label>
          {f.averaging?.enabled && (
            <div className="bc-row">
              <Field label={t('payroll.averaging_weeks')} htmlFor="aw"><input id="aw" type="number" min={1} max={52} value={f.averaging.periodWeeks} onChange={(e) => set('averaging', { ...f.averaging!, periodWeeks: Number(e.target.value) })} /></Field>
              <Field label={t('payroll.averaging_start')} htmlFor="as"><input id="as" type="date" value={f.averaging.anchorDate} onChange={(e) => set('averaging', { ...f.averaging!, anchorDate: e.target.value })} /></Field>
            </div>
          )}
          {editable && <div className="bc-actions"><button className="bc-btn">{t('common.save')}</button></div>}
        </fieldset>
      </form>
    </Card>
  );
}

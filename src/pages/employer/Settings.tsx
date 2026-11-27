import { useEffect, useState, type FormEvent } from 'react';
import type { Company, PayrollSettingsInput } from '@bluecollar/shared';
import { useApi } from '../../hooks/useApi';
import { useAuth, useMembership } from '../../hooks/useAuth';
import { errorMessage, patch, post, put } from '../../lib/api';
import { t, type MessageKey } from '../../i18n';
import { Alert, Card, Field, Loading, Page } from '../../components/ui';
import { COUNTRY_OPTIONS, ZONES, type CountryCode } from '../../lib/zones';

const DOW_KEYS: MessageKey[] = ['dow.0', 'dow.1', 'dow.2', 'dow.3', 'dow.4', 'dow.5', 'dow.6'];
type Settings = PayrollSettingsInput;

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
        try { await patch(base, body); setMsg({ kind: 'success', text: t('common.saved') }); void company.reload(); void payroll.reload(); void reload(); } catch (e) { setMsg({ kind: 'error', text: errorMessage(e) }); }
      }} />}
      {payroll.loading && !payroll.data ? <Loading /> : payroll.data && <PayPolicy value={payroll.data} editable={can('payroll.manage')} onSave={async (body) => {
        try { await put(`${base}/payroll-settings`, body); setMsg({ kind: 'success', text: t('common.saved') }); void payroll.reload(); } catch (e) { setMsg({ kind: 'error', text: errorMessage(e) }); }
      }} />}
      <Card title={t('settings.security')}>
        <button className="bc-btn secondary" onClick={async () => { await post('/me/sign-out-everywhere'); setMsg({ kind: 'success', text: t('settings.sign_out_everywhere_done') }); }}>{t('settings.sign_out_everywhere')}</button>
      </Card>
    </Page>
  );
}

function CompanyForm({ company, editable, onSave }: { company: Company; editable: boolean; onSave: (b: Record<string, unknown>) => Promise<void> }) {
  const [f, setF] = useState({ name: company.name, phone: company.phone ?? '', address: company.address ?? '', country: (company.country ?? 'CA') as CountryCode, currency: company.currency ?? 'CAD', timezone: company.timezone });
  const zones = ZONES[f.country];
  const zoneList = zones.some((z) => z.id === f.timezone) ? zones : [{ id: f.timezone, label: f.timezone }, ...zones];
  return (
    <Card title={t('settings.company')}>
      <form onSubmit={(e) => { e.preventDefault(); void onSave({ name: f.name, phone: f.phone || null, address: f.address || null, country: f.country, currency: f.currency, timezone: f.timezone }); }}>
        <fieldset disabled={!editable} style={{ border: 0, padding: 0, margin: 0 }}>
          <Field label={t('onboard.company_name')} htmlFor="cname"><input id="cname" required minLength={2} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <div className="bc-row">
            <Field label={t('common.phone')} htmlFor="cphone"><input id="cphone" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
            <Field label={t('common.address')} htmlFor="caddr"><input id="caddr" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
          </div>
          <div className="bc-row">
            <Field label={t('onboard.country')} htmlFor="ccountry">
              <select id="ccountry" value={f.country} onChange={(e) => {
                const c = e.target.value as CountryCode;
                setF({ ...f, country: c, currency: COUNTRY_OPTIONS.find((x) => x.code === c)!.currency, timezone: ZONES[c][0]!.id });
              }}>
                {COUNTRY_OPTIONS.map((c) => <option key={c.code} value={c.code}>{t(`country.${c.code}`)}</option>)}
              </select>
            </Field>
            <Field label={t('settings.currency')} htmlFor="ccur">
              <select id="ccur" value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value as Company['currency'] })}>
                {['CAD', 'USD', 'MXN'].map((c) => <option key={c}>{c}</option>)}
              </select>
            </Field>
            <Field label={t('onboard.timezone')} htmlFor="ctz">
              <select id="ctz" value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })}>
                {zoneList.map((z) => <option key={z.id} value={z.id}>{z.label}</option>)}
              </select>
            </Field>
          </div>
          {editable && <div className="bc-actions"><button className="bc-btn">{t('common.save')}</button></div>}
        </fieldset>
      </form>
    </Card>
  );
}

function PayPolicy({ value, editable, onSave }: { value: Settings; editable: boolean; onSave: (b: PayrollSettingsInput) => Promise<void> }) {
  const [f, setF] = useState(value);
  useEffect(() => setF(value), [value]);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setF({ ...f, [k]: v });
  function submit(e: FormEvent) {
    e.preventDefault();
    void onSave(f);
  }
  const hours = (min: number) => Math.round((min / 60) * 100) / 100;
  return (
    <Card title={t('payroll.settings')}>
      <Alert kind="info">{t('payroll.policy_note')}</Alert>
      <form onSubmit={submit}>
        <fieldset disabled={!editable} style={{ border: 0, padding: 0, margin: 0 }}>
          <label className="bc-check"><input type="checkbox" checked={f.dailyOvertimeEnabled} onChange={(e) => set('dailyOvertimeEnabled', e.target.checked)} />{t('payroll.daily_ot_on')}</label>
          {f.dailyOvertimeEnabled && (
            <Field label={t('payroll.daily_ot')} htmlFor="d"><input id="d" type="number" step="0.25" min={1} max={24} value={hours(f.dailyThresholdMinutes)} onChange={(e) => set('dailyThresholdMinutes', Math.round(Number(e.target.value) * 60))} /></Field>
          )}
          <label className="bc-check"><input type="checkbox" checked={f.weeklyOvertimeEnabled} onChange={(e) => set('weeklyOvertimeEnabled', e.target.checked)} />{t('payroll.weekly_ot_on')}</label>
          {f.weeklyOvertimeEnabled && (
            <Field label={t('payroll.weekly_ot')} htmlFor="w"><input id="w" type="number" step="0.5" min={1} max={168} value={hours(f.weeklyThresholdMinutes)} onChange={(e) => set('weeklyThresholdMinutes', Math.round(Number(e.target.value) * 60))} /></Field>
          )}
          {!f.dailyOvertimeEnabled && !f.weeklyOvertimeEnabled && <p className="bc-muted">{t('payroll.no_ot')}</p>}
          {(f.dailyOvertimeEnabled || f.weeklyOvertimeEnabled) && (
            <Field label={t('payroll.ot_rate')} htmlFor="r" hint={t('payroll.ot_rate_hint')}><input id="r" type="number" step="0.05" min={1} max={5} value={f.overtimeMultiplier} onChange={(e) => set('overtimeMultiplier', Number(e.target.value))} /></Field>
          )}
          <div className="bc-row">
            <Field label={t('payroll.week_start')} htmlFor="ws">
              <select id="ws" value={f.workWeekStartDow} onChange={(e) => set('workWeekStartDow', Number(e.target.value))}>{DOW_KEYS.map((d, i) => <option key={d} value={i}>{t(d)}</option>)}</select>
            </Field>
            <Field label={t('payroll.frequency')} htmlFor="pf">
              <select id="pf" value={f.payFrequency} onChange={(e) => set('payFrequency', e.target.value as Settings['payFrequency'])}>
                <option value="weekly">{t('payroll.freq_weekly')}</option><option value="biweekly">{t('payroll.freq_biweekly')}</option>
                <option value="semimonthly">{t('payroll.freq_semimonthly')}</option><option value="monthly">{t('payroll.freq_monthly')}</option>
              </select>
            </Field>
            <Field label={t('payroll.anchor')} htmlFor="pa"><input id="pa" type="date" value={f.payPeriodAnchor} onChange={(e) => set('payPeriodAnchor', e.target.value)} /></Field>
          </div>
          <label className="bc-check"><input type="checkbox" checked={f.paidBreaks} onChange={(e) => set('paidBreaks', e.target.checked)} />{t('payroll.paid_breaks')}</label>
          <label className="bc-check"><input type="checkbox" checked={f.overtimeAgreementBanking} onChange={(e) => set('overtimeAgreementBanking', e.target.checked)} />{t('payroll.banking')}</label>
          {f.weeklyOvertimeEnabled && (
            <label className="bc-check"><input type="checkbox" checked={!!f.averaging?.enabled} onChange={(e) => set('averaging', e.target.checked ? { enabled: true, periodWeeks: 2, anchorDate: f.payPeriodAnchor } : null)} />{t('payroll.averaging')}</label>
          )}
          {f.weeklyOvertimeEnabled && f.averaging?.enabled && (
            <div className="bc-row">
              <Field label={t('payroll.averaging_weeks')} htmlFor="aw"><input id="aw" type="number" min={1} max={52} value={f.averaging.periodWeeks} onChange={(e) => set('averaging', { ...f.averaging!, periodWeeks: Number(e.target.value) })} /></Field>
              <Field label={t('payroll.averaging_start')} htmlFor="as"><input id="as" type="date" value={f.averaging.anchorDate} onChange={(e) => set('averaging', { ...f.averaging!, anchorDate: e.target.value })} /></Field>
            </div>
          )}
          <Field label={t('payroll.adp_code')} htmlFor="adp" hint={t('payroll.adp_code_hint')}>
            <input id="adp" maxLength={3} value={f.adpCompanyCode ?? ''} onChange={(e) => set('adpCompanyCode', e.target.value.trim() ? e.target.value.trim().toUpperCase() : null)} style={{ maxWidth: 120 }} />
          </Field>
          {editable && <div className="bc-actions"><button className="bc-btn">{t('common.save')}</button></div>}
        </fieldset>
      </form>
    </Card>
  );
}

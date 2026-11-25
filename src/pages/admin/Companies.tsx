import { useState } from 'react';
import { useApi } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import { errorMessage, post } from '../../lib/api';
import { fmtDate } from '../../lib/format';
import { t } from '../../i18n';
import { Alert, Badge, Card, Empty, Field, Loading, Page } from '../../components/ui';
import CompanyDetail from './CompanyDetail';
import { useCritical } from './Dashboard';

interface Row { id: string; name: string; status: string; created_at: string; owner_email: string | null; owner_name: string | null; members: number; suspended_reason: string | null }

export default function Companies() {
  const { me } = useAuth();
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const { data, error, loading, reload } = useApi<{ items: Row[] }>(`/admin/companies?limit=100${q ? `&search=${encodeURIComponent(q)}` : ''}`, [q]);
  const [open, setOpen] = useState<string | null>(null);
  const [support, setSupport] = useState<{ companyId: string; reason: string; minutes: number } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const { critical, dialog } = useCritical();
  const canSupport = me?.platform?.permissions.includes('platform.support_access.request');

  return (
    <Page title={t('admin.companies')}>
      <Alert kind="info">{t('admin.no_company_data')}</Alert>
      {msg && <Alert kind="info">{msg}</Alert>}
      {error && <Alert kind="error">{error}</Alert>}
      <Card>
        <form className="bc-row" onSubmit={(e) => { e.preventDefault(); setQ(search); }}>
          <Field label={t('common.search')} htmlFor="cs"><input id="cs" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Company or owner email" /></Field>
          <button className="bc-btn" style={{ marginBottom: 16 }}>{t('common.search')}</button>
        </form>
        {loading && !data ? <Loading /> : !data?.items.length ? <Empty title={t('common.not_found')} /> : (
          <table className="bc-table">
            <thead><tr><th>{t('common.name')}</th><th>Owner</th><th className="num">Members</th><th>{t('common.status')}</th><th>Created</th><th /></tr></thead>
            <tbody>{data.items.map((c) => (
              <tr key={c.id} className="clickable" onClick={() => setOpen(c.id)}>
                <td><strong>{c.name}</strong></td>
                <td>{c.owner_name}<div className="bc-muted">{c.owner_email}</div></td>
                <td className="num">{c.members}</td>
                <td><Badge kind={c.status === 'active' ? 'success' : 'error'}>{c.status}</Badge></td>
                <td>{fmtDate(c.created_at)}</td>
                <td className="num" onClick={(e) => e.stopPropagation()}>{canSupport && <button className="bc-btn ghost small" onClick={() => setSupport({ companyId: c.id, reason: '', minutes: 60 })}>{t('admin.support_request')}</button>}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </Card>
      {support && (
        <Card title={t('admin.support_request')}>
          <Field label={t('common.reason')} htmlFor="sr"><textarea id="sr" minLength={10} value={support.reason} onChange={(e) => setSupport({ ...support, reason: e.target.value })} /></Field>
          <Field label={t('admin.support_minutes')} htmlFor="sm"><input id="sm" type="number" min={15} max={240} value={support.minutes} onChange={(e) => setSupport({ ...support, minutes: Number(e.target.value) })} /></Field>
          <div className="bc-actions">
            <button className="bc-btn secondary" onClick={() => setSupport(null)}>{t('common.cancel')}</button>
            <button className="bc-btn" disabled={support.reason.trim().length < 10} onClick={async () => {
              try { if (await critical(() => post('/admin/support-access', support).then(() => undefined))) { setMsg('Support access granted and audited.'); setSupport(null); } }
              catch (e) { setMsg(errorMessage(e)); }
            }}>{t('common.confirm')}</button>
          </div>
        </Card>
      )}
      {open && <CompanyDetail id={open} onClose={() => setOpen(null)} onChanged={() => void reload()} critical={critical} />}
      {dialog}
    </Page>
  );
}

import { useState } from 'react';
import { useApi } from '../../hooks/useApi';
import { useAuth, useMembership } from '../../hooks/useAuth';
import { download, errorMessage, get } from '../../lib/api';
import { fmtDateTime, today } from '../../lib/format';
import { t } from '../../i18n';
import { Alert, Card, Empty, Field, Loading, Page } from '../../components/ui';

type Kind = 'hours' | 'attendance' | 'adjustments';

export default function Reports() {
  const m = useMembership();
  const { can } = useAuth();
  const base = `/companies/${m.companyId}`;
  const [kind, setKind] = useState<Kind>('hours');
  const [range, setRange] = useState({ from: today(-30), to: today() });
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const audit = useApi<{ items: { id: number; action: string; actorName: string; createdAt: string; targetType: string; success: boolean }[] }>(can('audit.view') ? `${base}/audit?limit=50` : null, [m.companyId]);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const r = await get<{ items: Record<string, unknown>[] }>(`${base}/reports/${kind}?from=${range.from}&to=${range.to}`);
      setRows(r.items);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const cols = rows?.[0] ? Object.keys(rows[0]) : [];
  return (
    <Page title={t('reports.title')}>
      <Card>
        <div className="bc-row">
          <Field label={t('reports.title')} htmlFor="rk">
            <select id="rk" value={kind} onChange={(e) => { setKind(e.target.value as Kind); setRows(null); }}>
              <option value="hours">{t('reports.hours')}</option>
              <option value="attendance">{t('reports.attendance')}</option>
              <option value="adjustments">{t('reports.adjustments')}</option>
            </select>
          </Field>
          <Field label={t('common.from')} htmlFor="rf"><input id="rf" type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></Field>
          <Field label={t('common.to')} htmlFor="rt"><input id="rt" type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></Field>
          <div className="bc-actions" style={{ marginBottom: 16 }}>
            <button className="bc-btn" disabled={busy} onClick={() => void run()}>{t('reports.run')}</button>
            <button className="bc-btn secondary" onClick={() => void download(`${base}/reports/${kind}?from=${range.from}&to=${range.to}&format=csv`, `${kind}-${range.from}-${range.to}.csv`)}>{t('common.export_csv')}</button>
          </div>
        </div>
        {error && <Alert kind="error">{error}</Alert>}
        {busy ? <Loading /> : rows && (rows.length === 0 ? <Empty title={t('ts.none')} /> : (
          <div className="bc-table-wrap">
            <table className="bc-table">
              <thead><tr>{cols.map((c) => <th key={c}>{c}</th>)}</tr></thead>
              <tbody>{rows.map((r, i) => <tr key={i}>{cols.map((c) => <td key={c}>{typeof r[c] === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(r[c] as string) ? fmtDateTime(r[c] as string) : String(r[c] ?? '—')}</td>)}</tr>)}</tbody>
            </table>
          </div>
        ))}
      </Card>
      {can('audit.view') && (
        <Card title={t('reports.audit')}>
          {audit.loading && !audit.data ? <Loading /> : (
            <table className="bc-table">
              <tbody>{audit.data?.items.map((a) => <tr key={a.id}><td className="bc-muted">{fmtDateTime(a.createdAt)}</td><td>{a.actorName}</td><td><code>{a.action}</code></td><td>{a.success ? '✓' : '✗'}</td></tr>)}</tbody>
            </table>
          )}
        </Card>
      )}
    </Page>
  );
}

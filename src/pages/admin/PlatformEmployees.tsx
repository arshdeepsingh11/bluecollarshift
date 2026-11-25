import { useState, type FormEvent } from 'react';
import { PLATFORM_ROLES, type PlatformRole } from '@bluecollar/shared';
import { useApi } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import { errorMessage, patch, post } from '../../lib/api';
import { fmtDateTime } from '../../lib/format';
import { t } from '../../i18n';
import { Alert, Badge, Card, Field, Loading, Page } from '../../components/ui';
import { useCritical } from './Dashboard';

interface Staff { user_id: string; full_name: string; email: string; role: PlatformRole; status: string; last_seen: string | null }

export default function PlatformStaff() {
  const { me } = useAuth();
  const { data, error, loading, reload } = useApi<{ items: Staff[] }>('/admin/staff');
  const canManage = me?.platform?.permissions.includes('platform.staff.manage');
  const [f, setF] = useState({ email: '', fullName: '', role: 'support' as PlatformRole });
  const [msg, setMsg] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const { critical, dialog } = useCritical();

  async function run(fn: () => Promise<unknown>, done: string) {
    setMsg(null);
    try {
      if (await critical(async () => void (await fn()))) {
        setMsg({ kind: 'success', text: done });
        void reload();
      }
    } catch (e) {
      setMsg({ kind: 'error', text: errorMessage(e) });
    }
  }

  return (
    <Page title={t('nav.admin_staff')}>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      {error && <Alert kind="error">{error}</Alert>}
      <Card>
        {loading && !data ? <Loading /> : (
          <table className="bc-table">
            <thead><tr><th>{t('common.name')}</th><th>{t('common.role')}</th><th>{t('common.status')}</th><th>Last seen</th><th /></tr></thead>
            <tbody>{data?.items.map((s) => (
              <tr key={s.user_id}>
                <td><strong>{s.full_name}</strong><div className="bc-muted">{s.email}</div></td>
                <td>
                  {canManage && s.user_id !== me?.userId ? (
                    <select className="bc-input" value={s.role} onChange={(e) => void run(() => patch(`/admin/staff/${s.user_id}`, { role: e.target.value }), '✓')}>
                      {PLATFORM_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  ) : s.role}
                </td>
                <td><Badge kind={s.status === 'active' ? 'success' : 'error'}>{s.status}</Badge></td>
                <td className="bc-muted">{fmtDateTime(s.last_seen)}</td>
                <td className="num">
                  {canManage && s.user_id !== me?.userId && (
                    <>
                      <button className="bc-btn ghost small" onClick={() => void run(() => post(`/admin/users/${s.user_id}/revoke-sessions`), '✓')}>{t('admin.revoke_sessions')}</button>
                      <button className="bc-btn secondary small" onClick={() => void run(() => patch(`/admin/staff/${s.user_id}`, { status: s.status === 'active' ? 'suspended' : 'active' }), '✓')}>
                        {s.status === 'active' ? 'Suspend' : 'Reactivate'}
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </Card>
      {canManage && (
        <Card title={t('admin.staff_add')}>
          <form className="bc-row" onSubmit={(e: FormEvent) => { e.preventDefault(); void run(() => post('/admin/staff', f), '✓'); }}>
            <Field label={t('common.name')} htmlFor="sn"><input id="sn" required value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} /></Field>
            <Field label={t('common.email')} htmlFor="se"><input id="se" type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
            <Field label={t('common.role')} htmlFor="sro">
              <select id="sro" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as PlatformRole })}>{PLATFORM_ROLES.map((r) => <option key={r}>{r}</option>)}</select>
            </Field>
            <button className="bc-btn" style={{ marginBottom: 16 }}>{t('common.add')}</button>
          </form>
        </Card>
      )}
      {dialog}
    </Page>
  );
}

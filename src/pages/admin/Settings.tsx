import { useState } from 'react';
import { useApi } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import { errorMessage, put } from '../../lib/api';
import { t } from '../../i18n';
import { Alert, Card, Field, Loading, Page } from '../../components/ui';
import { useCritical } from './Dashboard';

export default function PlatformSettings() {
  const { me } = useAuth();
  const canManage = me?.platform?.permissions.includes('platform.settings.manage');
  const { data, error, loading, reload } = useApi<{ items: { key: string; value: unknown }[] }>('/admin/settings');
  const get = (k: string) => data?.items.find((i) => i.key === k)?.value;
  const [version, setVersion] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const { critical, dialog } = useCritical();

  async function save(key: string, value: unknown) {
    setMsg(null);
    try {
      if (await critical(() => put(`/admin/settings/${key}`, { value }).then(() => undefined))) {
        setMsg({ kind: 'success', text: '✓' });
        void reload();
      }
    } catch (e) {
      setMsg({ kind: 'error', text: errorMessage(e) });
    }
  }

  return (
    <Page title={t('nav.admin_settings')}>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      {error && <Alert kind="error">{error}</Alert>}
      {loading && !data ? <Loading /> : (
        <Card>
          <label className="bc-check">
            <input type="checkbox" disabled={!canManage} checked={get('maintenance_mode') === true} onChange={(e) => void save('maintenance_mode', e.target.checked)} />
            {t('admin.maintenance')}
          </label>
          <div className="bc-row">
            <Field label={t('admin.min_version')} htmlFor="mv"><input id="mv" disabled={!canManage} value={version ?? String(get('min_mobile_version') ?? '1.0.0')} onChange={(e) => setVersion(e.target.value)} /></Field>
            {canManage && <button className="bc-btn" style={{ marginBottom: 16 }} disabled={!version || !/^\d+\.\d+\.\d+$/.test(version)} onClick={() => void save('min_mobile_version', version)}>{t('common.save')}</button>}
          </div>
        </Card>
      )}
      {dialog}
    </Page>
  );
}

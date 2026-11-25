import { useEffect } from 'react';
import type { Notification } from '@bluecollar/shared';
import { useApi } from '../hooks/useApi';
import { post } from '../lib/api';
import { getSocket } from '../lib/realtime';
import { fmtDateTime } from '../lib/format';
import { t } from '../i18n';
import { Alert, Card, Empty, Loading, Page } from './ui';

export default function NotificationsPage() {
  const { data, error, loading, reload } = useApi<{ items: Notification[]; unread: number }>('/notifications?limit=100');
  useEffect(() => {
    const s = getSocket();
    const r = () => void reload();
    s.on('notification:new', r);
    return () => void s.off('notification:new', r);
  }, [reload]);
  return (
    <Page title={t('notif.title')} actions={!!data?.unread && <button className="bc-btn secondary" onClick={async () => { await post('/notifications/read-all'); void reload(); }}>{t('notif.mark_all')}</button>}>
      {error && <Alert kind="error">{error}</Alert>}
      <Card>
        {loading && !data ? <Loading /> : !data?.items.length ? <Empty title={t('notif.none')} /> : (
          <table className="bc-table">
            <tbody>
              {data.items.map((n) => (
                <tr key={n.id} className="clickable" style={{ fontWeight: n.readAt ? 400 : 600 }} onClick={async () => { if (!n.readAt) { await post(`/notifications/${n.id}/read`); void reload(); } }}>
                  <td>{n.title}<div className="bc-muted" style={{ fontWeight: 400 }}>{n.body}</div></td>
                  <td className="bc-muted num">{fmtDateTime(n.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </Page>
  );
}

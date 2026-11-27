import { t } from '../src/i18n';
import { useCallback, useEffect, useState } from 'react';
import type { Notification } from '@bluecollar/shared';
import { api } from '../src/lib/api';
import { getSocket } from '../src/lib/realtime';
import { Button, Card, Loading, Muted, Row, Screen, fmtDateTime } from '../src/ui';

export default function Notifications() {
  const [items, setItems] = useState<Notification[] | null>(null);
  const load = useCallback(async () => {
    try {
      setItems((await api<{ items: Notification[] }>('/notifications?limit=50')).items);
    } catch {
      setItems((prev) => prev ?? []);
    }
  }, []);
  useEffect(() => {
    void load();
    const sock = getSocket();
    const on = () => void load();
    sock.on('notification:new', on);
    return () => { sock.off('notification:new', on); };
  }, [load]);
  if (!items) return <Screen><Loading /></Screen>;
  return (
    <Screen onRefresh={() => void load()}>
      {items.some((n) => !n.readAt) && <Button kind="secondary" title={t('mark_all_read')} onPress={() => void api('/notifications/read-all', { method: 'POST' }).then(load)} />}
      <Card>
        {!items.length && <Muted>{t('nothing_yet')}</Muted>}
        {items.map((n) => (
          <Row
            key={n.id}
            title={`${n.readAt ? '' : '● '}${n.title}`}
            subtitle={`${n.body} · ${fmtDateTime(n.createdAt)}`}
            onPress={n.readAt ? undefined : () => void api(`/notifications/${n.id}/read`, { method: 'POST' }).then(load)}
          />
        ))}
      </Card>
    </Screen>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { Text } from 'react-native';
import { useSession } from '../src/state/session';
import { engine } from '../src/lib/attendance';
import { sqliteEventStore } from '../src/lib/db';
import type { QueuedEvent } from '../src/lib/sync/engine';
import { t } from '../src/i18n';
import { Badge, Button, Card, Muted, Screen, fmtDateTime } from '../src/ui';

const tone = { saved: 'info', pending: 'info', synced: 'success', needs_review: 'warning', rejected: 'error' } as const;

/** Every clock event on this phone and its sync state. Nothing here is ever deleted automatically. */
export default function SyncScreen() {
  const { membership } = useSession();
  const [items, setItems] = useState<QueuedEvent[]>([]);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => setItems(await sqliteEventStore.all(membership?.companyId)), [membership]);
  useEffect(() => {
    void load();
    return engine.subscribe(() => void load());
  }, [load]);
  return (
    <Screen onRefresh={() => void load()}>
      <Button title={t('retry')} loading={busy} onPress={async () => { setBusy(true); await engine.retryNow(); await load(); setBusy(false); }} />
      {!items.length && <Muted>No clock events on this phone yet.</Muted>}
      {items.map((e) => (
        <Card key={e.id}>
          <Text style={{ fontWeight: '700' }}>{e.type.replace('_', ' ')} · {fmtDateTime(e.deviceTime)}</Text>
          <Badge tone={tone[e.state]} text={e.state.replace('_', ' ')} />
          {e.recordedOffline && <Muted>Recorded offline</Muted>}
          {e.flags.length > 0 && <Muted>Flags: {e.flags.join(', ')}</Muted>}
          {e.lastError && <Muted>{e.lastError}</Muted>}
          {e.attempts > 0 && e.state === 'pending' && <Muted>Attempts: {e.attempts}</Muted>}
        </Card>
      ))}
    </Screen>
  );
}

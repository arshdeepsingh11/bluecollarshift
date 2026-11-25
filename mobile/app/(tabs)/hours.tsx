import { useCallback, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import type { WorkSession } from '@bluecollar/shared';
import { useSession } from '../../src/state/session';
import { api } from '../../src/lib/api';
import { cacheGet, cacheSet } from '../../src/lib/db';
import { t } from '../../src/i18n';
import { Badge, Banner, Card, H1, Loading, Muted, Row, Screen, fmtDay, fmtMinutes, fmtTime } from '../../src/ui';

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export default function Hours() {
  const { membership } = useSession();
  const companyId = membership!.companyId;
  const [items, setItems] = useState<WorkSession[] | null>(null);
  const [offline, setOffline] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const to = isoDay(new Date(Date.now() + 86400_000));
    const from = isoDay(new Date(Date.now() - 31 * 86400_000));
    try {
      const r = await api<{ items: WorkSession[] }>(`/companies/${companyId}/timesheets?membershipId=${membership!.membershipId}&from=${from}&to=${to}`);
      setItems(r.items);
      setOffline(false);
      await cacheSet(`hours:${companyId}`, r.items);
    } catch {
      const c = await cacheGet<WorkSession[]>(`hours:${companyId}`);
      setItems(c?.value ?? []);
      setOffline(true);
    }
  }, [companyId, membership]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));
  if (!items) return <Screen><Loading /></Screen>;
  const total = items.reduce((n, s) => n + (s.paidMinutes ?? 0), 0);

  return (
    <Screen refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }}>
      <H1>{t('hours')}</H1>
      <Muted>Last 31 days · {fmtMinutes(total)} paid</Muted>
      {offline && <Banner tone="warning" text={t('offline')} />}
      <Card>
        {!items.length && <Muted>No work recorded yet.</Muted>}
        {items.map((s) => (
          <Row
            key={s.id}
            onPress={() => router.push({ pathname: '/timesheet/[id]', params: { id: s.id } })}
            title={`${fmtDay(s.effectiveStart)} · ${fmtTime(s.effectiveStart)}–${fmtTime(s.effectiveEnd)}`}
            subtitle={`${s.siteName ?? 'No site'} · ${fmtMinutes(s.paidMinutes)}${s.adjusted ? ' · adjusted' : ''}`}
            right={
              s.openDisputes ? <Badge tone="warning" text="Disputed" /> :
              s.status === 'needs_review' ? <Badge tone="warning" text="Review" /> :
              s.approvalStatus === 'approved' ? <Badge tone="success" text="Approved" /> :
              s.status === 'open' ? <Badge tone="info" text="Working" /> : <Badge text="Pending" />
            }
          />
        ))}
      </Card>
    </Screen>
  );
}

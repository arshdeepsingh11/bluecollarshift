import { useCallback, useState } from 'react';
import { Linking, Text } from 'react-native';
import { useFocusEffect } from 'expo-router';
import type { Shift } from '@bluecollar/shared';
import { useSession } from '../../src/state/session';
import { api } from '../../src/lib/api';
import { cacheGet, cacheSet } from '../../src/lib/db';
import { t } from '../../src/i18n';
import { Badge, Banner, Button, Card, H1, Loading, Muted, Screen, fmtDateTime, fmtDay, fmtTime } from '../../src/ui';

type ShiftWithSite = Shift & { site?: { address: string | null; lat: number | null; lng: number | null } };

export default function Schedule() {
  const { membership } = useSession();
  const companyId = membership!.companyId;
  const [shifts, setShifts] = useState<ShiftWithSite[] | null>(null);
  const [cachedAt, setCachedAt] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const from = new Date(Date.now() - 86400_000).toISOString();
    const to = new Date(Date.now() + 28 * 86400_000).toISOString();
    try {
      const r = await api<{ items: ShiftWithSite[] }>(`/companies/${companyId}/shifts?mine=true&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
      setShifts(r.items);
      setCachedAt(null);
      await cacheSet(`shifts:${companyId}`, r.items);
    } catch {
      const c = await cacheGet<ShiftWithSite[]>(`shifts:${companyId}`);
      setShifts(c?.value ?? []);
      setCachedAt(c?.updatedAt ?? null);
    }
  }, [companyId]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  if (!shifts) return <Screen><Loading /></Screen>;
  const upcoming = shifts.filter((s) => Date.parse(s.endsAt) > Date.now()).sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  return (
    <Screen refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }}>
      <H1>{t('schedule')}</H1>
      {cachedAt && <Banner tone="warning" text={t('last_updated', { time: fmtDateTime(new Date(cachedAt).toISOString()) })} />}
      {!upcoming.length && <Muted>{t('no_shifts')}</Muted>}
      {upcoming.map((s) => (
        <Card key={s.id}>
          <Text style={{ fontWeight: '700', fontSize: 16 }}>{fmtDay(s.startsAt)}</Text>
          <Text style={{ fontSize: 16 }}>{fmtTime(s.startsAt)} – {fmtTime(s.endsAt)}</Text>
          <Text style={{ fontWeight: '600' }}>{s.siteName}</Text>
          {s.status === 'cancelled' && <Badge tone="error" text="Cancelled" />}
          {s.breakMinutes > 0 && <Muted>Break: {s.breakMinutes} min</Muted>}
          {s.instructions && <Banner tone="info" text={`${t('instructions')}: ${s.instructions}`} />}
          {s.site?.lat != null && s.site?.lng != null && (
            <Button kind="secondary" title={t('directions')} onPress={() => void Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${s.site!.lat},${s.site!.lng}`)} />
          )}
        </Card>
      ))}
    </Screen>
  );
}

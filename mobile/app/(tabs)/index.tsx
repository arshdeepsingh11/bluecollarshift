import { useCallback, useEffect, useState } from 'react';
import { Linking, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import type { TimeEventType } from '@bluecollar/shared';
import { useSession } from '../../src/state/session';
import { api } from '../../src/lib/api';
import { cacheGet, cacheSet, sqliteEventStore } from '../../src/lib/db';
import { engine, isOnline } from '../../src/lib/attendance';
import { currentLocation, deviceId } from '../../src/lib/device';
import { theme } from '../../src/lib/config';
import { t } from '../../src/i18n';
import { Banner, Button, Card, H1, Loading, Muted, Screen, fmtDateTime, fmtMinutes, fmtTime } from '../../src/ui';

interface Status {
  openSession: { id: string; startedAt: string; onBreakSince: string | null } | null;
  shifts: { id: string; startsAt: string; endsAt: string; instructions: string | null; site: { name: string; address: string | null; lat: number | null; lng: number | null } }[];
  minutesToday: number;
  minutesLast7Days: number;
}

export default function Today() {
  const { membership, offlineProfile, maintenance } = useSession();
  const companyId = membership!.companyId;
  const [status, setStatus] = useState<Status | null>(null);
  const [cachedAt, setCachedAt] = useState<number | null>(null);
  const [allowed, setAllowed] = useState<TimeEventType[]>([]);
  const [lastLocal, setLastLocal] = useState<{ type: string; at: string } | null>(null);
  const [counts, setCounts] = useState({ pending: 0, needsReview: 0, rejected: 0 });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'success' | 'warning' | 'error' | 'info'; text: string } | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const refreshLocal = useCallback(async () => {
    setAllowed(await engine.allowedNext(companyId));
    setCounts(await engine.counts(companyId));
    const last = (await sqliteEventStore.all(companyId)).find((e) => e.state !== 'rejected');
    setLastLocal(last ? { type: last.type, at: last.deviceTime } : null);
  }, [companyId]);

  const load = useCallback(async () => {
    try {
      const s = await api<Status>(`/companies/${companyId}/attendance/me`);
      setStatus(s);
      setCachedAt(null);
      await cacheSet(`status:${companyId}`, s);
    } catch {
      const c = await cacheGet<Status>(`status:${companyId}`);
      if (c) {
        setStatus(c.value);
        setCachedAt(c.updatedAt);
      }
    }
    await refreshLocal();
  }, [companyId, refreshLocal]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));
  useEffect(() => engine.subscribe(() => void refreshLocal()), [refreshLocal]);

  async function record(type: TimeEventType) {
    setBusy(true);
    setMsg(null);
    try {
      const location = await currentLocation();
      const shift = status?.shifts.find((s) => Date.parse(s.startsAt) - 2 * 3600_000 < Date.now() && Date.parse(s.endsAt) > Date.now());
      await engine.record({ companyId, type, shiftId: type === 'clock_in' ? (shift?.id ?? null) : null, location, deviceId: await deviceId(), online: isOnline() });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      const summary = isOnline() ? await engine.sync() : null;
      if (!location) setMsg({ tone: 'warning', text: t('location_off') });
      else if (!summary || summary.networkError) setMsg({ tone: 'info', text: t('saved_offline') });
      else setMsg({ tone: 'success', text: t('synced') });
      await load();
    } catch (e) {
      setMsg({ tone: 'error', text: e instanceof Error ? e.message : 'Error' });
    } finally {
      setBusy(false);
    }
  }

  if (!status && !lastLocal) return <Screen><Loading /></Screen>;
  // Local state wins when events are pending (the server has not seen them yet).
  const working = allowed.includes('clock_out');
  const onBreak = allowed.includes('break_end');
  const since = counts.pending > 0 ? (lastLocal?.at ?? status?.openSession?.startedAt) : (status?.openSession?.startedAt ?? lastLocal?.at);
  const next = status?.shifts[0];

  return (
    <Screen refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await engine.retryNow(); await load(); setRefreshing(false); }}>
      <H1>{t('today')}</H1>
      <Muted>{membership!.companyName}</Muted>
      {maintenance && <Banner tone="warning" text={t('maintenance')} />}
      {(!isOnline() || offlineProfile) && <Banner tone="warning" text={t('offline')} />}
      {counts.pending > 0 && <Banner tone="info" text={t('pending', { n: counts.pending })} onPress={() => router.push('/sync')} />}
      {counts.needsReview > 0 && <Banner tone="warning" text={t('needs_review', { n: counts.needsReview })} onPress={() => router.push('/sync')} />}
      {counts.rejected > 0 && <Banner tone="error" text={t('rejected', { n: counts.rejected })} onPress={() => router.push('/sync')} />}
      {msg && <Banner tone={msg.tone} text={msg.text} />}

      <Card style={{ alignItems: 'center', paddingVertical: 28 }}>
        <Text style={{ fontSize: 16, color: theme.text2 }} accessibilityLiveRegion="polite">
          {working ? (onBreak ? t('on_break') : t('working_since', { time: fmtTime(since) })) : t('not_working')}
        </Text>
        <View style={{ width: '100%', gap: 12, marginTop: 16 }}>
          {allowed.includes('clock_in') && <Button big title={t('clock_in')} onPress={() => void record('clock_in')} loading={busy} />}
          {allowed.includes('break_start') && <Button title={t('start_break')} kind="secondary" onPress={() => void record('break_start')} disabled={busy} />}
          {allowed.includes('break_end') && <Button title={t('end_break')} kind="secondary" onPress={() => void record('break_end')} disabled={busy} />}
          {allowed.includes('clock_out') && <Button big title={t('clock_out')} kind="danger" onPress={() => void record('clock_out')} loading={busy} />}
        </View>
        <Muted style={{ marginTop: 12, textAlign: 'center' }}>{t('privacy')}</Muted>
      </Card>

      <Card>
        <Text style={{ fontWeight: '700', fontSize: 16 }}>{t('next_shift')}</Text>
        {!next ? <Muted>{t('no_shifts')}</Muted> : (
          <>
            <Text style={{ fontSize: 17, fontWeight: '600' }}>{next.site.name}</Text>
            <Text>{fmtDateTime(next.startsAt)} – {fmtTime(next.endsAt)}</Text>
            {next.site.address && <Muted>{next.site.address}</Muted>}
            {next.instructions && <Banner tone="info" text={`${t('instructions')}: ${next.instructions}`} />}
            {next.site.lat !== null && next.site.lng !== null && (
              <Button kind="secondary" title={t('directions')} onPress={() => void Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${next.site.lat},${next.site.lng}`)} />
            )}
          </>
        )}
        {cachedAt && <Muted>{t('last_updated', { time: fmtDateTime(new Date(cachedAt).toISOString()) })}</Muted>}
      </Card>

      {status && (
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <Card style={{ flex: 1 }}><Muted>Today</Muted><Text style={{ fontSize: 22, fontWeight: '700' }}>{fmtMinutes(status.minutesToday)}</Text></Card>
          <Card style={{ flex: 1 }}><Muted>7 days</Muted><Text style={{ fontSize: 22, fontWeight: '700' }}>{fmtMinutes(status.minutesLast7Days)}</Text></Card>
        </View>
      )}
    </Screen>
  );
}

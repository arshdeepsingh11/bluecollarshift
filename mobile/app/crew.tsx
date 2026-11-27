import { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { CrewMember } from '@bluecollar/shared';
import { useSession } from '../src/state/session';
import { crewQueueStatus, flushCrewQueue, loadCrew, sendCrew } from '../src/lib/crew';
import { ApiError } from '../src/lib/api';
import { t } from '../src/i18n';
import { theme } from '../src/lib/config';
import { Badge, Banner, Button, Card, Loading, Muted, Screen, fmtTime } from '../src/ui';

/** Foreman / supervisor: clock in or out several people at once (works offline). */
export default function Crew() {
  const { membership } = useSession();
  const [items, setItems] = useState<CrewMember[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'success' | 'warning' | 'error'; text: string } | null>(null);
  const [queue, setQueue] = useState({ waiting: 0, refused: 0 });

  const load = useCallback(async () => {
    if (!membership) return;
    await flushCrewQueue().catch(() => undefined);
    setQueue(await crewQueueStatus());
    try {
      setItems((await loadCrew(membership.companyId)).items);
    } catch (e) {
      setItems((x) => x ?? []);
      if (e instanceof ApiError && e.status !== 0) setMsg({ tone: 'error', text: e.message });
    }
  }, [membership]);
  useEffect(() => void load(), [load]);

  async function send(type: 'clock_in' | 'clock_out' | 'break_start' | 'break_end') {
    if (!membership || !selected.length) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await sendCrew(membership.companyId, type, selected);
      if (r.queued) setMsg({ tone: 'warning', text: t('crew_queued', { n: selected.length }) });
      else {
        const bad = r.results.filter((x) => x.result === 'rejected');
        setMsg(bad.length ? { tone: 'error', text: bad.map((b) => `${items?.find((i) => i.membershipId === b.membershipId)?.fullName}: ${b.reason}`).join('\n') }
          : { tone: 'success', text: t('crew_done', { n: r.results.length }) });
      }
      setSelected([]);
      await load();
    } catch (e) {
      setMsg({ tone: 'error', text: e instanceof Error ? e.message : t('error_generic') });
    } finally {
      setBusy(false);
    }
  }

  const all = !!items?.length && selected.length === items.length;
  return (
    <Screen onRefresh={() => void load()}>
      <Muted>{t('crew_hint')}</Muted>
      {msg && <Banner tone={msg.tone} text={msg.text} />}
      {queue.waiting > 0 && <Banner tone="warning" text={t('pending', { n: queue.waiting })} />}
      {!items ? <Loading /> : !items.length ? <Card><Muted>{t('crew_empty')}</Muted></Card> : (
        <Card>
          <Pressable onPress={() => setSelected(all ? [] : items.map((i) => i.membershipId))} accessibilityRole="button">
            <Text style={{ color: theme.primary, fontWeight: '700', paddingVertical: 6 }}>{all ? t('clear') : t('select_all')}</Text>
          </Pressable>
          {items.map((c) => {
            const on = selected.includes(c.membershipId);
            return (
              <Pressable key={c.membershipId} accessibilityRole="checkbox" accessibilityState={{ checked: on }}
                onPress={() => setSelected(on ? selected.filter((x) => x !== c.membershipId) : [...selected, c.membershipId])}
                style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: theme.border, gap: 12 }}>
                <View style={{ width: 26, height: 26, borderRadius: 6, borderWidth: 2, borderColor: theme.primary, backgroundColor: on ? theme.primary : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                  {on && <Text style={{ color: '#fff', fontWeight: '800' }}>✓</Text>}
                </View>
                <Text style={{ flex: 1, fontSize: 17, fontWeight: '600', color: theme.text }}>{c.fullName}</Text>
                <Badge tone={c.state === 'working' ? 'success' : c.state === 'on_break' ? 'warning' : undefined}
                  text={`${t(c.state === 'working' ? 'state_working' : c.state === 'on_break' ? 'state_on_break' : 'state_off')}${c.since ? ` · ${fmtTime(c.since)}` : ''}`} />
              </Pressable>
            );
          })}
        </Card>
      )}
      <Button big title={t('crew_in', { n: selected.length })} disabled={!selected.length} loading={busy} onPress={() => void send('clock_in')} />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={{ flex: 1 }}><Button kind="secondary" title={t('start_break')} disabled={!selected.length || busy} onPress={() => void send('break_start')} /></View>
        <View style={{ flex: 1 }}><Button kind="secondary" title={t('end_break')} disabled={!selected.length || busy} onPress={() => void send('break_end')} /></View>
      </View>
      <Button kind="danger" title={t('crew_out', { n: selected.length })} disabled={!selected.length || busy} onPress={() => void send('clock_out')} />
    </Screen>
  );
}

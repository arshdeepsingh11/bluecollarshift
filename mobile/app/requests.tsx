import { useCallback, useEffect, useState } from 'react';
import { Modal, Pressable, Text, TextInput, View } from 'react-native';
import type { AvailabilityDay, ShiftRequest, TimeOffRequest } from '@bluecollar/shared';
import { useSession } from '../src/state/session';
import { api } from '../src/lib/api';
import { t, type Key } from '../src/i18n';
import { theme } from '../src/lib/config';
import { Badge, Banner, Button, Card, H1, Loading, Muted, Row, Screen, fmtDateTime, s } from '../src/ui';

interface OpenShift { id: string; siteName: string; startsAt: string; endsAt: string; openSlots: number; myRequest: string | null }
interface MyShift { id: string; siteName: string; startsAt: string; endsAt: string }
interface Coworker { membershipId: string; fullName: string }
const KINDS = ['vacation', 'sick', 'personal', 'unpaid', 'other'] as const;
const statusKey = (st: string) => `status_${st}` as Key;
const statusTone = (st: string) => (st === 'approved' ? 'success' : st === 'rejected' ? 'error' : st === 'cancelled' ? undefined : 'warning');
const pad = (n: number) => String(n).padStart(2, '0');
const isoDay = (offset = 0) => { const d = new Date(Date.now() + offset * 86400_000); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const minToTime = (m: number | null) => (m == null ? '' : `${pad(Math.floor(m / 60))}:${pad(m % 60)}`);
const timeToMin = (v: string) => { const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim()); return m ? Math.min(1440, Number(m[1]) * 60 + Number(m[2])) : null; };

export default function Requests() {
  const { membership } = useSession();
  const base = membership ? `/companies/${membership.companyId}` : '';
  const [open, setOpen] = useState<OpenShift[] | null>(null);
  const [mine, setMine] = useState<ShiftRequest[]>([]);
  const [shifts, setShifts] = useState<MyShift[]>([]);
  const [toff, setToff] = useState<TimeOffRequest[]>([]);
  const [avail, setAvail] = useState<AvailabilityDay[] | null>(null);
  const [coworkers, setCoworkers] = useState<Coworker[]>([]);
  const [msg, setMsg] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [changing, setChanging] = useState<MyShift | null>(null);
  const [asking, setAsking] = useState(false);

  const load = useCallback(async () => {
    if (!membership) return;
    const from = new Date().toISOString();
    const to = new Date(Date.now() + 45 * 86400_000).toISOString();
    const [o, r, sh, tf, av, cw] = await Promise.all([
      api<{ items: OpenShift[] }>(`${base}/open-shifts`).catch(() => ({ items: [] })),
      api<{ items: ShiftRequest[] }>(`${base}/shift-requests?status=all`).catch(() => ({ items: [] })),
      api<{ items: MyShift[] }>(`${base}/shifts?mine=true&from=${from}&to=${to}`).catch(() => ({ items: [] })),
      api<{ items: TimeOffRequest[] }>(`${base}/time-off`).catch(() => ({ items: [] })),
      api<{ days: AvailabilityDay[] }>(`${base}/availability/me`).catch(() => null),
      api<{ items: Coworker[] }>(`${base}/coworkers`).catch(() => ({ items: [] })),
    ]);
    setOpen(o.items); setMine(r.items); setShifts(sh.items); setToff(tf.items); setAvail(av?.days ?? null); setCoworkers(cw.items);
  }, [membership, base]);
  useEffect(() => void load(), [load]);

  async function act(fn: () => Promise<unknown>, ok: Key) {
    setMsg(null);
    try { await fn(); setMsg({ tone: 'success', text: t(ok) }); await load(); } catch (e) { setMsg({ tone: 'error', text: e instanceof Error ? e.message : t('error_generic') }); }
  }
  const pendingFor = (id: string) => mine.find((r) => r.shift.id === id && r.requester.membershipId === membership?.membershipId && ['pending', 'pending_peer'].includes(r.status));
  const asks = mine.filter((r) => r.status === 'pending_peer' && r.target?.membershipId === membership?.membershipId);

  return (
    <Screen onRefresh={() => void load()}>
      {msg && <Banner tone={msg.tone} text={msg.text} />}
      {asks.map((r) => (
        <Card key={r.id}>
          <Text style={{ fontSize: 16, color: theme.text }}>{t('swap_ask', { name: r.requester.fullName, site: r.shift.siteName, when: fmtDateTime(r.shift.startsAt) })}</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ flex: 1 }}><Button title={t('accept')} onPress={() => void act(() => api(`${base}/shift-requests/${r.id}/respond`, { method: 'POST', body: { accept: true } }), 'accepted')} /></View>
            <View style={{ flex: 1 }}><Button kind="secondary" title={t('decline')} onPress={() => void act(() => api(`${base}/shift-requests/${r.id}/respond`, { method: 'POST', body: { accept: false } }), 'declined')} /></View>
          </View>
        </Card>
      ))}

      <H1>{t('open_shifts')}</H1>
      {!open ? <Loading /> : !open.length ? <Card><Muted>{t('no_open')}</Muted></Card> : (
        <Card>{open.map((o) => (
          <Row key={o.id} title={o.siteName} subtitle={`${fmtDateTime(o.startsAt)} · ${t('open_n', { n: o.openSlots })}`}
            right={o.myRequest && ['pending', 'pending_peer'].includes(o.myRequest) ? <Badge tone="warning" text={t(statusKey(o.myRequest))} />
              : <Pressable onPress={() => void act(() => api(`${base}/shift-requests`, { method: 'POST', body: { shiftId: o.id, kind: 'pickup' } }), 'pickup_sent')} accessibilityRole="button">
                  <Text style={{ color: theme.primary, fontWeight: '700' }}>{t('pick_up')}</Text></Pressable>} />
        ))}</Card>
      )}

      <H1>{t('my_shifts')}</H1>
      {!shifts.length ? <Card><Muted>{t('no_shifts')}</Muted></Card> : (
        <Card>{shifts.map((sh) => {
          const p = pendingFor(sh.id);
          return (
            <Row key={sh.id} title={sh.siteName} subtitle={fmtDateTime(sh.startsAt)}
              right={p ? <Pressable onPress={() => void act(() => api(`${base}/shift-requests/${p.id}/cancel`, { method: 'POST', body: {} }), 'request_cancelled')} accessibilityRole="button">
                  <Badge tone="warning" text={`${t(statusKey(p.status))} ✕`} /></Pressable>
                : <Pressable onPress={() => setChanging(sh)} accessibilityRole="button"><Text style={{ color: theme.primary, fontWeight: '700' }}>{t('cant_work')}</Text></Pressable>} />
          );
        })}</Card>
      )}

      <H1>{t('time_off')}</H1>
      <Button kind="secondary" title={t('request_time_off')} onPress={() => setAsking(true)} />
      {toff.length > 0 && (
        <Card>{toff.map((r) => (
          <Row key={r.id} title={`${t(r.kind)} · ${r.startsOn} → ${r.endsOn}`} subtitle={r.decisionNote ?? undefined}
            right={<Pressable disabled={!(r.status === 'pending' || (r.status === 'approved' && r.startsOn > isoDay()))}
              onPress={() => void act(() => api(`${base}/time-off/${r.id}/cancel`, { method: 'POST', body: {} }), 'request_cancelled')}>
              <Badge tone={statusTone(r.status)} text={t(statusKey(r.status))} /></Pressable>} />
        ))}</Card>
      )}

      <H1>{t('availability')}</H1>
      <Muted>{t('avail_hint')}</Muted>
      {avail ? <AvailabilityEditor days={avail} onSave={(days) => act(() => api(`${base}/availability/me`, { method: 'PUT', body: { days } }), 'saved')} /> : <Loading />}

      {changing && <ChangeShift shift={changing} coworkers={coworkers} onClose={() => setChanging(null)} onSend={async (kind, target, note) => {
        await act(() => api(`${base}/shift-requests`, { method: 'POST', body: { shiftId: changing.id, kind, targetMembershipId: kind === 'swap' ? target : null, note: note || null } }), kind === 'swap' ? 'swap_sent' : 'drop_sent');
        setChanging(null);
      }} />}
      {asking && <TimeOffForm onClose={() => setAsking(false)} onSend={async (body) => { await act(() => api(`${base}/time-off`, { method: 'POST', body }), 'toff_sent'); setAsking(false); }} />}
    </Screen>
  );
}

function AvailabilityEditor({ days, onSave }: { days: AvailabilityDay[]; onSave: (d: AvailabilityDay[]) => Promise<void> }) {
  const [d, setD] = useState(days);
  const set = (i: number, v: Partial<AvailabilityDay>) => setD(d.map((x, j) => (j === i ? { ...x, ...v } : x)));
  const mode = (x: AvailabilityDay) => (!x.available ? 'no' : x.startMinute == null ? 'all' : 'hours');
  return (
    <Card>
      {d.map((x, i) => (
        <View key={x.dow} style={{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: theme.border, gap: 6 }}>
          <Text style={{ fontWeight: '700', color: theme.text }}>{t(`dow${x.dow}` as Key)}</Text>
          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
            {(['all', 'hours', 'no'] as const).map((m) => (
              <Pressable key={m} accessibilityRole="radio" accessibilityState={{ selected: mode(x) === m }}
                onPress={() => set(i, m === 'no' ? { available: false, startMinute: null, endMinute: null } : m === 'all' ? { available: true, startMinute: null, endMinute: null } : { available: true, startMinute: 420, endMinute: 1020 })}
                style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: theme.border, backgroundColor: mode(x) === m ? theme.primary : theme.surface }}>
                <Text style={{ color: mode(x) === m ? '#fff' : theme.text }}>{t(m === 'all' ? 'any_time' : m === 'hours' ? 'only_between' : 'not_available')}</Text>
              </Pressable>
            ))}
          </View>
          {mode(x) === 'hours' && (
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              <TextInput style={[s.input, { flex: 1 }]} defaultValue={minToTime(x.startMinute)} placeholder={t('time_hint')} keyboardType="numbers-and-punctuation"
                onEndEditing={(e) => { const v = timeToMin(e.nativeEvent.text); if (v != null) set(i, { startMinute: v }); }} accessibilityLabel={t('from')} />
              <Text>–</Text>
              <TextInput style={[s.input, { flex: 1 }]} defaultValue={minToTime(x.endMinute)} placeholder={t('time_hint')} keyboardType="numbers-and-punctuation"
                onEndEditing={(e) => { const v = timeToMin(e.nativeEvent.text); if (v != null) set(i, { endMinute: v }); }} accessibilityLabel={t('to')} />
            </View>
          )}
        </View>
      ))}
      <Button title={t('save')} onPress={() => void onSave(d)} />
    </Card>
  );
}

function ChangeShift({ shift, coworkers, onClose, onSend }: { shift: MyShift; coworkers: Coworker[]; onClose: () => void; onSend: (kind: 'swap' | 'drop', target: string, note: string) => Promise<void> }) {
  const [kind, setKind] = useState<'swap' | 'drop'>('swap');
  const [target, setTarget] = useState('');
  const [note, setNote] = useState('');
  return (
    <Modal animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <Screen>
        <H1>{shift.siteName}</H1>
        <Muted>{fmtDateTime(shift.startsAt)}</Muted>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 1 }}><Button kind={kind === 'swap' ? 'primary' : 'secondary'} title={t('ask_coworker')} onPress={() => setKind('swap')} /></View>
          <View style={{ flex: 1 }}><Button kind={kind === 'drop' ? 'primary' : 'secondary'} title={t('give_up')} onPress={() => setKind('drop')} /></View>
        </View>
        <Muted>{t(kind === 'swap' ? 'swap_hint' : 'drop_hint')}</Muted>
        {kind === 'swap' && (
          <Card>
            <Text style={s.label}>{t('choose_coworker')}</Text>
            {coworkers.map((c) => <Row key={c.membershipId} title={c.fullName} onPress={() => setTarget(c.membershipId)} right={target === c.membershipId ? <Text style={{ color: theme.primary, fontSize: 18 }}>✓</Text> : undefined} />)}
          </Card>
        )}
        <Text style={s.label}>{t('note')}</Text>
        <TextInput style={[s.input, { minHeight: 80 }]} multiline maxLength={500} value={note} onChangeText={setNote} />
        <Button title={t('send_request')} disabled={kind === 'swap' && !target} onPress={() => void onSend(kind, target, note)} />
        <Button kind="secondary" title={t('cancel')} onPress={onClose} />
      </Screen>
    </Modal>
  );
}

function TimeOffForm({ onClose, onSend }: { onClose: () => void; onSend: (b: Record<string, unknown>) => Promise<void> }) {
  const [kind, setKind] = useState<(typeof KINDS)[number]>('vacation');
  const [from, setFrom] = useState(isoDay(1));
  const [to, setTo] = useState(isoDay(1));
  const [note, setNote] = useState('');
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && to >= from;
  return (
    <Modal animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <Screen>
        <H1>{t('request_time_off')}</H1>
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
          {KINDS.map((k) => (
            <Pressable key={k} onPress={() => setKind(k)} accessibilityRole="radio" accessibilityState={{ selected: kind === k }}
              style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: theme.border, backgroundColor: kind === k ? theme.primary : theme.surface }}>
              <Text style={{ color: kind === k ? '#fff' : theme.text }}>{t(k)}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={s.label}>{t('from')} ({t('date_hint')})</Text>
        <TextInput style={s.input} value={from} onChangeText={setFrom} keyboardType="numbers-and-punctuation" maxLength={10} />
        <Text style={s.label}>{t('to')} ({t('date_hint')})</Text>
        <TextInput style={s.input} value={to} onChangeText={setTo} keyboardType="numbers-and-punctuation" maxLength={10} />
        <Text style={s.label}>{t('note')}</Text>
        <TextInput style={[s.input, { minHeight: 80 }]} multiline maxLength={500} value={note} onChangeText={setNote} />
        <Button title={t('send_request')} disabled={!valid} onPress={() => void onSend({ kind, startsOn: from, endsOn: to, note: note || null })} />
        <Button kind="secondary" title={t('cancel')} onPress={onClose} />
      </Screen>
    </Modal>
  );
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, Text, TextInput, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Message } from '@bluecollar/shared';
import { useSession } from '../../src/state/session';
import { api } from '../../src/lib/api';
import { cacheGet, cacheSet } from '../../src/lib/db';
import { flushOutbox, pendingFor, queueMessage, type OutboxItem } from '../../src/lib/outbox';
import { getSocket } from '../../src/lib/realtime';
import { theme } from '../../src/lib/config';
import { t } from '../../src/i18n';
import { Button, fmtDateTime, s as st } from '../../src/ui';

type Item = (Message & { local?: undefined }) | (OutboxItem & { local: true });

export default function Chat() {
  const { id, title } = useLocalSearchParams<{ id: string; title?: string }>();
  const { membership } = useSession();
  const companyId = membership!.companyId;
  const [msgs, setMsgs] = useState<Message[]>([]);
  const [pending, setPending] = useState<OutboxItem[]>([]);
  const [text, setText] = useState('');
  const list = useRef<FlatList<Item>>(null);

  const markRead = useCallback(async (last?: Message) => {
    if (last) await api(`/companies/${companyId}/conversations/${id}/read`, { method: 'POST', body: { messageId: last.id } }).catch(() => undefined);
  }, [companyId, id]);

  const load = useCallback(async () => {
    try {
      const r = await api<{ items: Message[] }>(`/companies/${companyId}/conversations/${id}/messages?limit=100`);
      setMsgs(r.items);
      await cacheSet(`msgs:${id}`, r.items);
      void markRead(r.items[r.items.length - 1]);
    } catch {
      setMsgs((await cacheGet<Message[]>(`msgs:${id}`))?.value ?? []);
    }
    setPending(await pendingFor(id));
  }, [companyId, id, markRead]);

  useEffect(() => {
    void load();
    const sock = getSocket();
    const join = () => sock.emit('conversation:join', { conversationId: id });
    join();
    sock.on('connect', join);
    const onMsg = (m: Message) => {
      if (m.conversationId !== id) return;
      setMsgs((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
      void markRead(m);
    };
    sock.on('message:new', onMsg);
    return () => {
      sock.emit('conversation:leave', { conversationId: id });
      sock.off('connect', join);
      sock.off('message:new', onMsg);
    };
  }, [id, load, markRead]);

  async function send() {
    const body = text.trim();
    if (!body) return;
    setText('');
    await queueMessage(companyId, id, body);
    setPending(await pendingFor(id));
    const sent = await flushOutbox();
    setMsgs((prev) => [...prev, ...sent.filter((m) => m.conversationId === id && !prev.some((x) => x.id === m.id))]);
    setPending(await pendingFor(id));
  }

  const items: Item[] = [...msgs, ...pending.filter((p) => !msgs.some((m) => m.id === p.id)).map((p) => ({ ...p, local: true as const }))];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }} edges={['bottom']}>
      <Stack.Screen options={{ title: title || t('messages') }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
        <FlatList
          ref={list}
          data={items}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ padding: 12, gap: 8 }}
          onContentSizeChange={() => list.current?.scrollToEnd({ animated: false })}
          renderItem={({ item }) => {
            const mine = item.local || item.senderMembershipId === membership!.membershipId;
            return (
              <View style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '82%', backgroundColor: mine ? theme.primary : theme.surface, borderRadius: 14, padding: 10, borderWidth: mine ? 0 : 1, borderColor: theme.border }}>
                {!mine && !item.local && <Text style={{ fontSize: 12, fontWeight: '700', color: theme.text2 }}>{item.senderName}</Text>}
                <Text style={{ color: mine ? '#fff' : theme.text, fontSize: 16 }}>{item.body}</Text>
                <Text style={{ color: mine ? '#D6ECF5' : theme.text3, fontSize: 11, marginTop: 2 }}>
                  {item.local ? (item.state === 'failed' ? `${t('failed')}: ${item.last_error ?? ''}` : t('queued')) : `${fmtDateTime(item.createdAt)}${mine && item.readBy ? ' · Read' : ''}`}
                </Text>
              </View>
            );
          }}
        />
        <View style={{ flexDirection: 'row', gap: 8, padding: 8, borderTopWidth: 1, borderTopColor: theme.border, backgroundColor: theme.surface }}>
          <TextInput style={[st.input, { flex: 1 }]} value={text} onChangeText={setText} placeholder={t('type_message')} maxLength={4000} multiline accessibilityLabel={t('type_message')} />
          <Button title={t('send')} onPress={() => void send()} disabled={!text.trim()} />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

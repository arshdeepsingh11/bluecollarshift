import { useCallback, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import type { Conversation } from '@bluecollar/shared';
import { useSession } from '../../src/state/session';
import { api } from '../../src/lib/api';
import { cacheGet, cacheSet } from '../../src/lib/db';
import { t } from '../../src/i18n';
import { Badge, Banner, Card, H1, Loading, Muted, Row, Screen, fmtDateTime } from '../../src/ui';

interface Contact { membershipId: string; fullName: string; role: string; jobTitle: string | null }

export default function Messages() {
  const { membership } = useSession();
  const companyId = membership!.companyId;
  const [convs, setConvs] = useState<Conversation[] | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [offline, setOffline] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [c, k] = await Promise.all([
        api<{ items: Conversation[] }>(`/companies/${companyId}/conversations`),
        api<{ items: Contact[] }>(`/companies/${companyId}/contacts`),
      ]);
      setConvs(c.items);
      setContacts(k.items);
      setOffline(false);
      await cacheSet(`convs:${companyId}`, c.items);
    } catch {
      setConvs((await cacheGet<Conversation[]>(`convs:${companyId}`))?.value ?? []);
      setOffline(true);
    }
  }, [companyId]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  async function start(c: Contact) {
    try {
      const r = await api<{ id: string }>(`/companies/${companyId}/conversations`, { method: 'POST', body: { kind: 'direct', memberIds: [c.membershipId] } });
      router.push({ pathname: '/chat/[id]', params: { id: r.id, title: c.fullName } });
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error');
    }
  }

  if (!convs) return <Screen><Loading /></Screen>;
  const nameOf = (c: Conversation) => c.title ?? c.members.filter((m) => m.membershipId !== membership!.membershipId).map((m) => m.fullName).join(', ');
  const withConv = new Set(convs.filter((c) => c.kind === 'direct').flatMap((c) => c.members.map((m) => m.membershipId)));

  return (
    <Screen onRefresh={() => void load()}>
      <H1>{t('messages')}</H1>
      {offline && <Banner tone="warning" text={t('offline')} />}
      {err && <Banner tone="error" text={err} />}
      <Card>
        {!convs.length && <Muted>{t('no_conversations')}</Muted>}
        {convs.map((c) => (
          <Row
            key={c.id}
            title={nameOf(c) || 'Conversation'}
            subtitle={c.lastMessage ? `${c.lastMessage.senderName}: ${c.lastMessage.body.slice(0, 60)} · ${fmtDateTime(c.lastMessage.createdAt)}` : undefined}
            right={c.unread ? <Badge tone="info" text={String(c.unread)} /> : undefined}
            onPress={() => router.push({ pathname: '/chat/[id]', params: { id: c.id, title: nameOf(c) } })}
          />
        ))}
      </Card>
      {contacts.filter((c) => !withConv.has(c.membershipId)).length > 0 && (
        <Card>
          <Muted>{t('start_conversation')}</Muted>
          {contacts.filter((c) => !withConv.has(c.membershipId)).map((c) => (
            <Row key={c.membershipId} title={c.fullName} subtitle={c.jobTitle ?? c.role} onPress={() => void start(c)} />
          ))}
        </Card>
      )}
    </Screen>
  );
}

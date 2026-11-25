import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { Conversation, Message } from '@bluecollar/shared';
import { useApi } from '../hooks/useApi';
import { useAuth, useMembership } from '../hooks/useAuth';
import { ApiError, errorMessage, get, post } from '../lib/api';
import { getSocket } from '../lib/realtime';
import { fmtDateTime, fmtTime } from '../lib/format';
import { t } from '../i18n';
import { Alert, Drawer, Empty, Field, Loading, Page } from './ui';

type Outgoing = Message & { state?: 'sending' | 'queued' | 'failed' };

export default function MessagesPanel() {
  const m = useMembership();
  const { can } = useAuth();
  const base = `/companies/${m.companyId}`;
  const convs = useApi<{ items: Conversation[] }>(`${base}/conversations`, [m.companyId]);
  const [active, setActive] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const s = getSocket();
    const r = () => void convs.reload();
    s.on('message:new', r);
    s.on('notification:new', r);
    return () => {
      s.off('message:new', r);
      s.off('notification:new', r);
    };
  }, [convs]);

  const items = convs.data?.items ?? [];
  const current = items.find((c) => c.id === active) ?? null;
  return (
    <Page title={t('messages.title')} actions={<button className="bc-btn" onClick={() => setCreating(true)}>{t('messages.new')}</button>}>
      {convs.error && <Alert kind="error">{convs.error}</Alert>}
      <div className="bc-chat">
        <div className="bc-chat-list" role="list">
          {convs.loading && !convs.data ? <Loading /> : items.length === 0 ? <Empty title={t('messages.none')} /> : items.map((c) => (
            <button key={c.id} role="listitem" className={c.id === active ? 'active' : ''} onClick={() => setActive(c.id)}>
              <strong>{c.title ?? c.members.filter((x) => x.membershipId !== m.membershipId).map((x) => x.fullName).join(', ')}</strong>
              {c.unread > 0 && <span className="bc-badge info" style={{ marginLeft: 6 }}>{c.unread}</span>}
              <small>{c.lastMessage ? `${c.lastMessage.senderName}: ${c.lastMessage.body}` : '—'}</small>
            </button>
          ))}
        </div>
        {current ? <Thread key={current.id} base={base} conversation={current} myId={m.membershipId} onRead={() => void convs.reload()} /> : <div className="bc-chat-thread"><Empty title={t('messages.pick')} /></div>}
      </div>
      {creating && <NewConversation base={base} canAnnounce={can('announcements.send')} isStaff={m.role !== 'employee'} onClose={() => setCreating(false)}
        onCreated={(id) => { setCreating(false); setActive(id); void convs.reload(); }} />}
    </Page>
  );
}

function Thread({ base, conversation, myId, onRead }: { base: string; conversation: Conversation; myId: string; onRead: () => void }) {
  const [msgs, setMsgs] = useState<Outgoing[] | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const path = `${base}/conversations/${conversation.id}`;

  const markRead = useCallback(async (list: Outgoing[]) => {
    const last = [...list].reverse().find((x) => x.senderMembershipId !== myId && !x.state);
    if (last) {
      await post(`${path}/read`, { messageId: last.id }).catch(() => undefined);
      onRead();
    }
  }, [myId, onRead, path]);

  const load = useCallback(async () => {
    try {
      const r = await get<{ items: Message[] }>(`${path}/messages?limit=100`);
      setMsgs((prev) => {
        const pending = (prev ?? []).filter((p) => p.state && !r.items.some((x) => x.id === p.id));
        return [...r.items, ...pending];
      });
      void markRead(r.items);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [path, markRead]);

  const send = useCallback(async (msg: Outgoing) => {
    setMsgs((prev) => (prev ?? []).map((x) => (x.id === msg.id ? { ...x, state: 'sending' } : x)));
    try {
      const saved = await post<Message>(`${path}/messages`, { id: msg.id, body: msg.body, clientCreatedAt: msg.createdAt });
      setMsgs((prev) => (prev ?? []).map((x) => (x.id === msg.id ? saved : x)));
    } catch (e) {
      // Network failures stay queued and retry on reconnect (same id → no duplicates).
      const queued = e instanceof ApiError && e.status === 0;
      setMsgs((prev) => (prev ?? []).map((x) => (x.id === msg.id ? { ...x, state: queued ? 'queued' : 'failed' } : x)));
      if (!queued) setError(errorMessage(e));
    }
  }, [path]);

  useEffect(() => {
    void load();
    const s = getSocket();
    s.emit('conversation:join', { conversationId: conversation.id });
    const onNew = (msg: Message) => {
      if (msg.conversationId !== conversation.id) return;
      setMsgs((prev) => (prev?.some((x) => x.id === msg.id) ? prev : [...(prev ?? []), msg]));
      if (msg.senderMembershipId !== myId) void post(`${path}/read`, { messageId: msg.id }).catch(() => undefined);
    };
    const onReadEvt = (e: { conversationId: string }) => e.conversationId === conversation.id && void load();
    const onConnect = () => {
      s.emit('conversation:join', { conversationId: conversation.id });
      void load();
      setMsgs((prev) => {
        (prev ?? []).filter((x) => x.state === 'queued').forEach((x) => void send(x));
        return prev;
      });
    };
    s.on('message:new', onNew);
    s.on('message:read', onReadEvt);
    s.on('connect', onConnect);
    return () => {
      s.emit('conversation:leave', { conversationId: conversation.id });
      s.off('message:new', onNew);
      s.off('message:read', onReadEvt);
      s.off('connect', onConnect);
    };
  }, [conversation.id, load, myId, path, send]);

  useEffect(() => endRef.current?.scrollIntoView({ block: 'end' }), [msgs?.length]);

  function submit(e: FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    const msg: Outgoing = { id: crypto.randomUUID(), conversationId: conversation.id, senderMembershipId: myId, senderName: '', body, createdAt: new Date().toISOString(), readBy: 0, state: 'sending' };
    setMsgs((prev) => [...(prev ?? []), msg]);
    setText('');
    void send(msg);
  }

  return (
    <div className="bc-chat-thread">
      {error && <Alert kind="error">{error}</Alert>}
      <div className="bc-chat-messages" aria-live="polite">
        {!msgs ? <Loading /> : msgs.map((x) => (
          <div key={x.id} className={`bc-msg ${x.senderMembershipId === myId ? 'mine' : ''}`} onClick={() => x.state === 'failed' && void send(x)}>
            {x.senderMembershipId !== myId && <strong style={{ display: 'block', fontSize: 12 }}>{x.senderName}</strong>}
            {x.body}
            <small title={fmtDateTime(x.createdAt)}>
              {fmtTime(x.createdAt)}
              {x.state === 'sending' && ` · ${t('messages.sending')}`}
              {x.state === 'queued' && ` · ${t('messages.queued')}`}
              {x.state === 'failed' && ` · ${t('messages.failed')}`}
              {!x.state && x.senderMembershipId === myId && x.readBy > 0 && ` · ${t('messages.read_by')} ✓✓`}
            </small>
          </div>
        ))}
        <div ref={endRef} />
      </div>
      {(
        <form className="bc-chat-compose" onSubmit={submit}>
          <label htmlFor="compose" className="sr-only">{t('messages.type')}</label>
          <textarea id="compose" className="bc-input" placeholder={t('messages.type')} maxLength={4000} value={text} onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(e as unknown as FormEvent); } }} />
          <button className="bc-btn" disabled={!text.trim()}>{t('messages.send')}</button>
        </form>
      )}
    </div>
  );
}

function NewConversation({ base, canAnnounce, isStaff, onClose, onCreated }: { base: string; canAnnounce: boolean; isStaff: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const contacts = useApi<{ items: { membershipId: string; fullName: string; role: string }[] }>(`${base}/contacts`, [base]);
  const [kind, setKind] = useState<'direct' | 'group' | 'announcement'>('direct');
  const [title, setTitle] = useState('');
  const [ids, setIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      const r = await post<{ id: string }>(`${base}/conversations`, { kind, title: title || null, memberIds: ids });
      onCreated(r.id);
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  return (
    <Drawer title={t('messages.new')} onClose={onClose}>
      {error && <Alert kind="error">{error}</Alert>}
      <form onSubmit={submit}>
        {isStaff && (
          <Field label={t('common.status')} htmlFor="ckind">
            <select id="ckind" value={kind} onChange={(e) => { setKind(e.target.value as typeof kind); setIds([]); }}>
              <option value="direct">{t('messages.direct')}</option>
              <option value="group">{t('messages.group')}</option>
              {canAnnounce && <option value="announcement">{t('messages.announcement')}</option>}
            </select>
          </Field>
        )}
        {kind !== 'direct' && <Field label={t('messages.title_label')} htmlFor="ctitle"><input id="ctitle" maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} /></Field>}
        <Field label={t('messages.members')}>
          <div style={{ maxHeight: 300, overflowY: 'auto' }}>
            {contacts.data?.items.map((c) => (
              <label key={c.membershipId} className="bc-check">
                <input type={kind === 'direct' ? 'radio' : 'checkbox'} name="member" checked={ids.includes(c.membershipId)}
                  onChange={(e) => setIds(kind === 'direct' ? [c.membershipId] : e.target.checked ? [...ids, c.membershipId] : ids.filter((x) => x !== c.membershipId))} />
                {c.fullName} <span className="bc-muted">· {t(`role.${c.role}` as never)}</span>
              </label>
            ))}
          </div>
        </Field>
        <div className="bc-actions"><button className="bc-btn" disabled={!ids.length}>{t('common.create')}</button></div>
      </form>
    </Drawer>
  );
}

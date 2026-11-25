import type { Message } from '@bluecollar/shared';
import { api, ApiError } from './api';
import { db } from './db';
import { uuid } from './device';

/**
 * Offline message queue. A message gets its id on the phone, is stored in SQLite, and is sent
 * when online. The same id is reused on retry, so the server never stores it twice.
 */
export interface OutboxItem {
  id: string;
  company_id: string;
  conversation_id: string;
  body: string;
  created_at: string;
  state: 'queued' | 'failed';
  attempts: number;
  last_error: string | null;
}

export async function queueMessage(companyId: string, conversationId: string, body: string): Promise<OutboxItem> {
  const item: OutboxItem = { id: uuid(), company_id: companyId, conversation_id: conversationId, body, created_at: new Date().toISOString(), state: 'queued', attempts: 0, last_error: null };
  const d = await db();
  await d.runAsync(`INSERT INTO message_outbox (id, company_id, conversation_id, body, created_at, state, attempts) VALUES (?,?,?,?,?,?,0)`,
    [item.id, companyId, conversationId, body, item.created_at, 'queued']);
  return item;
}

export async function pendingFor(conversationId: string): Promise<OutboxItem[]> {
  const d = await db();
  return d.getAllAsync<OutboxItem>(`SELECT * FROM message_outbox WHERE conversation_id = ? ORDER BY created_at`, [conversationId]);
}

/** Try to send all queued messages. Returns those delivered. */
export async function flushOutbox(): Promise<Message[]> {
  const d = await db();
  const items = await d.getAllAsync<OutboxItem>(`SELECT * FROM message_outbox WHERE state = 'queued' ORDER BY created_at LIMIT 50`);
  const sent: Message[] = [];
  for (const m of items) {
    try {
      const msg = await api<Message>(`/companies/${m.company_id}/conversations/${m.conversation_id}/messages`, {
        method: 'POST', body: { id: m.id, body: m.body, clientCreatedAt: m.created_at },
      });
      await d.runAsync(`DELETE FROM message_outbox WHERE id = ?`, [m.id]); // delivered and stored on the server
      sent.push(msg);
    } catch (e) {
      if (e instanceof ApiError && e.status > 0 && e.status < 500 && e.status !== 429) {
        await d.runAsync(`UPDATE message_outbox SET state = 'failed', last_error = ?, attempts = attempts + 1 WHERE id = ?`, [e.message, m.id]);
      } else {
        await d.runAsync(`UPDATE message_outbox SET attempts = attempts + 1, last_error = ? WHERE id = ?`, ['No connection', m.id]);
        break; // offline: stop and retry on reconnect
      }
    }
  }
  return sent;
}

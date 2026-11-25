import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { createHash, randomUUID } from 'node:crypto';
import { io as connect, type Socket } from 'socket.io-client';
import { Server } from 'socket.io';
import { createTestDatabase, createUser, startApp, type TestApp, type TestUser } from './helpers';
import { attachRealtime } from '../src/realtime';

const DB = 'bc_test_realtime';
let su: pg.Client;
let t: TestApp;
let io: Server;
let url: string;
let owner: TestUser, emp: TestUser, stranger: TestUser;
let C: string, conv: string, empMem: string;
const sockets: Socket[] = [];

function open(token: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = connect(url, { path: '/realtime', auth: { token }, transports: ['websocket'], reconnection: false });
    sockets.push(s);
    s.on('connect', () => resolve(s));
    s.on('connect_error', (e) => reject(e));
  });
}

beforeAll(async () => {
  su = await createTestDatabase(DB);
  t = await startApp(DB);
  await t.app.listen({ port: 0, host: '127.0.0.1' });
  const addr = t.app.server.address() as { port: number };
  url = `http://127.0.0.1:${addr.port}`;
  io = attachRealtime(t.app.server, t.services);
  t.forward.to = (room, event, payload) => io.to(room).emit(event, payload);
  [owner, emp, stranger] = (await Promise.all(['o@rt.ca', 'e@rt.ca', 's@rt.ca'].map((e) => createUser(su, e)))) as [TestUser, TestUser, TestUser];
  C = (await t.call(owner, 'POST', '/api/v1/companies', { companyName: 'Realtime Roofing', fullName: 'Owner' })).body.id;
  await t.call(stranger, 'POST', '/api/v1/companies', { companyName: 'Other Co', fullName: 'Stranger' });
  const inv = await t.call(owner, 'POST', `/api/v1/companies/${C}/invitations`, { email: emp.email, fullName: 'Emp Loyee', role: 'employee' });
  const token = randomUUID().replace(/-/g, '').repeat(2);
  await su.query(`update app.invitations set token_hash = $1 where id = $2`, [createHash('sha256').update(token).digest('hex'), inv.body.id]);
  empMem = (await t.call(emp, 'POST', '/api/v1/invitations/accept', { token })).body.membershipId;
  conv = (await t.call(owner, 'POST', `/api/v1/companies/${C}/conversations`, { kind: 'direct', memberIds: [empMem] })).body.id;
});

afterAll(async () => {
  sockets.forEach((s) => s.close());
  io?.close();
  await t?.close();
  await su?.end();
});

describe('realtime messaging', () => {
  it('rejects connections without a valid token', async () => {
    await expect(open('not-a-token')).rejects.toThrow(/unauthorized/);
  });

  it('a non-member cannot subscribe to a conversation', async () => {
    const s = await open(await stranger.token());
    const ack = await s.timeout(3000).emitWithAck('conversation:join', { conversationId: conv });
    expect(ack.ok).toBe(false);
  });

  it('delivers a new message instantly to the other member and a read receipt back', async () => {
    const empSock = await open(await emp.token());
    const ownerSock = await open(await owner.token());
    expect((await empSock.timeout(3000).emitWithAck('conversation:join', { conversationId: conv })).ok).toBe(true);
    expect((await ownerSock.timeout(3000).emitWithAck('conversation:join', { conversationId: conv })).ok).toBe(true);

    const received = new Promise<{ body: string; id: string }>((resolve) => empSock.once('message:new', resolve));
    const started = performance.now();
    const sent = await t.call(owner, 'POST', `/api/v1/companies/${C}/conversations/${conv}/messages`, { id: randomUUID(), body: 'Crane arrives at 7am' });
    expect(sent.status).toBe(201);
    const msg = await received;
    const latency = performance.now() - started;
    expect(msg.body).toBe('Crane arrives at 7am');
    expect(latency).toBeLessThan(1000);

    const receipt = new Promise<{ membershipId: string }>((resolve) => ownerSock.once('message:read', resolve));
    await t.call(emp, 'POST', `/api/v1/companies/${C}/conversations/${conv}/read`, { messageId: msg.id });
    expect((await receipt).membershipId).toBe(empMem);
  });

  it('a user receives their own notifications on the user room', async () => {
    const empSock = await open(await emp.token());
    const got = new Promise<{ type: string }>((resolve) => empSock.once('notification:new', resolve));
    const r = await t.call(owner, 'POST', `/api/v1/companies/${C}/conversations/${conv}/messages`, { id: randomUUID(), body: 'Second' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(t.emitted.filter((e) => e.event === 'notification:new').map((e) => e.room)).toContain(`user:${emp.id}`);
    expect((await got).type).toBe('message.new');
  });
});

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { SignJWT } from 'jose';
import { buildApp, type Services } from '../src/app';
import { loadConfig } from '../src/config';
import { createDb } from '../src/db';
import { createVerifier } from '../src/auth';
import { Metrics } from '../src/lib/metrics';
import { invalidateActor } from '../src/lib/actor';
import type { FastifyInstance } from 'fastify';

export const PG_HOST = process.env.TEST_PG_HOST ?? 'localhost';
export const PG_PORT = Number(process.env.TEST_PG_PORT ?? 54329);
const SECRET = 'test-secret-test-secret-test-secret-0123456789';
const SUPABASE_URL = 'https://test-project.supabase.co';
const root = path.resolve(__dirname, '../..');

/** Fresh database: Supabase emulation + legacy schema (to prove quarantine) + all migrations. */
export async function createTestDatabase(name: string) {
  const admin = new pg.Client({ host: PG_HOST, port: PG_PORT, user: 'postgres', database: 'postgres' });
  await admin.connect();
  await admin.query(`drop database if exists ${name} with (force)`);
  await admin.query(`create database ${name}`);
  await admin.end();
  const c = new pg.Client({ host: PG_HOST, port: PG_PORT, user: 'postgres', database: name });
  await c.connect();
  const roles = await c.query(`select 1 from pg_roles where rolname = 'anon'`);
  let emu = readFileSync(path.join(root, 'server/tests/fixtures/supabase-emulation.sql'), 'utf8');
  if (roles.rowCount) emu = emu.replace(/create role [^;]+;\n/g, '').replace(/grant anon, authenticated, service_role to authenticator;\n/, '');
  await c.query(emu);
  for (const f of ['schema.sql', 'rls_policies.sql', 'employee_invites.sql']) await c.query(readFileSync(path.join(root, 'supabase', f), 'utf8'));
  const dir = path.join(root, 'supabase/migrations');
  for (const f of readdirSync(dir).sort()) await c.query(readFileSync(path.join(dir, f), 'utf8'));
  return c; // superuser client for fixtures and tamper tests
}

export interface TestUser {
  id: string;
  email: string;
  sessionId: string;
  token: (opts?: { aal?: 'aal1' | 'aal2'; expiresIn?: string; iatOffset?: number }) => Promise<string>;
}

export async function createUser(su: pg.Client, email: string): Promise<TestUser> {
  const id = randomUUID();
  await su.query(`insert into auth.users (id, email) values ($1, $2)`, [id, email]);
  const sessionId = randomUUID();
  return {
    id,
    email,
    sessionId,
    token: async (o = {}) => {
      const now = Math.floor(Date.now() / 1000) + (o.iatOffset ?? 0);
      return new SignJWT({ email, role: 'authenticated', aal: o.aal ?? 'aal1', session_id: sessionId })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(id)
        .setIssuer(`${SUPABASE_URL}/auth/v1`)
        .setAudience('authenticated')
        .setIssuedAt(now)
        .setExpirationTime(now + (o.expiresIn === '2h' ? 7200 : 3600))
        .sign(new TextEncoder().encode(SECRET));
    },
  };
}

export interface TestApp {
  app: FastifyInstance;
  services: Services;
  emitted: { room: string; event: string; payload: unknown }[];
  forward: { to: ((room: string, event: string, payload: unknown) => void) | null };
  call: (user: TestUser | null, method: string, url: string, body?: unknown, tokenOpts?: Parameters<TestUser['token']>[0]) => Promise<{ status: number; body: any; headers: Record<string, unknown> }>;
  close: () => Promise<void>;
}

export async function startApp(dbName: string, extraEnv: Record<string, string> = {}): Promise<TestApp> {
  invalidateActor();
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: `postgres://bc_api@${PG_HOST}:${PG_PORT}/${dbName}`,
    DATABASE_SSL: 'disable',
    SUPABASE_URL,
    SUPABASE_JWT_SECRET: SECRET,
    CORS_ORIGINS: 'http://localhost:5173',
    EMAIL_OUTBOX_DIR: '/tmp/bc-test-outbox',
    JOBS_ENABLED: 'false',
    ...extraEnv,
  });
  const emitted: TestApp['emitted'] = [];
  const forward: TestApp['forward'] = { to: null };
  const services: Services = {
    config,
    db: createDb(config),
    verify: createVerifier(config),
    mailer: { send: async () => ({ id: 'test', delivered: true }) },
    push: { enabled: false, send: async () => [] },
    emit: (room, event, payload) => {
      emitted.push({ room, event, payload });
      forward.to?.(room, event, payload);
    },
    metrics: new Metrics(),
  };
  const app = await buildApp(services);
  await app.ready();
  return {
    app,
    services,
    emitted,
    forward,
    async call(user, method, url, body, tokenOpts) {
      const headers: Record<string, string> = {};
      if (user) headers.authorization = `Bearer ${await user.token(tokenOpts)}`;
      const res = await app.inject({ method: method as 'GET', url, payload: body as object, headers });
      let parsed: unknown = res.body;
      try {
        parsed = JSON.parse(res.body);
      } catch {
        /* text body (CSV) */
      }
      return { status: res.statusCode, body: parsed, headers: res.headers };
    },
    async close() {
      await app.close();
      await services.db.close();
    },
  };
}

export const iso = (msFromNow: number) => new Date(Date.now() + msFromNow).toISOString();
export const H = 3600_000;

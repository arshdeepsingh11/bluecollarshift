import pg from 'pg';
import type { Config } from './config';
import { fromPgError } from './lib/errors';

// Return DATE columns as plain 'YYYY-MM-DD' strings and BIGINT as numbers (values stay < 2^53).
pg.types.setTypeParser(1082, (v) => v);
pg.types.setTypeParser(20, (v) => Number(v));
pg.types.setTypeParser(1700, (v) => Number(v));

export type Tx = pg.PoolClient;

export interface Db {
  pool: pg.Pool;
  /** Run as the signed-in user: RLS applies (defence in depth on top of API authorization). */
  asUser<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T>;
  /** Run as the trusted server role. Only for registration, invitations, jobs and platform admin. */
  asSystem<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
  ping(): Promise<number>;
  close(): Promise<void>;
}

export function createDb(config: Config, onSlowQuery?: (ms: number, sql: string) => void): Db {
  const pool = new pg.Pool({
    connectionString: config.DATABASE_URL,
    max: config.DATABASE_POOL_MAX,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    ssl:
      config.DATABASE_SSL === 'require'
        ? config.DATABASE_CA_CERT
          ? { ca: config.DATABASE_CA_CERT, rejectUnauthorized: true }
          : { rejectUnauthorized: true }
        : false,
    application_name: 'bluecollar-api',
  });

  async function run<T>(setup: (c: pg.PoolClient) => Promise<void>, fn: (tx: Tx) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    const started = performance.now();
    try {
      await client.query('begin');
      await client.query(`select set_config('statement_timeout', $1, true)`, [String(config.STATEMENT_TIMEOUT_MS)]);
      await setup(client);
      const result = await fn(client);
      await client.query('commit');
      return result;
    } catch (e) {
      await client.query('rollback').catch(() => undefined);
      throw fromPgError(e) ?? e;
    } finally {
      const ms = performance.now() - started;
      if (onSlowQuery && ms > 500) onSlowQuery(ms, 'transaction');
      client.release();
    }
  }

  return {
    pool,
    asUser: (userId, fn) =>
      run(async (c) => {
        // Claims are transaction-local; the pooled connection cannot leak identity to the next request.
        await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: userId, role: 'app_user' })]);
        await c.query('set local role app_user');
      }, fn),
    asSystem: (fn) =>
      run(async (c) => {
        await c.query(`select set_config('request.jwt.claims', '', true)`);
        await c.query('set local role app_system');
      }, fn),
    async ping() {
      const t = performance.now();
      await pool.query('select 1');
      return Math.round(performance.now() - t);
    },
    close: () => pool.end(),
  };
}

import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';

const base = { DATABASE_URL: 'postgres://u:p@localhost:6543/postgres', SUPABASE_URL: 'https://x.supabase.co' };

describe('config', () => {
  it('treats empty values from .env.example as not set', () => {
    const c = loadConfig({ ...base, SUPABASE_JWT_SECRET: '', ALERT_WEBHOOK_URL: '', EXPO_ACCESS_TOKEN: '', RESEND_API_KEY: '  ' });
    expect(c.SUPABASE_JWT_SECRET).toBeUndefined();
    expect(c.ALERT_WEBHOOK_URL).toBeUndefined();
    expect(c.RESEND_API_KEY).toBeUndefined();
  });

  it('refuses unsafe production settings', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'production', DATABASE_SSL: 'disable' })).toThrow(/DATABASE_SSL/);
    expect(() => loadConfig({ ...base, NODE_ENV: 'production', RESEND_API_KEY: 're_x', CORS_ORIGINS: 'http://localhost:5173' })).toThrow(/CORS_ORIGINS/);
  });
});

describe('config CA certificate file', () => {
  it('loads the CA certificate from DATABASE_CA_CERT_FILE', async () => {
    const { writeFileSync, mkdtempSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const file = join(mkdtempSync(join(tmpdir(), 'ca-')), 'ca.crt');
    writeFileSync(file, '-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----\n');
    expect(loadConfig({ ...base, DATABASE_CA_CERT_FILE: file }).DATABASE_CA_CERT).toContain('BEGIN CERTIFICATE');
    expect(() => loadConfig({ ...base, DATABASE_CA_CERT_FILE: join(tmpdir(), 'missing-ca.crt') })).toThrow(/DATABASE_CA_CERT_FILE/);
  });
});

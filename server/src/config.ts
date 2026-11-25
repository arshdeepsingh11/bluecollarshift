import { readFileSync } from 'node:fs';
import { z } from 'zod';

/** All configuration comes from environment variables (never hard-coded). Fails fast on startup. */
const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(8080),
    HOST: z.string().default('0.0.0.0'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

    /** Postgres connection for login role bc_api (use the Supabase pooler in transaction mode, port 6543). */
    DATABASE_URL: z.string().url(),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
    DATABASE_SSL: z.enum(['require', 'disable']).default('require'),
    DATABASE_CA_CERT: z.string().optional(),
    /** Path to the database CA certificate (Supabase: Database Settings > SSL Configuration > Download certificate). */
    DATABASE_CA_CERT_FILE: z.string().optional(),
    STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(500).max(60_000).default(8000),

    SUPABASE_URL: z.string().url(),
    /** Legacy HS256 JWT secret. Leave empty when the project uses asymmetric signing keys (JWKS). */
    SUPABASE_JWT_SECRET: z.string().min(32).optional(),
    /** Server-only. Used for Supabase Auth admin calls (invite links). NEVER sent to clients. */
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(20).optional(),

    APP_URL: z.string().url().default('http://localhost:5173/app'),
    ADMIN_URL: z.string().url().default('http://localhost:5173/admin'),
    CORS_ORIGINS: z.string().default('http://localhost:5173,http://localhost:4173'),

    RESEND_API_KEY: z.string().optional(),
    EMAIL_FROM: z.string().default('Blue Collar <no-reply@bluecollarshift.com>'),
    /** Local development: write emails to this folder instead of sending. */
    EMAIL_OUTBOX_DIR: z.string().default('.mail-outbox'),

    EXPO_ACCESS_TOKEN: z.string().optional(),
    JOBS_ENABLED: z
      .enum(['true', 'false'])
      .default('true')
      .transform((v) => v === 'true'),
    LATE_GRACE_MINUTES: z.coerce.number().int().min(1).max(120).default(10),
    TRUST_PROXY: z
      .enum(['true', 'false'])
      .default('true')
      .transform((v) => v === 'true'),
    ALERT_WEBHOOK_URL: z.string().url().optional(),
    /** Benchmarks only. Production refuses to start with rate limits disabled. */
    RATE_LIMITS_ENABLED: z
      .enum(['true', 'false'])
      .default('true')
      .transform((v) => v === 'true'),
  })
  .superRefine((c, ctx) => {
    if (c.NODE_ENV === 'production') {
      if (c.DATABASE_SSL !== 'require') ctx.addIssue({ code: 'custom', message: 'DATABASE_SSL must be require in production', path: ['DATABASE_SSL'] });
      if (!c.RESEND_API_KEY) ctx.addIssue({ code: 'custom', message: 'RESEND_API_KEY is required in production', path: ['RESEND_API_KEY'] });
      if (!c.RATE_LIMITS_ENABLED) ctx.addIssue({ code: 'custom', message: 'Rate limits cannot be disabled in production', path: ['RATE_LIMITS_ENABLED'] });
      if (c.CORS_ORIGINS.includes('localhost'))
        ctx.addIssue({ code: 'custom', message: 'CORS_ORIGINS must not include localhost in production', path: ['CORS_ORIGINS'] });
    }
  });

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // Treat empty values (e.g. `SUPABASE_JWT_SECRET=` copied from .env.example) as "not set".
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v.trim() !== ''));
  const parsed = schema.safeParse(cleaned);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n  ');
    throw new Error(`Invalid configuration:\n  ${issues}`);
  }
  const data = parsed.data;
  if (!data.DATABASE_CA_CERT && data.DATABASE_CA_CERT_FILE) {
    try {
      data.DATABASE_CA_CERT = readFileSync(data.DATABASE_CA_CERT_FILE, 'utf8');
    } catch (e) {
      throw new Error(`Invalid configuration:\n  DATABASE_CA_CERT_FILE: cannot read ${data.DATABASE_CA_CERT_FILE} (${(e as Error).message})`);
    }
  }
  return data;
}

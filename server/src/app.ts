import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { randomUUID } from 'node:crypto';
import { ZodError, type ZodTypeAny, type z } from 'zod';
import type { Config } from './config';
import type { Db } from './db';
import { bearer, type TokenVerifier } from './auth';
import { AppError, forbidden, unauthorized } from './lib/errors';
import { loadActor, type Actor } from './lib/actor';
import { auditDetached, securityEvent } from './lib/audit';
import type { Mailer } from './services/email';
import type { PushSender } from './services/push';
import type { RealtimeEmit } from './services/notify';
import { Metrics } from './lib/metrics';

export interface Services {
  config: Config;
  db: Db;
  verify: TokenVerifier;
  mailer: Mailer;
  push: PushSender;
  emit: RealtimeEmit;
  metrics: Metrics;
}

declare module 'fastify' {
  interface FastifyRequest {
    actor?: Actor;
  }
  interface FastifyInstance {
    services: Services;
  }
}

export type Handler = (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>;

export function parse<S extends ZodTypeAny>(schema: S, value: unknown): z.infer<S> {
  return schema.parse(value);
}

export function actorOf(req: FastifyRequest): Actor {
  if (!req.actor) throw unauthorized();
  return req.actor;
}

/** Route option: authenticate the caller and load their memberships/permissions. */
export async function authenticate(req: FastifyRequest) {
  const { verify, db } = req.server.services;
  const claims = await verify(bearer(req.headers.authorization));
  req.actor = await loadActor(db, claims);
}

export async function buildApp(services: Services): Promise<FastifyInstance> {
  const { config } = services;
  const app = Fastify({
    logger: {
      level: config.NODE_ENV === 'test' ? 'silent' : config.LOG_LEVEL,
      redact: { paths: ['req.headers.authorization', 'req.headers.cookie', '*.token', '*.password'], censor: '[redacted]' },
    },
    genReqId: (req) => {
      const incoming = req.headers['x-request-id'];
      return typeof incoming === 'string' && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
    },
    trustProxy: config.TRUST_PROXY,
    bodyLimit: 256 * 1024,
    connectionTimeout: 30_000,
    requestTimeout: 30_000,
    ajv: { customOptions: { removeAdditional: false } },
  });
  app.decorate('services', services);

  await app.register(helmet, {
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    crossOriginResourcePolicy: { policy: 'same-site' },
    hsts: { maxAge: 63072000, includeSubDomains: true, preload: true },
  });
  const allowed = new Set(config.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean));
  await app.register(cors, {
    origin: (origin, cb) => cb(null, !origin || allowed.has(origin)),
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Request-Id', 'Idempotency-Key'],
    maxAge: 600,
  });
  if (!config.RATE_LIMITS_ENABLED) {
    // Benchmarks only (config refuses this in production): drop per-route limits too.
    app.addHook('onRoute', (opts) => {
      if (opts.config && typeof opts.config === 'object') delete (opts.config as { rateLimit?: unknown }).rateLimit;
    });
  }

  await app.register(rateLimit, {
    global: config.RATE_LIMITS_ENABLED,
    max: config.RATE_LIMITS_ENABLED ? 300 : 1_000_000,
    timeWindow: '1 minute',
    keyGenerator: (req) => req.ip,
    onExceeded: (req) => {
      void securityEvent(services.db, { type: 'rate_limit_exceeded', severity: 'warning', ip: req.ip, metadata: { url: req.url } });
    },
  });

  app.addHook('onRequest', async (req, reply) => {
    reply.header('x-request-id', req.id);
    reply.header('cache-control', 'no-store');
  });
  app.addHook('onResponse', async (req, reply) => {
    services.metrics.record(req.routeOptions.url ?? 'unknown', req.method, reply.statusCode, reply.elapsedTime);
  });

  app.setErrorHandler(async (err, req, reply) => {
    let e: AppError;
    if (err instanceof AppError) e = err;
    else if (err instanceof ZodError || ((err as { name?: string }).name === 'ZodError' && Array.isArray((err as ZodError).issues)))
      e = new AppError(400, 'validation_failed', 'Some fields are invalid.', (err as ZodError).issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
    else if ((err as { statusCode?: number }).statusCode === 429) e = new AppError(429, 'rate_limited', 'Too many requests. Please slow down.');
    else if ((err as { validation?: unknown }).validation) e = new AppError(400, 'validation_failed', (err as Error).message);
    else if ((err as { statusCode?: number }).statusCode && (err as { statusCode: number }).statusCode < 500)
      e = new AppError((err as { statusCode: number }).statusCode, 'bad_request', 'Invalid request.');
    else {
      req.log.error({ err }, 'unhandled error');
      e = new AppError(500, 'internal', 'Something went wrong. Please try again.');
    }
    if (e.status === 401) {
      void securityEvent(services.db, { type: 'auth_rejected', severity: 'info', ip: req.ip, metadata: { url: req.url } });
    }
    if (e.status === 403 && req.actor) {
      // Permission failures are audited: repeated failures indicate probing or privilege-escalation attempts.
      void auditDetached(services.db, {
        actorUserId: req.actor.userId,
        action: 'authorization.denied',
        targetType: 'route',
        targetId: `${req.method} ${req.routeOptions.url ?? req.url}`,
        ip: req.ip,
        requestId: req.id,
        success: false,
      });
      void securityEvent(services.db, { userId: req.actor.userId, type: 'permission_denied', severity: 'warning', ip: req.ip, metadata: { url: req.url } });
    }
    return reply.status(e.status).send({ error: { code: e.code, message: e.message, details: e.details, requestId: req.id } });
  });

  app.setNotFoundHandler((req, reply) =>
    reply.status(404).send({ error: { code: 'not_found', message: 'Not found', requestId: req.id } }),
  );

  // Health checks (no authentication; reveal nothing sensitive).
  app.get('/health', { config: { rateLimit: false } }, async () => ({ status: 'ok' }));
  app.get('/health/ready', { config: { rateLimit: false } }, async (req, reply) => {
    try {
      const ms = await services.db.ping();
      return { status: 'ready', database: { ok: true, latencyMs: ms } };
    } catch (err) {
      req.log.error({ err: (err as Error).message }, 'database not reachable');
      return reply.status(503).send({ status: 'unavailable', database: { ok: false } });
    }
  });

  const modules = await Promise.all([
    import('./modules/me'),
    import('./modules/companies'),
    import('./modules/members'),
    import('./modules/sites'),
    import('./modules/shifts'),
    import('./modules/attendance'),
    import('./modules/timesheets'),
    import('./modules/payroll'),
    import('./modules/messaging'),
    import('./modules/notifications'),
    import('./modules/reports'),
    import('./modules/admin'),
    import('./modules/ops'),
  ]);
  await app.register(
    async (api) => {
      api.addHook('onRequest', async (req) => {
        if ((req.routeOptions.config as { public?: boolean } | undefined)?.public) return;
        await authenticate(req);
      });
      for (const m of modules) await api.register(m.default);
    },
    { prefix: '/api/v1' },
  );

  return app;
}

export function requireStaffForSelf(actor: Actor, membershipId: string) {
  if (actor.memberships.some((m) => m.membershipId === membershipId)) throw forbidden('You cannot do this on your own record.');
}

import { loadConfig } from './config';
import { createDb } from './db';
import { createVerifier } from './auth';
import { buildApp, type Services } from './app';
import { createMailer } from './services/email';
import { createPushSender } from './services/push';
import { attachRealtime } from './realtime';
import { startScheduler } from './jobs/scheduler';
import { Metrics } from './lib/metrics';
import type { Server } from 'socket.io';

async function main() {
  const config = loadConfig();
  let io: Server | null = null;
  const metrics = new Metrics();
  const db = createDb(config, () => metrics.inc('db.slow_transactions'));
  const services: Services = {
    config,
    db,
    verify: createVerifier(config),
    mailer: createMailer(config, { info: () => undefined, error: () => undefined }),
    push: createPushSender(config),
    emit: (room, event, payload) => io?.to(room).emit(event, payload),
    metrics,
  };
  const app = await buildApp(services);
  services.mailer = createMailer(config, app.log);

  await app.listen({ port: config.PORT, host: config.HOST });
  io = attachRealtime(app.server, services);
  const stopJobs = config.JOBS_ENABLED ? startScheduler(services, app.log) : () => undefined;
  app.log.info({ port: config.PORT, jobs: config.JOBS_ENABLED }, 'Blue Collar API started');

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'shutting down');
    stopJobs();
    io?.close();
    await app.close();
    await db.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

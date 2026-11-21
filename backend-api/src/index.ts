import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { loadBackendEnv } from './config/env.js';
import { BullMqImageQueueProducer } from './queue/image-queue.js';
import { PostgresJobRepository } from './repositories/job.repository.js';
import { LocalStorageService } from './services/storage.service.js';

async function bootstrap(): Promise<void> {
  const config = loadBackendEnv();

  const storageService = new LocalStorageService(config.storageDir);
  await storageService.ensureDirectories();

  const jobRepository = new PostgresJobRepository(config.databaseUrl);
  const queueProducer = new BullMqImageQueueProducer(
    config.redisUrl,
    config.queueName,
  );

  const app = createApp({
    jobRepository,
    queueProducer,
    storageService,
    maxFileSizeBytes: config.maxFileSizeBytes,
    corsOrigins: config.corsOrigins,
  });

  const server = serve(
    {
      fetch: app.fetch,
      port: config.port,
    },
    (info) => {
      console.log(
        `[backend-api] Hono delegator listening on http://localhost:${info.port}`,
      );
    },
  );

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    console.log(`[backend-api] Received ${signal}. Closing server gracefully...`);

    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });

    await Promise.allSettled([queueProducer.close(), jobRepository.close()]);
    console.log('[backend-api] Shutdown complete.');
    process.exit(0);
  };

  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
}

bootstrap().catch((error: unknown) => {
  console.error('[backend-api] Fatal startup error:', error);
  process.exit(1);
});

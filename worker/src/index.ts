import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { loadWorkerEnv } from './config/env.js';
import { createImageWorker } from './queue/image-worker.js';
import { reconcileStaleProcessingJobs } from './queue/reconciler.js';
import { PostgresWorkerJobRepository } from './repositories/worker-job.repository.js';
import type { ProcessImageJobPayload } from './types/worker.types.js';

async function bootstrap(): Promise<void> {
  const config = loadWorkerEnv();

  await mkdir(path.join(config.storageDir, 'uploads'), { recursive: true });
  await mkdir(path.join(config.storageDir, 'processed'), { recursive: true });

  const repository = new PostgresWorkerJobRepository(config.databaseUrl);
  const dbHealthy = await repository.ping();
  if (!dbHealthy) {
    throw new Error('Cannot connect to NeonDB PostgreSQL during worker startup.');
  }

  const workerRedis = new Redis(config.redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  });

  const queueRedis = new Redis(config.redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  });

  const reconciliationQueue = new Queue<ProcessImageJobPayload>(config.queueName, {
    connection: queueRedis,
  });

  const reconciliation = await reconcileStaleProcessingJobs({
    repository,
    queue: reconciliationQueue,
    storageDir: config.storageDir,
    staleThresholdMinutes: config.staleJobThresholdMinutes,
  });

  if (reconciliation.checkedCount > 0) {
    console.log(
      `[worker] Startup reconciliation: checked=${reconciliation.checkedCount}, markedFailed=${reconciliation.markedFailedCount}, stillActive=${reconciliation.stillActiveInQueueCount}`,
    );
  }

  const worker = createImageWorker({
    queueName: config.queueName,
    redisConnection: workerRedis,
    concurrency: config.workerConcurrency,
    repository,
    storageDir: config.storageDir,
  });

  console.log(
    `[worker] BullMQ + Sharp image worker listening on queue "${config.queueName}" (concurrency=${config.workerConcurrency})`,
  );

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    console.log(
      `[worker] Received ${signal}. Waiting for active image jobs to finish before exiting...`,
    );

    await Promise.allSettled([
      worker.close(),
      reconciliationQueue.close(),
    ]);
    await Promise.allSettled([
      workerRedis.quit(),
      queueRedis.quit(),
      repository.close(),
    ]);

    console.log('[worker] Graceful shutdown complete.');
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
  console.error('[worker] Fatal startup error:', error);
  process.exit(1);
});

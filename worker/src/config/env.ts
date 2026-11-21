import { existsSync } from 'node:fs';
import path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';
import { DEFAULT_QUEUE_NAME } from './constants.js';

const workerEnvSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
  BULLMQ_QUEUE_NAME: z.string().min(1).default(DEFAULT_QUEUE_NAME),
  STORAGE_DIR: z.string().min(1).default('../storage'),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(2),
  STALE_JOB_THRESHOLD_MINUTES: z.coerce.number().int().min(1).max(1440).default(2),
});

export interface WorkerEnvConfig {
  databaseUrl: string;
  redisUrl: string;
  queueName: string;
  storageDir: string;
  workerConcurrency: number;
  staleJobThresholdMinutes: number;
}

export function loadWorkerEnv(): WorkerEnvConfig {
  const localEnvPath = path.resolve(process.cwd(), '.env');
  const rootEnvPath = path.resolve(process.cwd(), '../.env');

  if (existsSync(localEnvPath)) {
    loadDotenv({ path: localEnvPath });
  } else if (existsSync(rootEnvPath)) {
    loadDotenv({ path: rootEnvPath });
  }

  const parsed = workerEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid worker environment configuration: ${details}`);
  }

  const data = parsed.data;
  return {
    databaseUrl: data.DATABASE_URL,
    redisUrl: data.REDIS_URL,
    queueName: data.BULLMQ_QUEUE_NAME,
    storageDir: path.resolve(process.cwd(), data.STORAGE_DIR),
    workerConcurrency: data.WORKER_CONCURRENCY,
    staleJobThresholdMinutes: data.STALE_JOB_THRESHOLD_MINUTES,
  };
}

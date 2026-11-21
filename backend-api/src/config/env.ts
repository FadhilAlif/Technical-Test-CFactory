import { existsSync } from 'node:fs';
import path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

const MAX_ALLOWED_BYTES = 20 * 1024 * 1024; // 20 MB (20,971,520 bytes)

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
  BULLMQ_QUEUE_NAME: z.string().min(1).default('image-processing-queue'),
  STORAGE_DIR: z.string().min(1).default('../storage'),
  MAX_FILE_SIZE_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .max(MAX_ALLOWED_BYTES, `MAX_FILE_SIZE_BYTES cannot exceed ${MAX_ALLOWED_BYTES}`)
    .default(MAX_ALLOWED_BYTES),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  CORS_ORIGIN: z.string().min(1).default('http://localhost:3000'),
});

export interface BackendEnvConfig {
  databaseUrl: string;
  redisUrl: string;
  queueName: string;
  storageDir: string;
  maxFileSizeBytes: number;
  port: number;
  corsOrigins: string[];
}

export function loadBackendEnv(): BackendEnvConfig {
  const localEnvPath = path.resolve(process.cwd(), '.env');
  const rootEnvPath = path.resolve(process.cwd(), '../.env');

  if (existsSync(localEnvPath)) {
    loadDotenv({ path: localEnvPath });
  } else if (existsSync(rootEnvPath)) {
    loadDotenv({ path: rootEnvPath });
  }

  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid backend-api environment configuration: ${details}`);
  }

  const data = parsed.data;
  const corsOrigins = data.CORS_ORIGIN.split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  return {
    databaseUrl: data.DATABASE_URL,
    redisUrl: data.REDIS_URL,
    queueName: data.BULLMQ_QUEUE_NAME,
    storageDir: path.resolve(process.cwd(), data.STORAGE_DIR),
    maxFileSizeBytes: data.MAX_FILE_SIZE_BYTES,
    port: data.PORT,
    corsOrigins: corsOrigins.length > 0 ? corsOrigins : ['http://localhost:3000'],
  };
}

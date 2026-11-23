import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { ImageQueueProducer } from './queue/image-queue.js';
import type { JobRepository } from './repositories/job.repository.js';
import { createHealthRouter } from './routes/health.routes.js';
import { createJobsRouter } from './routes/jobs.routes.js';
import { JobService } from './services/job.service.js';
import type { StorageService } from './services/storage.service.js';
import type { ApiErrorResponse } from './types/job.types.js';

export interface CreateAppDependencies {
  jobRepository: JobRepository;
  queueProducer: ImageQueueProducer;
  storageService: StorageService;
  maxFileSizeBytes: number;
  corsOrigins: string[];
}

export function createApp(deps: CreateAppDependencies): Hono {
  const app = new Hono();

  app.use(
    '/api/*',
    cors({
      origin: (requestOrigin) => {
        if (!requestOrigin) {
          return deps.corsOrigins[0] ?? 'http://localhost:3000';
        }
        if (deps.corsOrigins.includes('*')) {
          return requestOrigin;
        }
        return deps.corsOrigins.includes(requestOrigin) ? requestOrigin : '';
      },
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Accept'],
      exposeHeaders: ['Content-Disposition', 'Content-Length', 'Content-Type'],
      maxAge: 600,
    }),
  );

  const jobService = new JobService({
    jobRepository: deps.jobRepository,
    queueProducer: deps.queueProducer,
    storageService: deps.storageService,
    maxFileSizeBytes: deps.maxFileSizeBytes,
  });

  app.route('/api/jobs', createJobsRouter(jobService, deps.storageService));
  app.route('/api/health', createHealthRouter(deps.jobRepository, deps.queueProducer));

  app.notFound((c) => {
    const errorBody: ApiErrorResponse = {
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: `Route '${c.req.method} ${c.req.path}' does not exist.`,
      },
    };
    return c.json(errorBody, 404);
  });

  app.onError((err, c) => {
    console.error('[backend-api] Unhandled error:', err);
    const errorBody: ApiErrorResponse = {
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An unexpected server error occurred while processing the request.',
      },
    };
    return c.json(errorBody, 500);
  });

  return app;
}

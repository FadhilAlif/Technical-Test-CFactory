import { Hono } from 'hono';
import type { ImageQueueProducer } from '../queue/image-queue.js';
import type { JobRepository } from '../repositories/job.repository.js';

export function createHealthRouter(
  jobRepository: JobRepository,
  queueProducer: ImageQueueProducer,
): Hono {
  const router = new Hono();

  router.get('/', async (c) => {
    const [dbCheck, redisCheck] = await Promise.allSettled([
      jobRepository.ping(),
      queueProducer.ping(),
    ]);

    const dbUp = dbCheck.status === 'fulfilled' && dbCheck.value;
    const redisUp = redisCheck.status === 'fulfilled' && redisCheck.value;
    const healthy = dbUp && redisUp;

    return c.json(
      {
        success: healthy,
        status: healthy ? 'ok' : 'degraded',
        services: {
          database: dbUp ? 'up' : 'down',
          redis: redisUp ? 'up' : 'down',
        },
      },
      healthy ? 200 : 503,
    );
  });

  return router;
}

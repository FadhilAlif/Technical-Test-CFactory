import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import type { ProcessImageJobPayload } from '../types/job.types.js';

export const PROCESS_IMAGE_JOB_NAME = 'process-image' as const;

export interface ImageQueueProducer {
  enqueueImageJob(payload: ProcessImageJobPayload): Promise<void>;
  ping(): Promise<boolean>;
  close(): Promise<void>;
}

export class BullMqImageQueueProducer implements ImageQueueProducer {
  private readonly redis: Redis;
  private readonly queue: Queue<ProcessImageJobPayload>;

  constructor(redisUrl: string, queueName: string) {
    this.redis = new Redis(redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
    });

    this.queue = new Queue<ProcessImageJobPayload>(queueName, {
      connection: this.redis,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 1000,
        },
        removeOnComplete: {
          age: 3600,
          count: 500,
        },
        removeOnFail: {
          age: 86400,
        },
      },
    });
  }

  async enqueueImageJob(payload: ProcessImageJobPayload): Promise<void> {
    await this.queue.add(PROCESS_IMAGE_JOB_NAME, payload, {
      jobId: payload.jobId,
    });
  }

  async ping(): Promise<boolean> {
    try {
      const reply = await this.redis.ping();
      return reply === 'PONG';
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    await this.queue.close();
    await this.redis.quit();
  }
}

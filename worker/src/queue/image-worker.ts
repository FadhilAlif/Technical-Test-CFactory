import { UnrecoverableError, Worker, type Job } from 'bullmq';
import type { Redis } from 'ioredis';
import {
  PermanentImageError,
  processImageFile,
  type ProcessImageInput,
} from '../processor/image-processor.js';
import type { WorkerJobRepository } from '../repositories/worker-job.repository.js';
import type {
  ProcessedImageResult,
  ProcessImageJobPayload,
} from '../types/worker.types.js';

export interface ImageJobHandlerDependencies {
  repository: WorkerJobRepository;
  storageDir: string;
  processImage?: (input: ProcessImageInput) => Promise<ProcessedImageResult>;
}

export interface MinimalJobContext {
  data: ProcessImageJobPayload;
  attemptsMade: number;
  opts: { attempts?: number };
}

export function sanitizeWorkerErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message.trim().slice(0, 1000);
  }
  return 'An unexpected error occurred while processing the image.';
}

/**
 * Pure job handler implementing strict lifecycle transitions (BR-04, BR-05, BR-08):
 * pending -> processing -> completed / failed
 */
export function createImageJobHandler(deps: ImageJobHandlerDependencies) {
  const runImagePipeline = deps.processImage ?? processImageFile;

  return async (job: MinimalJobContext): Promise<ProcessedImageResult> => {
    const { jobId, originalPath } = job.data;
    const attemptNumber = job.attemptsMade + 1;
    const maxAttempts = job.opts.attempts ?? 1;

    const transitionedToProcessing = await deps.repository.markProcessing(
      jobId,
      attemptNumber,
    );

    if (!transitionedToProcessing) {
      throw new UnrecoverableError(
        `Job '${jobId}' is not eligible for processing (missing or already in terminal state).`,
      );
    }

    try {
      const output = await runImagePipeline({
        jobId,
        storageDir: deps.storageDir,
        originalRelativePath: originalPath,
      });

      const transitionedToCompleted = await deps.repository.markCompleted({
        jobId,
        processedPath: output.processedRelativePath,
        processedSizeBytes: output.processedSizeBytes,
        width: output.width,
        height: output.height,
      });

      if (!transitionedToCompleted) {
        throw new Error(
          `Failed to persist completed state for job '${jobId}' in database.`,
        );
      }

      return output;
    } catch (error) {
      const errorMessage = sanitizeWorkerErrorMessage(error);

      if (error instanceof PermanentImageError) {
        await deps.repository.markFailed(jobId, errorMessage);
        throw new UnrecoverableError(errorMessage);
      }

      if (attemptNumber >= maxAttempts) {
        await deps.repository.markFailed(jobId, errorMessage);
      }

      throw error;
    }
  };
}

export interface CreateImageWorkerOptions {
  queueName: string;
  redisConnection: Redis;
  concurrency: number;
  repository: WorkerJobRepository;
  storageDir: string;
}

export function createImageWorker(
  options: CreateImageWorkerOptions,
): Worker<ProcessImageJobPayload, ProcessedImageResult> {
  const handleJob = createImageJobHandler({
    repository: options.repository,
    storageDir: options.storageDir,
  });

  const worker = new Worker<ProcessImageJobPayload, ProcessedImageResult>(
    options.queueName,
    async (job: Job<ProcessImageJobPayload>) => handleJob(job),
    {
      connection: options.redisConnection,
      concurrency: options.concurrency,
      lockDuration: 30_000,
      stalledInterval: 15_000,
      maxStalledCount: 2,
    },
  );

  worker.on('completed', (job, result) => {
    console.log(
      `[worker] Job ${job.data.jobId} completed -> ${result.width}x${result.height} (${result.processedSizeBytes} bytes, ${result.format})`,
    );
  });

  worker.on('stalled', (jobId) => {
    console.warn(
      `[worker] Detected stalled job ${jobId}. BullMQ will attempt recovery up to maxStalledCount.`,
    );
  });

  worker.on('failed', async (job, error) => {
    const jobId = job?.data?.jobId ?? job?.id ?? 'unknown';
    const message = sanitizeWorkerErrorMessage(error);
    console.error(`[worker] Job ${jobId} failed: ${message}`);

    if (!job?.data?.jobId) {
      return;
    }

    const maxAttempts = job.opts.attempts ?? 1;
    const isFinalFailure =
      error instanceof UnrecoverableError ||
      job.attemptsMade >= maxAttempts ||
      message.toLowerCase().includes('stalled');

    if (isFinalFailure) {
      try {
        await options.repository.markFailed(job.data.jobId, message);
      } catch (dbErr) {
        console.error(
          `[worker] Failed to mark job ${job.data.jobId} as failed in DB:`,
          dbErr,
        );
      }
    }
  });

  worker.on('error', (error) => {
    console.error('[worker] Operational worker error:', error);
  });

  return worker;
}

import path from 'node:path';
import type { Queue } from 'bullmq';
import { cleanupTempFileSafe } from '../processor/image-processor.js';
import type { WorkerJobRepository } from '../repositories/worker-job.repository.js';
import type { ProcessImageJobPayload } from '../types/worker.types.js';

export interface ReconciliationParams {
  repository: WorkerJobRepository;
  queue: Pick<Queue<ProcessImageJobPayload>, 'getJob'>;
  storageDir: string;
  staleThresholdMinutes: number;
}

export interface ReconciliationResult {
  checkedCount: number;
  markedFailedCount: number;
  stillActiveInQueueCount: number;
}

/**
 * Startup State Reconciliation (Bonus Point):
 * Detects jobs stranded in `processing` after an abrupt worker crash (e.g. SIGKILL/OOM).
 * If the job is still active/waiting/delayed in Redis BullMQ, BullMQ stalled recovery
 * will handle it; otherwise it is cleanly transitioned to `failed` and temp files removed.
 */
export async function reconcileStaleProcessingJobs(
  params: ReconciliationParams,
): Promise<ReconciliationResult> {
  const staleJobIds = await params.repository.findStaleProcessingJobs(
    params.staleThresholdMinutes,
  );

  let markedFailedCount = 0;
  let stillActiveInQueueCount = 0;

  for (const jobId of staleJobIds) {
    const bullJob = await params.queue.getJob(jobId);
    const bullState = bullJob ? await bullJob.getState() : null;

    if (
      bullState === 'active' ||
      bullState === 'waiting' ||
      bullState === 'delayed' ||
      bullState === 'prioritized'
    ) {
      stillActiveInQueueCount += 1;
      continue;
    }

    const tempPath = path.join(
      path.resolve(params.storageDir),
      'processed',
      `${jobId}.tmp.webp`,
    );
    await cleanupTempFileSafe(tempPath);

    const updated = await params.repository.markFailed(
      jobId,
      'Worker restarted unexpectedly before completing the image processing job. Please re-upload the image.',
    );

    if (updated) {
      markedFailedCount += 1;
    }
  }

  return {
    checkedCount: staleJobIds.length,
    markedFailedCount,
    stillActiveInQueueCount,
  };
}

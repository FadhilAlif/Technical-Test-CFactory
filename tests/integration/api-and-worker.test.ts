import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../backend-api/src/app.js';
import type { ImageQueueProducer } from '../../backend-api/src/queue/image-queue.js';
import type {
  CreatePendingJobInput,
  JobRepository,
} from '../../backend-api/src/repositories/job.repository.js';
import { LocalStorageService } from '../../backend-api/src/services/storage.service.js';
import type {
  ImageJobRecord,
  ProcessImageJobPayload,
} from '../../backend-api/src/types/job.types.js';
import { createImageJobHandler } from '../../worker/src/queue/image-worker.js';
import { reconcileStaleProcessingJobs } from '../../worker/src/queue/reconciler.js';
import type { WorkerJobRepository } from '../../worker/src/repositories/worker-job.repository.js';
import type { MarkCompletedInput } from '../../worker/src/types/worker.types.js';

/**
 * Shared in-memory repository implementing both Backend API & Worker contracts
 * to exercise the full async delegation -> processing -> download lifecycle deterministically.
 */
class InMemoryJobStore implements JobRepository, WorkerJobRepository {
  readonly jobs = new Map<string, ImageJobRecord>();
  dbHealthy = true;

  async createPendingJob(input: CreatePendingJobInput): Promise<ImageJobRecord> {
    const now = new Date();
    const record: ImageJobRecord = {
      id: input.id,
      original_filename: input.originalFilename,
      original_mime_type: input.originalMimeType,
      original_size_bytes: input.originalSizeBytes,
      original_path: input.originalPath,
      processed_path: null,
      processed_size_bytes: null,
      width: null,
      height: null,
      status: 'pending',
      error_message: null,
      attempts: 0,
      created_at: now,
      started_at: null,
      completed_at: null,
      updated_at: now,
    };
    this.jobs.set(record.id, record);
    return record;
  }

  async findJobById(jobId: string): Promise<ImageJobRecord | null> {
    return this.jobs.get(jobId) ?? null;
  }

  async markFailedOnEnqueueError(
    jobId: string,
    errorMessage: string,
  ): Promise<void> {
    await this.markFailed(jobId, errorMessage);
  }

  async markProcessing(jobId: string, attempt: number): Promise<boolean> {
    const rec = this.jobs.get(jobId);
    if (!rec || (rec.status !== 'pending' && rec.status !== 'processing')) {
      return false;
    }
    rec.status = 'processing';
    rec.started_at = rec.started_at ?? new Date();
    rec.attempts = Math.max(rec.attempts, attempt);
    rec.updated_at = new Date();
    return true;
  }

  async markCompleted(input: MarkCompletedInput): Promise<boolean> {
    const rec = this.jobs.get(input.jobId);
    if (!rec || rec.status !== 'processing') {
      return false;
    }
    rec.status = 'completed';
    rec.processed_path = input.processedPath;
    rec.processed_size_bytes = input.processedSizeBytes;
    rec.width = input.width;
    rec.height = input.height;
    rec.error_message = null;
    rec.completed_at = new Date();
    rec.updated_at = new Date();
    return true;
  }

  async markFailed(jobId: string, errorMessage: string): Promise<boolean> {
    const rec = this.jobs.get(jobId);
    if (!rec || (rec.status !== 'pending' && rec.status !== 'processing')) {
      return false;
    }
    rec.status = 'failed';
    rec.error_message = errorMessage;
    rec.completed_at = new Date();
    rec.updated_at = new Date();
    return true;
  }

  async findStaleProcessingJobs(): Promise<string[]> {
    return [...this.jobs.values()]
      .filter((job) => job.status === 'processing')
      .map((job) => job.id);
  }

  async ping(): Promise<boolean> {
    return this.dbHealthy;
  }

  async close(): Promise<void> {}
}

describe('End-to-End API Delegation + Async Worker Integration', () => {
  let tempStorage = '';
  let store: InMemoryJobStore;
  let enqueuedPayloads: ProcessImageJobPayload[];
  let redisHealthy = true;
  let storage: LocalStorageService;

  beforeAll(async () => {
    tempStorage = await mkdtemp(path.join(os.tmpdir(), 'caip-int-'));
    storage = new LocalStorageService(tempStorage);
    await storage.ensureDirectories();
    store = new InMemoryJobStore();
    enqueuedPayloads = [];
  });

  afterAll(async () => {
    if (tempStorage) {
      await rm(tempStorage, { recursive: true, force: true });
    }
  });

  function buildApp() {
    const queueProducer: ImageQueueProducer = {
      async enqueueImageJob(payload) {
        enqueuedPayloads.push(payload);
      },
      async ping() {
        return redisHealthy;
      },
      async close() {},
    };

    return createApp({
      jobRepository: store,
      queueProducer,
      storageService: storage,
      maxFileSizeBytes: 20 * 1024 * 1024,
      corsOrigins: ['http://localhost:3000'],
    });
  }

  it('runs complete non-blocking upload -> worker processing -> WebP download flow', async () => {
    const app = buildApp();
    const handleJob = createImageJobHandler({
      repository: store,
      storageDir: tempStorage,
    });

    // 1. Upload 2000x1000 PNG via POST /api/jobs
    const sourcePng = await sharp({
      create: {
        width: 2000,
        height: 1000,
        channels: 3,
        background: { r: 80, g: 140, b: 240 },
      },
    })
      .png()
      .toBuffer();

    const form = new FormData();
    form.append('image', new File([sourcePng], 'banner-hero.png', { type: 'image/png' }));

    const uploadRes = await app.request('/api/jobs', {
      method: 'POST',
      headers: { Origin: 'http://localhost:3000' },
      body: form,
    });

    expect(uploadRes.status).toBe(202);
    expect(uploadRes.headers.get('access-control-allow-origin')).toBe(
      'http://localhost:3000',
    );
    const uploadJson = (await uploadRes.json()) as {
      success: boolean;
      data: { job_id: string; status: string };
    };
    expect(uploadJson.success).toBe(true);
    expect(uploadJson.data.status).toBe('pending');
    const jobId = uploadJson.data.job_id;

    // 2. Download before processing completes must be rejected with 409 Conflict (BR-07)
    const pendingDlRes = await app.request(`/api/jobs/${jobId}/download`);
    expect(pendingDlRes.status).toBe(409);

    // 3. Background worker picks up enqueued job independently
    const queuedPayload = enqueuedPayloads.find((p) => p.jobId === jobId);
    expect(queuedPayload).toBeDefined();
    await handleJob({
      data: queuedPayload!,
      attemptsMade: 0,
      opts: { attempts: 3 },
    });

    // 4. Status endpoint now reports completed with resized 1280x640 metadata
    const statusRes = await app.request(`/api/jobs/${jobId}`);
    expect(statusRes.status).toBe(200);
    const statusJson = (await statusRes.json()) as {
      success: boolean;
      data: {
        status: string;
        width: number;
        height: number;
        download_url: string;
        processed_size_bytes: number;
      };
    };
    expect(statusJson.data.status).toBe('completed');
    expect(statusJson.data.width).toBe(1280);
    expect(statusJson.data.height).toBe(640);
    expect(statusJson.data.download_url).toBe(`/api/jobs/${jobId}/download`);

    // 5. Download endpoint streams valid WebP binary
    const dlRes = await app.request(`/api/jobs/${jobId}/download`);
    expect(dlRes.status).toBe(200);
    expect(dlRes.headers.get('content-type')).toBe('image/webp');
    expect(dlRes.headers.get('content-disposition')).toContain(
      'attachment; filename="processed-banner-hero.webp"',
    );

    const downloadedBuffer = Buffer.from(await dlRes.arrayBuffer());
    const downloadedMeta = await sharp(downloadedBuffer).metadata();
    expect(downloadedMeta.format).toBe('webp');
    expect(downloadedMeta.width).toBe(1280);
    expect(downloadedMeta.height).toBe(640);
  });

  it('transitions corrupted image job to failed and rejects download with 422', async () => {
    const app = buildApp();
    const handleJob = createImageJobHandler({
      repository: store,
      storageDir: tempStorage,
    });

    // Has valid JPEG magic bytes (passes upload validation) but corrupted payload
    const corruptJpeg = new Uint8Array([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0xff, 0x00,
    ]);
    const form = new FormData();
    form.append('image', new File([corruptJpeg], 'broken.jpg', { type: 'image/jpeg' }));

    const uploadRes = await app.request('/api/jobs', { method: 'POST', body: form });
    expect(uploadRes.status).toBe(202);
    const { data } = (await uploadRes.json()) as { data: { job_id: string } };
    const payload = enqueuedPayloads.find((p) => p.jobId === data.job_id)!;

    await expect(
      handleJob({ data: payload, attemptsMade: 0, opts: { attempts: 3 } }),
    ).rejects.toThrow();

    const statusRes = await app.request(`/api/jobs/${data.job_id}`);
    const statusJson = (await statusRes.json()) as {
      data: { status: string; error_message: string | null };
    };
    expect(statusJson.data.status).toBe('failed');
    expect(statusJson.data.error_message).toBeTruthy();

    const failedDlRes = await app.request(`/api/jobs/${data.job_id}/download`);
    expect(failedDlRes.status).toBe(422);
  });

  it('reconciles orphaned processing jobs on worker startup without touching active queue jobs', async () => {
    const staleJob = await store.createPendingJob({
      id: '11111111-1111-4111-8111-111111111111',
      originalFilename: 'crashed.png',
      originalMimeType: 'image/png',
      originalSizeBytes: 1234,
      originalPath: 'uploads/11111111-1111-4111-8111-111111111111.png',
    });
    await store.markProcessing(staleJob.id, 1);

    const tempArtifact = path.join(tempStorage, 'processed', `${staleJob.id}.tmp.webp`);
    await writeFile(tempArtifact, new Uint8Array([1, 2, 3]));

    const report = await reconcileStaleProcessingJobs({
      repository: store,
      queue: { getJob: async () => undefined },
      storageDir: tempStorage,
      staleThresholdMinutes: 2,
    });

    expect(report.markedFailedCount).toBe(1);
    expect(existsSync(tempArtifact)).toBe(false);
    expect((await store.findJobById(staleJob.id))?.status).toBe('failed');
  });

  it('validates bad requests and reports health status accurately', async () => {
    const app = buildApp();

    const missingFieldRes = await app.request('/api/jobs', {
      method: 'POST',
      body: new FormData(),
    });
    expect(missingFieldRes.status).toBe(400);

    const badUuidRes = await app.request('/api/jobs/invalid-uuid');
    expect(badUuidRes.status).toBe(400);

    const notFoundRes = await app.request(
      '/api/jobs/99999999-9999-4999-8999-999999999999',
    );
    expect(notFoundRes.status).toBe(404);

    redisHealthy = true;
    store.dbHealthy = true;
    const healthyRes = await app.request('/api/health');
    expect(healthyRes.status).toBe(200);

    redisHealthy = false;
    const degradedRes = await app.request('/api/health');
    expect(degradedRes.status).toBe(503);
    redisHealthy = true;
  });
});

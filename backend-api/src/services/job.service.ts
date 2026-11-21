import crypto from 'node:crypto';
import type { ImageQueueProducer } from '../queue/image-queue.js';
import type { JobRepository } from '../repositories/job.repository.js';
import type {
  ImageJobRecord,
  JobStatusResponseDto,
  UploadJobResponseDto,
} from '../types/job.types.js';
import {
  buildDownloadFilename,
  validateUploadedImage,
} from './file-validator.js';
import type { StorageService } from './storage.service.js';

export type ServiceErrorStatus = 400 | 404 | 409 | 413 | 415 | 422 | 500 | 503;

export type ServiceResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: ServiceErrorStatus; code: string; message: string };

export interface PreparedDownload {
  fullPath: string;
  sizeBytes: number;
  downloadFilename: string;
  mimeType: 'image/webp';
}

export interface JobServiceDependencies {
  jobRepository: JobRepository;
  queueProducer: ImageQueueProducer;
  storageService: StorageService;
  maxFileSizeBytes: number;
}

function mapRecordToStatusDto(record: ImageJobRecord): JobStatusResponseDto {
  return {
    job_id: record.id,
    status: record.status,
    original_filename: record.original_filename,
    original_mime_type: record.original_mime_type,
    original_size_bytes: record.original_size_bytes,
    processed_size_bytes: record.processed_size_bytes,
    width: record.width,
    height: record.height,
    download_url:
      record.status === 'completed' ? `/api/jobs/${record.id}/download` : null,
    error_message: record.error_message,
    attempts: record.attempts,
    created_at: record.created_at.toISOString(),
    started_at: record.started_at ? record.started_at.toISOString() : null,
    completed_at: record.completed_at ? record.completed_at.toISOString() : null,
  };
}

export class JobService {
  private readonly jobRepository: JobRepository;
  private readonly queueProducer: ImageQueueProducer;
  private readonly storageService: StorageService;
  private readonly maxFileSizeBytes: number;

  constructor(deps: JobServiceDependencies) {
    this.jobRepository = deps.jobRepository;
    this.queueProducer = deps.queueProducer;
    this.storageService = deps.storageService;
    this.maxFileSizeBytes = deps.maxFileSizeBytes;
  }

  /**
   * Non-blocking upload delegation (BR-01, BR-02, BR-03, BR-06):
   * Validates image, writes raw upload to shared storage, inserts a `pending`
   * record into NeonDB PostgreSQL, enqueues a BullMQ job, and returns immediately.
   */
  async delegateImageUpload(
    file: File,
  ): Promise<ServiceResult<UploadJobResponseDto>> {
    if (file.size === 0) {
      return {
        ok: false,
        status: 400,
        code: 'EMPTY_FILE',
        message: 'Uploaded image file is empty (0 bytes).',
      };
    }

    if (file.size > this.maxFileSizeBytes) {
      const maxMb = Math.round(this.maxFileSizeBytes / (1024 * 1024));
      return {
        ok: false,
        status: 413,
        code: 'FILE_TOO_LARGE',
        message: `Image file exceeds the maximum allowed size of ${maxMb}MB.`,
      };
    }

    const buffer = new Uint8Array(await file.arrayBuffer());
    const validation = validateUploadedImage({
      buffer,
      filename: file.name,
      declaredMimeType: file.type,
      maxFileSizeBytes: this.maxFileSizeBytes,
    });

    if (!validation.ok) {
      return {
        ok: false,
        status: validation.status,
        code: validation.code,
        message: validation.message,
      };
    }

    const jobId = crypto.randomUUID();
    const originalPath = await this.storageService.saveRawUpload(
      jobId,
      validation.extension,
      buffer,
    );

    let createdRecord: ImageJobRecord;
    try {
      createdRecord = await this.jobRepository.createPendingJob({
        id: jobId,
        originalFilename: validation.sanitizedFilename,
        originalMimeType: validation.detectedMimeType,
        originalSizeBytes: validation.sizeBytes,
        originalPath,
      });
    } catch (error) {
      await this.storageService.deleteFileSafe(originalPath);
      throw error;
    }

    try {
      await this.queueProducer.enqueueImageJob({
        jobId: createdRecord.id,
        originalPath: createdRecord.original_path,
        originalFilename: createdRecord.original_filename,
        originalMimeType: createdRecord.original_mime_type,
      });
    } catch (error) {
      const reason =
        error instanceof Error
          ? `Failed to enqueue image job: ${error.message}`
          : 'Failed to enqueue image job to background worker queue.';
      await this.jobRepository.markFailedOnEnqueueError(createdRecord.id, reason);
      return {
        ok: false,
        status: 503,
        code: 'QUEUE_UNAVAILABLE',
        message:
          'Unable to delegate job to background worker queue. Please retry shortly.',
      };
    }

    return {
      ok: true,
      data: {
        job_id: createdRecord.id,
        status: createdRecord.status,
        original_filename: createdRecord.original_filename,
        original_mime_type: createdRecord.original_mime_type,
        original_size_bytes: createdRecord.original_size_bytes,
        created_at: createdRecord.created_at.toISOString(),
      },
    };
  }

  async getJobStatus(
    jobId: string,
  ): Promise<ServiceResult<JobStatusResponseDto>> {
    const record = await this.jobRepository.findJobById(jobId);
    if (!record) {
      return {
        ok: false,
        status: 404,
        code: 'JOB_NOT_FOUND',
        message: `Image job '${jobId}' was not found.`,
      };
    }

    return {
      ok: true,
      data: mapRecordToStatusDto(record),
    };
  }

  /**
   * Verifies job completion and disk artifact availability before download (BR-07).
   */
  async prepareJobDownload(
    jobId: string,
  ): Promise<ServiceResult<PreparedDownload>> {
    const record = await this.jobRepository.findJobById(jobId);
    if (!record) {
      return {
        ok: false,
        status: 404,
        code: 'JOB_NOT_FOUND',
        message: `Image job '${jobId}' was not found.`,
      };
    }

    if (record.status === 'pending' || record.status === 'processing') {
      return {
        ok: false,
        status: 409,
        code: 'JOB_NOT_COMPLETED',
        message: `Image job '${jobId}' is currently '${record.status}'. Please wait until processing completes.`,
      };
    }

    if (record.status === 'failed') {
      return {
        ok: false,
        status: 422,
        code: 'JOB_FAILED',
        message:
          record.error_message ??
          `Image job '${jobId}' failed and cannot be downloaded.`,
      };
    }

    if (!record.processed_path) {
      return {
        ok: false,
        status: 404,
        code: 'PROCESSED_FILE_MISSING',
        message: `Processed output path is missing for job '${jobId}'.`,
      };
    }

    const fileMeta = await this.storageService.statProcessedFile(
      record.processed_path,
    );
    if (!fileMeta) {
      return {
        ok: false,
        status: 404,
        code: 'PROCESSED_FILE_MISSING',
        message: `Processed image file for job '${jobId}' is not available on storage.`,
      };
    }

    return {
      ok: true,
      data: {
        fullPath: fileMeta.fullPath,
        sizeBytes: fileMeta.sizeBytes,
        downloadFilename: buildDownloadFilename(record.original_filename),
        mimeType: 'image/webp',
      },
    };
  }
}

import { Pool } from 'pg';
import type {
  AllowedMimeType,
  ImageJobRecord,
  JobStatus,
} from '../types/job.types.js';

export interface CreatePendingJobInput {
  id: string;
  originalFilename: string;
  originalMimeType: AllowedMimeType;
  originalSizeBytes: number;
  originalPath: string;
}

export interface JobRepository {
  createPendingJob(input: CreatePendingJobInput): Promise<ImageJobRecord>;
  findJobById(jobId: string): Promise<ImageJobRecord | null>;
  markFailedOnEnqueueError(jobId: string, errorMessage: string): Promise<void>;
  ping(): Promise<boolean>;
  close(): Promise<void>;
}

interface RawImageJobRow {
  id: string;
  original_filename: string;
  original_mime_type: AllowedMimeType;
  original_size_bytes: string | number;
  original_path: string;
  processed_path: string | null;
  processed_size_bytes: string | number | null;
  width: number | null;
  height: number | null;
  status: JobStatus;
  error_message: string | null;
  attempts: number;
  created_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
  updated_at: Date;
}

function mapRowToRecord(row: RawImageJobRow): ImageJobRecord {
  return {
    id: row.id,
    original_filename: row.original_filename,
    original_mime_type: row.original_mime_type,
    original_size_bytes: Number(row.original_size_bytes),
    original_path: row.original_path,
    processed_path: row.processed_path,
    processed_size_bytes:
      row.processed_size_bytes !== null ? Number(row.processed_size_bytes) : null,
    width: row.width,
    height: row.height,
    status: row.status,
    error_message: row.error_message,
    attempts: row.attempts,
    created_at: row.created_at,
    started_at: row.started_at,
    completed_at: row.completed_at,
    updated_at: row.updated_at,
  };
}

export class PostgresJobRepository implements JobRepository {
  private readonly pool: Pool;

  constructor(databaseUrl: string) {
    const isLocalHost =
      databaseUrl.includes('localhost') || databaseUrl.includes('127.0.0.1');

    this.pool = new Pool({
      connectionString: databaseUrl,
      ssl: isLocalHost ? false : { rejectUnauthorized: false },
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
  }

  async createPendingJob(input: CreatePendingJobInput): Promise<ImageJobRecord> {
    const sql = `
      INSERT INTO image_jobs (
        id,
        original_filename,
        original_mime_type,
        original_size_bytes,
        original_path,
        status
      )
      VALUES ($1, $2, $3, $4, $5, 'pending')
      RETURNING *
    `;

    const result = await this.pool.query<RawImageJobRow>(sql, [
      input.id,
      input.originalFilename,
      input.originalMimeType,
      input.originalSizeBytes,
      input.originalPath,
    ]);

    const row = result.rows[0];
    if (!row) {
      throw new Error('Failed to create pending image job record in database.');
    }

    return mapRowToRecord(row);
  }

  async findJobById(jobId: string): Promise<ImageJobRecord | null> {
    const sql = `SELECT * FROM image_jobs WHERE id = $1 LIMIT 1`;
    const result = await this.pool.query<RawImageJobRow>(sql, [jobId]);
    const row = result.rows[0];
    return row ? mapRowToRecord(row) : null;
  }

  async markFailedOnEnqueueError(
    jobId: string,
    errorMessage: string,
  ): Promise<void> {
    const sql = `
      UPDATE image_jobs
      SET status = 'failed',
          error_message = $2,
          completed_at = NOW()
      WHERE id = $1
        AND status = 'pending'
    `;
    await this.pool.query(sql, [jobId, errorMessage]);
  }

  async ping(): Promise<boolean> {
    try {
      await this.pool.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

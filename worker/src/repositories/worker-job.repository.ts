import { Pool } from 'pg';
import type { MarkCompletedInput } from '../types/worker.types.js';

export interface WorkerJobRepository {
  markProcessing(jobId: string, attempt: number): Promise<boolean>;
  markCompleted(input: MarkCompletedInput): Promise<boolean>;
  markFailed(jobId: string, errorMessage: string): Promise<boolean>;
  findStaleProcessingJobs(olderThanMinutes: number): Promise<string[]>;
  ping(): Promise<boolean>;
  close(): Promise<void>;
}

export class PostgresWorkerJobRepository implements WorkerJobRepository {
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

  async markProcessing(jobId: string, attempt: number): Promise<boolean> {
    const sql = `
      UPDATE image_jobs
      SET status = 'processing',
          started_at = COALESCE(started_at, NOW()),
          attempts = GREATEST(attempts, $2)
      WHERE id = $1
        AND status IN ('pending', 'processing')
      RETURNING id
    `;

    const result = await this.pool.query<{ id: string }>(sql, [jobId, attempt]);
    return result.rowCount !== null && result.rowCount > 0;
  }

  async markCompleted(input: MarkCompletedInput): Promise<boolean> {
    const sql = `
      UPDATE image_jobs
      SET status = 'completed',
          processed_path = $2,
          processed_size_bytes = $3,
          width = $4,
          height = $5,
          error_message = NULL,
          completed_at = NOW()
      WHERE id = $1
        AND status = 'processing'
      RETURNING id
    `;

    const result = await this.pool.query<{ id: string }>(sql, [
      input.jobId,
      input.processedPath,
      input.processedSizeBytes,
      input.width,
      input.height,
    ]);
    return result.rowCount !== null && result.rowCount > 0;
  }

  async markFailed(jobId: string, errorMessage: string): Promise<boolean> {
    const safeMessage = errorMessage.trim().slice(0, 1000) || 'Image processing failed.';
    const sql = `
      UPDATE image_jobs
      SET status = 'failed',
          error_message = $2,
          completed_at = NOW()
      WHERE id = $1
        AND status IN ('pending', 'processing')
      RETURNING id
    `;

    const result = await this.pool.query<{ id: string }>(sql, [jobId, safeMessage]);
    return result.rowCount !== null && result.rowCount > 0;
  }

  async findStaleProcessingJobs(olderThanMinutes: number): Promise<string[]> {
    const sql = `
      SELECT id
      FROM image_jobs
      WHERE status = 'processing'
        AND updated_at < NOW() - ($1::text || ' minutes')::interval
      ORDER BY updated_at ASC
    `;

    const result = await this.pool.query<{ id: string }>(sql, [
      String(olderThanMinutes),
    ]);
    return result.rows.map((row) => row.id);
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

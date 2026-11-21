export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed';

export type AllowedMimeType = 'image/jpeg' | 'image/png' | 'image/webp';

export interface JobStatusData {
  job_id: string;
  status: JobStatus;
  original_filename: string;
  original_mime_type: AllowedMimeType;
  original_size_bytes: number;
  processed_size_bytes: number | null;
  width: number | null;
  height: number | null;
  download_url: string | null;
  error_message: string | null;
  attempts: number;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

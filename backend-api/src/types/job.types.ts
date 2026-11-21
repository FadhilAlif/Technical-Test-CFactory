export const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

export const JOB_STATUSES = [
  'pending',
  'processing',
  'completed',
  'failed',
] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

export interface ImageJobRecord {
  id: string;
  original_filename: string;
  original_mime_type: AllowedMimeType;
  original_size_bytes: number;
  original_path: string;
  processed_path: string | null;
  processed_size_bytes: number | null;
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

export interface ProcessImageJobPayload {
  jobId: string;
  originalPath: string;
  originalFilename: string;
  originalMimeType: AllowedMimeType;
}

export interface UploadJobResponseDto {
  job_id: string;
  status: JobStatus;
  original_filename: string;
  original_mime_type: AllowedMimeType;
  original_size_bytes: number;
  created_at: string;
}

export interface JobStatusResponseDto {
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

export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
}

export interface ApiErrorDetail {
  code: string;
  message: string;
}

export interface ApiErrorResponse {
  success: false;
  error: ApiErrorDetail;
}

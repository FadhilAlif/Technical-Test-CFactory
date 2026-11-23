import type { AllowedMimeType, JobStatus, JobStatusData } from '@/types/job';

export const API_BASE_URL = (
  process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000'
).replace(/\/+$/, '');

export interface UploadJobResponseData {
  job_id: string;
  status: JobStatus;
  original_filename: string;
  original_mime_type: AllowedMimeType;
  original_size_bytes: number;
  created_at: string;
}

export interface HealthResponseData {
  success: boolean;
  status: 'ok' | 'degraded';
  services: {
    database: 'up' | 'down';
    redis: 'up' | 'down';
  };
}

interface ApiSuccessEnvelope<T> {
  success: true;
  data: T;
}

interface ApiErrorEnvelope {
  success: false;
  error: {
    code: string;
    message: string;
  };
}

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
  }
}

async function parseErrorResponse(response: Response): Promise<ApiClientError> {
  try {
    const parsed = (await response.json()) as Partial<ApiErrorEnvelope>;
    if (parsed.error?.message) {
      return new ApiClientError(
        parsed.error.message,
        response.status,
        parsed.error.code ?? 'API_ERROR',
      );
    }
  } catch {
    // Non-JSON error body
  }

  return new ApiClientError(
    `Request failed with status ${response.status}.`,
    response.status,
    'HTTP_ERROR',
  );
}

export async function uploadImage(
  file: File,
  signal?: AbortSignal,
): Promise<UploadJobResponseData> {
  const formData = new FormData();
  formData.append('image', file);

  const response = await fetch(`${API_BASE_URL}/api/jobs`, {
    method: 'POST',
    body: formData,
    signal,
  });

  if (!response.ok) {
    throw await parseErrorResponse(response);
  }

  const envelope = (await response.json()) as ApiSuccessEnvelope<UploadJobResponseData>;
  return envelope.data;
}

export async function fetchJobStatus(
  jobId: string,
  signal?: AbortSignal,
): Promise<JobStatusData> {
  const response = await fetch(
    `${API_BASE_URL}/api/jobs/${encodeURIComponent(jobId)}`,
    {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal,
    },
  );

  if (!response.ok) {
    throw await parseErrorResponse(response);
  }

  const envelope = (await response.json()) as ApiSuccessEnvelope<JobStatusData>;
  return envelope.data;
}

export function getDownloadUrl(jobId: string): string {
  return `${API_BASE_URL}/api/jobs/${encodeURIComponent(jobId)}/download`;
}

export function getInlinePreviewUrl(jobId: string): string {
  return `${API_BASE_URL}/api/jobs/${encodeURIComponent(jobId)}/download?inline=1`;
}

export async function fetchHealthStatus(
  signal?: AbortSignal,
): Promise<HealthResponseData> {
  const response = await fetch(`${API_BASE_URL}/api/health`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    cache: 'no-store',
    signal,
  });

  const data = (await response.json()) as HealthResponseData;
  return data;
}

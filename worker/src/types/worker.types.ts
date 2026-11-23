export type AllowedMimeType = 'image/jpeg' | 'image/png' | 'image/webp';

export interface ProcessImageJobPayload {
  jobId: string;
  originalPath: string;
  originalFilename: string;
  originalMimeType: AllowedMimeType;
}

export interface ProcessedImageResult {
  processedRelativePath: string;
  processedFullPath: string;
  processedSizeBytes: number;
  width: number;
  height: number;
  format: 'webp';
}

export interface MarkCompletedInput {
  jobId: string;
  processedPath: string;
  processedSizeBytes: number;
  width: number;
  height: number;
}

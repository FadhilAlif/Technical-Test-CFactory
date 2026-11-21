import path from 'node:path';
import { ALLOWED_MIME_TYPES, type AllowedMimeType } from '../types/job.types.js';

export const DEFAULT_MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024; // 20,971,520 bytes

export type ImageExtension = 'jpg' | 'png' | 'webp';

export type FileValidationErrorCode =
  | 'EMPTY_FILE'
  | 'FILE_TOO_LARGE'
  | 'UNSUPPORTED_MEDIA_TYPE';

export type FileValidationResult =
  | {
      ok: true;
      detectedMimeType: AllowedMimeType;
      extension: ImageExtension;
      sanitizedFilename: string;
      sizeBytes: number;
    }
  | {
      ok: false;
      status: 400 | 413 | 415;
      code: FileValidationErrorCode;
      message: string;
    };

/**
 * Inspects file header magic bytes to determine the true image format (BR-01).
 * Prevents MIME/extension spoofing (e.g. a .txt or .pdf renamed to .jpg).
 */
export function detectMimeTypeFromMagicBytes(buffer: Uint8Array): AllowedMimeType | null {
  // JPEG: FF D8 FF
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return 'image/jpeg';
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'image/png';
  }

  // WebP: RIFF....WEBP (bytes 0..3 = "RIFF", bytes 8..11 = "WEBP")
  if (
    buffer.length >= 12 &&
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return 'image/webp';
  }

  return null;
}

export function getExtensionForMimeType(mimeType: AllowedMimeType): ImageExtension {
  switch (mimeType) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
  }
}

export function sanitizeOriginalFilename(filename: string): string {
  const baseName = path.basename(filename).trim();
  const cleaned = baseName
    .replace(/[\x00-\x1f\x7f<>:"/\\|?*]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim();

  if (cleaned.length === 0 || cleaned === '.' || cleaned === '..') {
    return 'uploaded-image';
  }

  return cleaned.slice(0, 255);
}

export function buildDownloadFilename(originalFilename: string): string {
  const sanitized = sanitizeOriginalFilename(originalFilename);
  const parsed = path.parse(sanitized);
  const safeBase = (parsed.name || 'image')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 120);

  return `processed-${safeBase || 'image'}.webp`;
}

export interface ValidateUploadedImageInput {
  buffer: Uint8Array;
  filename: string;
  declaredMimeType?: string;
  maxFileSizeBytes?: number;
}

export function validateUploadedImage(
  input: ValidateUploadedImageInput,
): FileValidationResult {
  const maxBytes = input.maxFileSizeBytes ?? DEFAULT_MAX_FILE_SIZE_BYTES;
  const sizeBytes = input.buffer.byteLength;

  if (sizeBytes === 0) {
    return {
      ok: false,
      status: 400,
      code: 'EMPTY_FILE',
      message: 'Uploaded image file is empty (0 bytes).',
    };
  }

  if (sizeBytes > maxBytes) {
    const maxMb = Math.round(maxBytes / (1024 * 1024));
    return {
      ok: false,
      status: 413,
      code: 'FILE_TOO_LARGE',
      message: `Image file exceeds the maximum allowed size of ${maxMb}MB.`,
    };
  }

  const normalizedDeclared = input.declaredMimeType?.toLowerCase().trim();
  if (
    normalizedDeclared &&
    normalizedDeclared !== 'application/octet-stream' &&
    !(ALLOWED_MIME_TYPES as readonly string[]).includes(normalizedDeclared)
  ) {
    return {
      ok: false,
      status: 415,
      code: 'UNSUPPORTED_MEDIA_TYPE',
      message:
        'Unsupported image format. Only JPG, PNG, and WebP images up to 20MB are allowed.',
    };
  }

  const detectedMimeType = detectMimeTypeFromMagicBytes(input.buffer);
  if (!detectedMimeType) {
    return {
      ok: false,
      status: 415,
      code: 'UNSUPPORTED_MEDIA_TYPE',
      message:
        'Invalid or unsupported image content. File signature does not match JPG, PNG, or WebP.',
    };
  }

  return {
    ok: true,
    detectedMimeType,
    extension: getExtensionForMimeType(detectedMimeType),
    sanitizedFilename: sanitizeOriginalFilename(input.filename),
    sizeBytes,
  };
}

import type { AllowedMimeType } from '@/types/job';

export const ALLOWED_MIME_TYPES: readonly AllowedMimeType[] = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export const MAX_FILE_SIZE_MB = Number(
  process.env.NEXT_PUBLIC_MAX_FILE_SIZE_MB ?? 20,
);
export const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return '0 B';
  }
  if (bytes < 1024) {
    return `${Math.round(bytes)} B`;
  }
  const kb = bytes / 1024;
  if (kb < 1024) {
    return `${kb.toFixed(1)} KB`;
  }
  const mb = kb / 1024;
  return `${mb.toFixed(2)} MB`;
}

export function formatBytesParts(bytes: number): { value: number; suffix: string } {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return { value: 0, suffix: ' B' };
  }
  if (bytes < 1024) {
    return { value: Math.round(bytes), suffix: ' B' };
  }
  const kb = bytes / 1024;
  if (kb < 1024) {
    return { value: Number(kb.toFixed(1)), suffix: ' KB' };
  }
  const mb = kb / 1024;
  return { value: Number(mb.toFixed(2)), suffix: ' MB' };
}

export function calculateSavingsPercent(
  originalBytes: number,
  processedBytes: number,
): number {
  if (originalBytes <= 0 || processedBytes <= 0) {
    return 0;
  }
  const ratio = ((originalBytes - processedBytes) / originalBytes) * 100;
  return Number(ratio.toFixed(1));
}

export function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) {
    return '0 ms';
  }
  if (ms < 1000) {
    return `${Math.round(ms)} ms`;
  }
  return `${(ms / 1000).toFixed(2)} s`;
}

export type ClientFileValidationResult =
  | { ok: true }
  | { ok: false; message: string };

export function validateImageFileClient(
  file: Pick<File, 'name' | 'size' | 'type'>,
  maxBytes: number = MAX_FILE_SIZE_BYTES,
): ClientFileValidationResult {
  if (file.size === 0) {
    return {
      ok: false,
      message: 'This file is empty (0 bytes). Choose a valid JPG, PNG, or WebP image.',
    };
  }

  if (file.size > maxBytes) {
    const maxMbLabel = Math.round(maxBytes / (1024 * 1024));
    return {
      ok: false,
      message: `${file.name} (${formatBytes(file.size)}) exceeds the ${maxMbLabel} MB limit.`,
    };
  }

  const normalizedType = file.type.toLowerCase().trim();
  const hasAllowedMime = (ALLOWED_MIME_TYPES as readonly string[]).includes(
    normalizedType,
  );
  const hasAllowedExt = /\.(jpe?g|png|webp)$/i.test(file.name);

  if (!hasAllowedMime && !hasAllowedExt) {
    return {
      ok: false,
      message: `Unsupported file type for ${file.name}. Only JPG, PNG, and WebP images are accepted.`,
    };
  }

  return { ok: true };
}

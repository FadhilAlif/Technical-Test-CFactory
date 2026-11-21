import { access, mkdir, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { MAX_LONGEST_SIDE_PX, WEBP_QUALITY } from '../config/constants.js';
import type { ProcessedImageResult } from '../types/worker.types.js';

// Disable libvips file descriptor cache: prevents EBUSY handle locks on Windows
// and keeps worker memory usage low when processing unique one-off image uploads.
sharp.cache(false);

export class PermanentImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentImageError';
  }
}

const PERMANENT_ERROR_PATTERNS = [
  'unsupported image format',
  'input file is missing',
  'input buffer contains unsupported',
  'corrupt',
  'premature end',
  'invalid',
  'bad seek',
  'truncated',
  'not a known file format',
  'vipsjpeg',
  'vipspng',
  'vipswebp',
  'pixel limit',
  'source image is corrupt',
];

export function isPermanentSharpError(error: unknown): boolean {
  if (error instanceof PermanentImageError) {
    return true;
  }
  if (!(error instanceof Error)) {
    return false;
  }

  const nodeErr = error as NodeJS.ErrnoException;
  if (nodeErr.code === 'ENOENT') {
    return true;
  }

  const msg = error.message.toLowerCase();
  return PERMANENT_ERROR_PATTERNS.some((pattern) => msg.includes(pattern));
}

export function resolveSafeStoragePath(
  storageDir: string,
  relativePath: string,
): string {
  const rootDir = path.resolve(storageDir);
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
  const fullPath = path.resolve(rootDir, normalized);
  const relCheck = path.relative(rootDir, fullPath);

  if (relCheck.startsWith('..') || path.isAbsolute(relCheck)) {
    throw new PermanentImageError(`Unsafe storage path detected: ${relativePath}`);
  }

  return fullPath;
}

export async function cleanupTempFileSafe(filePath: string): Promise<void> {
  try {
    await unlink(filePath);
  } catch {
    // Ignore missing temp files during cleanup
  }
}

export interface ProcessImageInput {
  jobId: string;
  storageDir: string;
  originalRelativePath: string;
}

/**
 * Executes the strict image transformation pipeline (BR-05 & BR-08):
 * 1. Auto-orient EXIF + Resize to max 1280px on the longest side, preserving aspect ratio (no upscaling)
 * 2. Compress to 80% quality
 * 3. Convert to WebP format
 * 4. Write to `{job_id}.tmp.webp` then atomically rename to `{job_id}.webp`
 */
export async function processImageFile(
  input: ProcessImageInput,
): Promise<ProcessedImageResult> {
  const rootDir = path.resolve(input.storageDir);
  const processedDir = path.join(rootDir, 'processed');
  await mkdir(processedDir, { recursive: true });

  const sourceFullPath = resolveSafeStoragePath(
    rootDir,
    input.originalRelativePath,
  );

  try {
    await access(sourceFullPath);
  } catch {
    throw new PermanentImageError(
      'Source uploaded image file could not be found on storage.',
    );
  }

  const tempFullPath = path.join(processedDir, `${input.jobId}.tmp.webp`);
  const finalRelativePath = `processed/${input.jobId}.webp`;
  const finalFullPath = resolveSafeStoragePath(rootDir, finalRelativePath);

  try {
    const info = await sharp(sourceFullPath, { failOn: 'error' })
      .rotate()
      .resize({
        width: MAX_LONGEST_SIDE_PX,
        height: MAX_LONGEST_SIDE_PX,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: WEBP_QUALITY })
      .toFile(tempFullPath);

    if (
      info.size <= 0 ||
      info.width <= 0 ||
      info.height <= 0 ||
      info.width > MAX_LONGEST_SIDE_PX ||
      info.height > MAX_LONGEST_SIDE_PX
    ) {
      throw new PermanentImageError(
        `Processed output failed dimension or size validation (${info.width}x${info.height}, ${info.size} bytes).`,
      );
    }

    // Atomic file promotion prevents partial/corrupt WebP reads on crash (BR-08)
    await rename(tempFullPath, finalFullPath);

    return {
      processedRelativePath: finalRelativePath,
      processedFullPath: finalFullPath,
      processedSizeBytes: info.size,
      width: info.width,
      height: info.height,
      format: 'webp',
    };
  } catch (error) {
    await cleanupTempFileSafe(tempFullPath);

    if (error instanceof PermanentImageError) {
      throw error;
    }

    if (isPermanentSharpError(error)) {
      const detail = error instanceof Error ? error.message : 'Invalid image data';
      throw new PermanentImageError(
        `Image processing failed: input file is corrupted or unsupported (${detail}).`,
      );
    }

    throw error;
  }
}

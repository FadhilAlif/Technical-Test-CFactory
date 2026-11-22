import { describe, expect, it } from 'vitest';
import {
  buildDownloadFilename,
  DEFAULT_MAX_FILE_SIZE_BYTES,
  detectMimeTypeFromMagicBytes,
  sanitizeOriginalFilename,
  validateUploadedImage,
} from '../../backend-api/src/services/file-validator.js';

const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00,
]);
const WEBP_BYTES = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
]);

describe('file-validator (BR-01 & BR-02)', () => {
  it('detects JPEG, PNG, and WebP from binary magic bytes', () => {
    expect(detectMimeTypeFromMagicBytes(JPEG_BYTES)).toBe('image/jpeg');
    expect(detectMimeTypeFromMagicBytes(PNG_BYTES)).toBe('image/png');
    expect(detectMimeTypeFromMagicBytes(WEBP_BYTES)).toBe('image/webp');
    expect(
      detectMimeTypeFromMagicBytes(new TextEncoder().encode('%PDF-1.7')),
    ).toBeNull();
  });

  it('accepts valid JPG, PNG, and WebP files within 20 MB', () => {
    const res = validateUploadedImage({
      buffer: PNG_BYTES,
      filename: 'vacation-photo.png',
      declaredMimeType: 'image/png',
    });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.detectedMimeType).toBe('image/png');
      expect(res.extension).toBe('png');
      expect(res.sanitizedFilename).toBe('vacation-photo.png');
    }
  });

  it('rejects empty 0-byte uploads with HTTP 400 EMPTY_FILE', () => {
    const res = validateUploadedImage({
      buffer: new Uint8Array(0),
      filename: 'empty.jpg',
      declaredMimeType: 'image/jpeg',
    });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(400);
      expect(res.code).toBe('EMPTY_FILE');
    }
  });

  it('rejects files exceeding 20 MB with HTTP 413 FILE_TOO_LARGE', () => {
    const oversized = new Uint8Array(DEFAULT_MAX_FILE_SIZE_BYTES + 1);
    oversized.set(JPEG_BYTES, 0);

    const res = validateUploadedImage({
      buffer: oversized,
      filename: 'huge-photo.jpg',
      declaredMimeType: 'image/jpeg',
    });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(413);
      expect(res.code).toBe('FILE_TOO_LARGE');
    }
  });

  it('rejects spoofed extensions whose magic bytes do not match an allowed image', () => {
    const res = validateUploadedImage({
      buffer: new TextEncoder().encode('hello world plain text pretending to be jpeg'),
      filename: 'spoofed.jpg',
      declaredMimeType: 'image/jpeg',
    });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(415);
      expect(res.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    }
  });

  it('rejects unsupported declared MIME types such as GIF or PDF', () => {
    const res = validateUploadedImage({
      buffer: PNG_BYTES,
      filename: 'animation.gif',
      declaredMimeType: 'image/gif',
    });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(415);
      expect(res.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    }
  });

  it('sanitizes unsafe filenames and generates clean WebP download filenames', () => {
    expect(sanitizeOriginalFilename('../../secret:photo?.png')).toBe(
      'secret_photo_.png',
    );
    expect(buildDownloadFilename('Summer Trip (2026).JPG')).toBe(
      'processed-Summer-Trip-2026.webp',
    );
  });
});

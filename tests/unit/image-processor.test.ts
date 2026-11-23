import crypto from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  PermanentImageError,
  processImageFile,
} from '../../worker/src/processor/image-processor.js';

describe('worker Sharp image pipeline (BR-05 & BR-08)', () => {
  let tempStorage = '';

  beforeAll(async () => {
    tempStorage = await mkdtemp(path.join(os.tmpdir(), 'caip-unit-sharp-'));
    await mkdir(path.join(tempStorage, 'uploads'), { recursive: true });
    await mkdir(path.join(tempStorage, 'processed'), { recursive: true });
  });

  afterAll(async () => {
    if (tempStorage) {
      await rm(tempStorage, { recursive: true, force: true });
    }
  });

  it('resizes landscape >1280px preserving aspect ratio, compresses 80%, converts to WebP atomically', async () => {
    const jobId = crypto.randomUUID();
    const rawRel = `uploads/${jobId}.png`;
    const buf = await sharp({
      create: {
        width: 2560,
        height: 1920,
        channels: 3,
        background: { r: 24, g: 112, b: 204 },
      },
    })
      .png()
      .toBuffer();

    await writeFile(path.join(tempStorage, rawRel), buf);

    const result = await processImageFile({
      jobId,
      storageDir: tempStorage,
      originalRelativePath: rawRel,
    });

    expect(result.format).toBe('webp');
    expect(result.width).toBe(1280);
    expect(result.height).toBe(960);
    expect(result.processedSizeBytes).toBeGreaterThan(0);
    expect(existsSync(path.join(tempStorage, 'processed', `${jobId}.tmp.webp`))).toBe(false);
    expect(existsSync(result.processedFullPath)).toBe(true);

    const metadata = await sharp(result.processedFullPath).metadata();
    expect(metadata.format).toBe('webp');
    expect(metadata.width).toBe(1280);
    expect(metadata.height).toBe(960);
  });

  it('resizes portrait >1280px so height is 1280px and width scales proportionally', async () => {
    const jobId = crypto.randomUUID();
    const rawRel = `uploads/${jobId}.jpg`;
    const buf = await sharp({
      create: {
        width: 1600,
        height: 3200,
        channels: 3,
        background: { r: 200, g: 90, b: 60 },
      },
    })
      .jpeg()
      .toBuffer();

    await writeFile(path.join(tempStorage, rawRel), buf);

    const result = await processImageFile({
      jobId,
      storageDir: tempStorage,
      originalRelativePath: rawRel,
    });

    expect(result.width).toBe(640);
    expect(result.height).toBe(1280);
    expect(result.format).toBe('webp');
  });

  it('does not upscale images smaller than 1280px on both sides', async () => {
    const jobId = crypto.randomUUID();
    const rawRel = `uploads/${jobId}.png`;
    const buf = await sharp({
      create: {
        width: 800,
        height: 600,
        channels: 3,
        background: { r: 60, g: 160, b: 90 },
      },
    })
      .png()
      .toBuffer();

    await writeFile(path.join(tempStorage, rawRel), buf);

    const result = await processImageFile({
      jobId,
      storageDir: tempStorage,
      originalRelativePath: rawRel,
    });

    expect(result.width).toBe(800);
    expect(result.height).toBe(600);
    expect(result.format).toBe('webp');
  });

  it('throws PermanentImageError and cleans up temp file when input is corrupted', async () => {
    const jobId = crypto.randomUUID();
    const rawRel = `uploads/${jobId}.jpg`;
    const corrupt = new Uint8Array([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0xde, 0xad,
    ]);
    await writeFile(path.join(tempStorage, rawRel), corrupt);

    await expect(
      processImageFile({
        jobId,
        storageDir: tempStorage,
        originalRelativePath: rawRel,
      }),
    ).rejects.toBeInstanceOf(PermanentImageError);

    expect(existsSync(path.join(tempStorage, 'processed', `${jobId}.tmp.webp`))).toBe(false);
    expect(existsSync(path.join(tempStorage, 'processed', `${jobId}.webp`))).toBe(false);
  });

  it('rejects missing files and path traversal attempts with PermanentImageError', async () => {
    await expect(
      processImageFile({
        jobId: crypto.randomUUID(),
        storageDir: tempStorage,
        originalRelativePath: 'uploads/does-not-exist.png',
      }),
    ).rejects.toBeInstanceOf(PermanentImageError);

    await expect(
      processImageFile({
        jobId: crypto.randomUUID(),
        storageDir: tempStorage,
        originalRelativePath: '../outside.png',
      }),
    ).rejects.toBeInstanceOf(PermanentImageError);
  });
});

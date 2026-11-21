import { createReadStream } from 'node:fs';
import { mkdir, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';

export interface ProcessedFileMetadata {
  fullPath: string;
  sizeBytes: number;
}

export interface StorageService {
  ensureDirectories(): Promise<void>;
  saveRawUpload(jobId: string, extension: string, data: Uint8Array): Promise<string>;
  deleteFileSafe(relativePath: string): Promise<void>;
  statProcessedFile(relativePath: string): Promise<ProcessedFileMetadata | null>;
  openWebReadStream(fullPath: string): ReadableStream<Uint8Array>;
}

export class LocalStorageService implements StorageService {
  private readonly rootDir: string;
  private readonly uploadsDir: string;
  private readonly processedDir: string;

  constructor(storageDir: string) {
    this.rootDir = path.resolve(storageDir);
    this.uploadsDir = path.join(this.rootDir, 'uploads');
    this.processedDir = path.join(this.rootDir, 'processed');
  }

  async ensureDirectories(): Promise<void> {
    await mkdir(this.uploadsDir, { recursive: true });
    await mkdir(this.processedDir, { recursive: true });
  }

  private resolveSafePath(relativePath: string): string {
    const normalized = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
    const fullPath = path.resolve(this.rootDir, normalized);
    const relativeCheck = path.relative(this.rootDir, fullPath);

    if (relativeCheck.startsWith('..') || path.isAbsolute(relativeCheck)) {
      throw new Error(`Path traversal detected for path: ${relativePath}`);
    }

    return fullPath;
  }

  async saveRawUpload(
    jobId: string,
    extension: string,
    data: Uint8Array,
  ): Promise<string> {
    await this.ensureDirectories();
    const relativePath = `uploads/${jobId}.${extension}`;
    const fullPath = this.resolveSafePath(relativePath);
    await writeFile(fullPath, data);
    return relativePath;
  }

  async deleteFileSafe(relativePath: string): Promise<void> {
    try {
      const fullPath = this.resolveSafePath(relativePath);
      await unlink(fullPath);
    } catch {
      // Ignore missing files during cleanup
    }
  }

  async statProcessedFile(
    relativePath: string,
  ): Promise<ProcessedFileMetadata | null> {
    try {
      const fullPath = this.resolveSafePath(relativePath);
      const fileStat = await stat(fullPath);
      if (!fileStat.isFile()) {
        return null;
      }
      return {
        fullPath,
        sizeBytes: fileStat.size,
      };
    } catch {
      return null;
    }
  }

  openWebReadStream(fullPath: string): ReadableStream<Uint8Array> {
    const nodeStream = createReadStream(fullPath);
    return Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;
  }
}

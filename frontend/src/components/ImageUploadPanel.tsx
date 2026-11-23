'use client';

import { ArrowRight } from 'lucide-react';
import { Alert } from '@/components/arc/alert/alert';
import { Button } from '@/components/arc/button/button';
import { FileDropzone } from '@/components/arc/file-dropzone/file-dropzone';
import {
  formatBytes,
  MAX_FILE_SIZE_BYTES,
  MAX_FILE_SIZE_MB,
} from '@/lib/formatters';
import styles from './image-processor.module.css';

interface ImageUploadPanelProps {
  selectedFile: File | null;
  isUploading: boolean;
  errorMessage: string | null;
  dropzoneKey: number;
  onFilesChange: (files: File[]) => void;
  onUpload: () => void;
  onDismissError: () => void;
}

export function ImageUploadPanel({
  selectedFile,
  isUploading,
  errorMessage,
  dropzoneKey,
  onFilesChange,
  onUpload,
  onDismissError,
}: ImageUploadPanelProps) {
  return (
    <section className={styles.surface} aria-labelledby="upload-section-heading">
      <div className={styles.surfaceHeader}>
        <div>
          <h2 id="upload-section-heading" className={styles.sectionHeading}>
            Upload source image
          </h2>
          <p className={styles.sectionNote}>
            Accepts JPG, PNG, or WebP up to {MAX_FILE_SIZE_MB} MB. Uploads return a job ID immediately.
          </p>
        </div>
      </div>

      <FileDropzone
        key={dropzoneKey}
        accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
        multiple={false}
        maxFiles={1}
        maxSize={MAX_FILE_SIZE_BYTES}
        label="Add an image"
        dropLabel="Release to select image"
        description="Drop a JPG, PNG, or WebP file here, or choose from your device"
        note={`Maximum ${MAX_FILE_SIZE_MB} MB. Resized to 1280px max, compressed to 80%, converted to WebP.`}
        onFilesChange={onFilesChange}
      />

      <Alert
        open={Boolean(errorMessage)}
        tone="danger"
        title="Upload rejected"
        onDismiss={onDismissError}
      >
        {errorMessage}
      </Alert>

      <div className={styles.actionRow}>
        <div className={styles.fileSummary}>
          {selectedFile ? (
            <>
              <span className={styles.fileName} title={selectedFile.name}>
                {selectedFile.name}
              </span>
              <span className={styles.tabular}>({formatBytes(selectedFile.size)})</span>
            </>
          ) : (
            <span>Select one image to start background processing.</span>
          )}
        </div>

        <div className={styles.actionButtons}>
          <Button
            type="button"
            variant="primary"
            size="lg"
            loading={isUploading}
            disabled={!selectedFile}
            onClick={onUpload}
          >
            {isUploading ? 'Delegating job' : 'Process image'}
            {!isUploading ? (
              <ArrowRight size={16} strokeWidth={1.75} aria-hidden="true" />
            ) : null}
          </Button>
        </div>
      </div>
    </section>
  );
}

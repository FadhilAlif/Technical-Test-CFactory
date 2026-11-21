'use client';

import { useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { Alert } from '@/components/arc/alert/alert';
import { Button } from '@/components/arc/button/button';
import { useJobPolling } from '@/hooks/use-job-polling';
import { ApiClientError, uploadImage } from '@/lib/api-client';
import { validateImageFileClient } from '@/lib/formatters';
import type { JobStatusData } from '@/types/job';
import { ImageUploadPanel } from './ImageUploadPanel';
import { JobStatusPanel } from './JobStatusPanel';
import { ResultPanel } from './ResultPanel';
import styles from './image-processor.module.css';

export function ImageProcessorWorkspace() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [originalPreviewUrl, setOriginalPreviewUrl] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [initialJob, setInitialJob] = useState<JobStatusData | null>(null);
  const [dropzoneKey, setDropzoneKey] = useState<number>(0);

  const { job, isPolling, pollCount, nextDelayMs, pollingError } = useJobPolling(
    activeJobId,
    initialJob,
  );

  useEffect(() => {
    if (!selectedFile) {
      setOriginalPreviewUrl(null);
      return;
    }

    const objectUrl = URL.createObjectURL(selectedFile);
    setOriginalPreviewUrl(objectUrl);

    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [selectedFile]);

  const handleFilesChange = (files: File[]): void => {
    setUploadError(null);
    const nextFile = files[0] ?? null;

    if (!nextFile) {
      setSelectedFile(null);
      return;
    }

    const validation = validateImageFileClient(nextFile);
    if (!validation.ok) {
      setSelectedFile(null);
      setUploadError(validation.message);
      return;
    }

    setSelectedFile(nextFile);
  };

  const handleUpload = async (): Promise<void> => {
    if (!selectedFile || isUploading) {
      return;
    }

    const validation = validateImageFileClient(selectedFile);
    if (!validation.ok) {
      setUploadError(validation.message);
      return;
    }

    setUploadError(null);
    setIsUploading(true);

    try {
      const created = await uploadImage(selectedFile);
      const seededJob: JobStatusData = {
        job_id: created.job_id,
        status: created.status,
        original_filename: created.original_filename,
        original_mime_type: created.original_mime_type,
        original_size_bytes: created.original_size_bytes,
        processed_size_bytes: null,
        width: null,
        height: null,
        download_url: null,
        error_message: null,
        attempts: 0,
        created_at: created.created_at,
        started_at: null,
        completed_at: null,
      };

      setInitialJob(seededJob);
      setActiveJobId(created.job_id);
    } catch (error: unknown) {
      if (error instanceof ApiClientError) {
        setUploadError(error.message);
      } else if (error instanceof Error) {
        setUploadError(
          `Could not reach the API server: ${error.message}. Verify the backend server is running.`,
        );
      } else {
        setUploadError('Upload failed due to an unexpected error. Try again.');
      }
    } finally {
      setIsUploading(false);
    }
  };

  const handleReset = (): void => {
    setActiveJobId(null);
    setInitialJob(null);
    setSelectedFile(null);
    setUploadError(null);
    setDropzoneKey((prev) => prev + 1);
  };

  const activeJob = job ?? initialJob;
  const hasFailed = activeJob?.status === 'failed' || Boolean(pollingError);

  return (
    <div className={styles.workspace}>
      {!activeJob ? (
        <ImageUploadPanel
          selectedFile={selectedFile}
          isUploading={isUploading}
          errorMessage={uploadError}
          dropzoneKey={dropzoneKey}
          onFilesChange={handleFilesChange}
          onUpload={() => {
            void handleUpload();
          }}
          onDismissError={() => setUploadError(null)}
        />
      ) : (
        <>
          <JobStatusPanel
            job={activeJob}
            isPolling={isPolling}
            pollCount={pollCount}
            nextDelayMs={nextDelayMs}
          />

          {activeJob.status === 'completed' ? (
            <ResultPanel
              job={activeJob}
              originalPreviewUrl={originalPreviewUrl}
              onReset={handleReset}
            />
          ) : null}

          {hasFailed ? (
            <section className={styles.surface} aria-labelledby="error-recovery-heading">
              <h2 id="error-recovery-heading" className={styles.sectionHeading}>
                Unable to complete processing
              </h2>
              <Alert
                open
                tone="danger"
                title={
                  activeJob.status === 'failed'
                    ? 'Background worker reported an error'
                    : 'Status polling interrupted'
                }
              >
                {activeJob.error_message ??
                  pollingError ??
                  'The image could not be processed. Check that the file is a valid JPG, PNG, or WebP image and upload again.'}
              </Alert>

              <div className={styles.actionRow}>
                <span className={styles.sectionNote}>
                  Fix or choose a different image file to start a new job.
                </span>
                <div className={styles.actionButtons}>
                  <Button
                    type="button"
                    variant="primary"
                    size="md"
                    onClick={handleReset}
                  >
                    <RotateCcw size={16} strokeWidth={1.75} aria-hidden="true" />
                    Upload another image
                  </Button>
                </div>
              </div>
            </section>
          ) : null}
        </>
      )}

      <section className={styles.specStrip} aria-label="Pipeline specification">
        <div className={styles.specItem}>
          <h3 className={styles.specTitle}>1. Resize</h3>
          <p className={styles.specBody}>
            Scales the longest side to at most 1280px while preserving aspect ratio without upscaling.
          </p>
        </div>
        <div className={styles.specItem}>
          <h3 className={styles.specTitle}>2. Compress</h3>
          <p className={styles.specBody}>
            Compresses output to 80% quality inside an isolated Sharp background worker process.
          </p>
        </div>
        <div className={styles.specItem}>
          <h3 className={styles.specTitle}>3. Convert to WebP</h3>
          <p className={styles.specBody}>
            Writes atomically to WebP and notifies the browser via exponential backoff polling.
          </p>
        </div>
      </section>
    </div>
  );
}

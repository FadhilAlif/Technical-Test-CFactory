'use client';

import { AlertCircle, Check } from 'lucide-react';
import { Badge } from '@/components/arc/badge/badge';
import { CopyButton } from '@/components/arc/copy-button/copy-button';
import { Stepper } from '@/components/arc/stepper/stepper';
import { TextShimmer } from '@/components/arc/text-shimmer/text-shimmer';
import { formatBytes, formatDurationMs } from '@/lib/formatters';
import type { JobStatusData } from '@/types/job';
import styles from './image-processor.module.css';

interface JobStatusPanelProps {
  job: JobStatusData;
  isPolling: boolean;
  pollCount: number;
  nextDelayMs: number | null;
}

function getStatusBadgeProps(status: JobStatusData['status']) {
  switch (status) {
    case 'pending':
      return { tone: 'warning' as const, label: 'Pending', dot: true };
    case 'processing':
      return { tone: 'info' as const, label: 'Processing', dot: true };
    case 'completed':
      return {
        tone: 'success' as const,
        label: 'Completed',
        dot: false,
        icon: <Check size={12} strokeWidth={1.75} aria-hidden="true" />,
      };
    case 'failed':
      return {
        tone: 'danger' as const,
        label: 'Failed',
        dot: false,
        icon: <AlertCircle size={12} strokeWidth={1.75} aria-hidden="true" />,
      };
  }
}

function getStepperCurrentIndex(status: JobStatusData['status']): number {
  switch (status) {
    case 'pending':
      return 0;
    case 'processing':
      return 1;
    case 'failed':
      return 1;
    case 'completed':
      return 3;
  }
}

export function JobStatusPanel({
  job,
  isPolling,
  pollCount,
  nextDelayMs,
}: JobStatusPanelProps) {
  const badgeProps = getStatusBadgeProps(job.status);
  const currentStep = getStepperCurrentIndex(job.status);

  const shimmerText =
    job.status === 'pending'
      ? 'Queued in Redis, waiting for background worker'
      : job.status === 'processing'
        ? 'Resizing, compressing to 80%, and converting to WebP'
        : job.status === 'completed'
          ? 'Image optimization complete'
          : 'Background processing failed';

  const processingTimeMs =
    job.started_at && job.completed_at
      ? Math.max(
          0,
          new Date(job.completed_at).getTime() - new Date(job.started_at).getTime(),
        )
      : null;

  const terminalAnnouncement =
    job.status === 'completed'
      ? `Job ${job.job_id} completed. Processed WebP image is ready to download.`
      : job.status === 'failed'
        ? `Job ${job.job_id} failed. ${job.error_message ?? 'Please upload another image.'}`
        : '';

  return (
    <section className={styles.surface} aria-labelledby="job-status-heading">
      <div className={styles.surfaceHeader}>
        <div>
          <h2 id="job-status-heading" className={styles.sectionHeading}>
            Processing status
          </h2>
          <p className={styles.sectionNote}>
            <span className={styles.fileName} title={job.original_filename}>
              {job.original_filename}
            </span>{' '}
            <span className={styles.tabular}>({formatBytes(job.original_size_bytes)})</span>
          </p>
        </div>

        <Badge
          tone={badgeProps.tone}
          dot={badgeProps.dot}
          icon={badgeProps.icon}
          size="md"
        >
          {badgeProps.label}
        </Badge>
      </div>

      <div className={styles.jobMetaBar}>
        <div className={styles.jobIdGroup}>
          <span className={styles.fieldLabel}>Job ID</span>
          <div className={styles.jobIdRow}>
            <code className={styles.jobIdCode}>{job.job_id}</code>
            <CopyButton
              value={job.job_id}
              label="Copy job ID"
              iconOnly
              variant="outline"
            />
          </div>
        </div>
      </div>

      <Stepper
        label="Image processing pipeline"
        completeLabel="Image ready to download"
        current={currentStep}
        steps={[
          {
            id: 'pending',
            label: 'Pending',
            description: 'File stored and job delegated to BullMQ queue',
          },
          {
            id: 'processing',
            label: 'Processing',
            description: 'Resize max 1280px, compress 80%, convert to WebP',
            error:
              job.status === 'failed'
                ? job.error_message ?? 'Worker failed while processing the image.'
                : undefined,
          },
          {
            id: 'completed',
            label: 'Completed',
            description: 'Atomic WebP file ready for download',
          },
        ]}
      />

      <div className={styles.statusRow}>
        <TextShimmer active={isPolling && (job.status === 'pending' || job.status === 'processing')}>
          {shimmerText}
        </TextShimmer>

        <span className={styles.telemetry}>
          {isPolling && nextDelayMs !== null
            ? `Poll ${pollCount + 1} · Next check in ${(nextDelayMs / 1000).toFixed(1)}s (exponential backoff)`
            : processingTimeMs !== null
              ? `Completed in ${formatDurationMs(processingTimeMs)} · Polling stopped`
              : `Polling stopped after ${pollCount} checks`}
        </span>
      </div>

      <span className="visually-hidden" role="status" aria-live="polite">
        {terminalAnnouncement}
      </span>
    </section>
  );
}

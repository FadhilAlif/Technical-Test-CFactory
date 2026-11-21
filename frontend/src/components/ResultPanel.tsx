'use client';

import { Download, RotateCcw } from 'lucide-react';
import { Button } from '@/components/arc/button/button';
import { ImageCompare } from '@/components/arc/image-compare/image-compare';
import { MetricCard } from '@/components/arc/metric-card/metric-card';
import { getDownloadUrl, getInlinePreviewUrl } from '@/lib/api-client';
import { calculateSavingsPercent, formatBytesParts } from '@/lib/formatters';
import type { JobStatusData } from '@/types/job';
import styles from './image-processor.module.css';

interface ResultPanelProps {
  job: JobStatusData;
  originalPreviewUrl: string | null;
  onReset: () => void;
}

function formatSourceFormat(mimeType: JobStatusData['original_mime_type']): string {
  switch (mimeType) {
    case 'image/jpeg':
      return 'JPEG';
    case 'image/png':
      return 'PNG';
    case 'image/webp':
      return 'WebP';
  }
}

export function ResultPanel({
  job,
  originalPreviewUrl,
  onReset,
}: ResultPanelProps) {
  const originalParts = formatBytesParts(job.original_size_bytes);
  const processedBytes = job.processed_size_bytes ?? 0;
  const processedParts = formatBytesParts(processedBytes);
  const savingsPct = calculateSavingsPercent(
    job.original_size_bytes,
    processedBytes,
  );
  const downloadUrl = getDownloadUrl(job.job_id);
  const previewUrl = getInlinePreviewUrl(job.job_id);

  const width = job.width ?? 0;
  const height = job.height ?? 0;
  const longestSide = Math.max(width, height);
  const aspectRatio = width > 0 && height > 0 ? `${width} / ${height}` : '4 / 3';

  const handleDownloadClick = (): void => {
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = '';
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  return (
    <section className={styles.surface} aria-labelledby="result-section-heading">
      <div className={styles.surfaceHeader}>
        <div>
          <h2 id="result-section-heading" className={styles.sectionHeading}>
            Optimized WebP result
          </h2>
          <p className={styles.sectionNote}>
            Compare the original upload with the compressed WebP output or download it directly.
          </p>
        </div>
      </div>

      <div className={styles.metricsGrid}>
        <MetricCard
          label="Original size"
          value={originalParts.value}
          suffix={originalParts.suffix}
          context={`Source ${formatSourceFormat(job.original_mime_type)}`}
        />
        <MetricCard
          label="WebP output size"
          value={processedParts.value}
          suffix={processedParts.suffix}
          context="Compressed at 80% quality"
          change={savingsPct > 0 ? `-${savingsPct}%` : undefined}
        />
        <MetricCard
          label="Longest side"
          value={longestSide}
          suffix=" px"
          context={`${width} x ${height} px (max 1280px)`}
        />
      </div>

      <div className={styles.previewFrame}>
        {originalPreviewUrl ? (
          <ImageCompare
            before={
              <img
                src={originalPreviewUrl}
                alt={`Original image ${job.original_filename}`}
                className={styles.previewImage}
              />
            }
            after={
              <img
                src={previewUrl}
                alt={`Processed WebP image ${job.original_filename}`}
                className={styles.previewImage}
              />
            }
            labels={['Original', 'WebP 80%']}
            label="Compare original and processed WebP image"
            aspectRatio={aspectRatio}
          />
        ) : (
          <img
            src={previewUrl}
            alt={`Processed WebP result for ${job.original_filename}`}
            className={styles.singlePreview}
          />
        )}
      </div>

      <div className={styles.actionRow}>
        <div className={styles.fileSummary}>
          <a
            href={downloadUrl}
            download
            className={styles.sectionNote}
          >
            Direct download link
          </a>
        </div>

        <div className={styles.actionButtons}>
          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={onReset}
          >
            <RotateCcw size={16} strokeWidth={1.75} aria-hidden="true" />
            Process another image
          </Button>
          <Button
            type="button"
            variant="primary"
            size="lg"
            onClick={handleDownloadClick}
          >
            <Download size={16} strokeWidth={1.75} aria-hidden="true" />
            Download WebP image
          </Button>
        </div>
      </div>
    </section>
  );
}

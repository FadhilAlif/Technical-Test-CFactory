'use client';

import { useEffect, useRef, useState } from 'react';
import { ApiClientError, fetchJobStatus } from '@/lib/api-client';
import { calculateBackoffDelayMs } from '@/lib/backoff';
import type { JobStatusData } from '@/types/job';

const MAX_CONSECUTIVE_NETWORK_ERRORS = 5;

export interface UseJobPollingResult {
  job: JobStatusData | null;
  isPolling: boolean;
  pollCount: number;
  nextDelayMs: number | null;
  pollingError: string | null;
}

export function isTerminalJobStatus(status: JobStatusData['status']): boolean {
  return status === 'completed' || status === 'failed';
}

/**
 * Polls GET /api/jobs/:jobId using Exponential Backoff with Jitter and AbortController (BR-10).
 * Stops immediately when status reaches `completed` or `failed`, or on unmount / job change.
 */
export function useJobPolling(
  jobId: string | null,
  initialJob: JobStatusData | null,
): UseJobPollingResult {
  const [job, setJob] = useState<JobStatusData | null>(initialJob);
  const [isPolling, setIsPolling] = useState<boolean>(false);
  const [pollCount, setPollCount] = useState<number>(0);
  const [nextDelayMs, setNextDelayMs] = useState<number | null>(null);
  const [pollingError, setPollingError] = useState<string | null>(null);

  const initialJobRef = useRef<JobStatusData | null>(initialJob);
  initialJobRef.current = initialJob;

  useEffect(() => {
    setJob(initialJobRef.current);
    setPollCount(0);
    setNextDelayMs(null);
    setPollingError(null);

    if (!jobId) {
      setIsPolling(false);
      return;
    }

    if (initialJobRef.current && isTerminalJobStatus(initialJobRef.current.status)) {
      setIsPolling(false);
      return;
    }

    let cancelled = false;
    let attempt = 0;
    let consecutiveErrors = 0;
    let timerId: ReturnType<typeof setTimeout> | null = null;
    let activeController: AbortController | null = null;

    setIsPolling(true);

    const scheduleNext = (delayMs: number): void => {
      if (cancelled) {
        return;
      }
      setNextDelayMs(delayMs);
      timerId = setTimeout(() => {
        void runPoll();
      }, delayMs);
    };

    const runPoll = async (): Promise<void> => {
      if (cancelled) {
        return;
      }

      activeController = new AbortController();
      try {
        const latest = await fetchJobStatus(jobId, activeController.signal);
        if (cancelled) {
          return;
        }

        consecutiveErrors = 0;
        setPollingError(null);
        setJob(latest);
        setPollCount((prev) => prev + 1);

        if (isTerminalJobStatus(latest.status)) {
          setIsPolling(false);
          setNextDelayMs(null);
          return;
        }

        attempt += 1;
        scheduleNext(calculateBackoffDelayMs(attempt));
      } catch (error: unknown) {
        if (cancelled) {
          return;
        }

        if (error instanceof DOMException && error.name === 'AbortError') {
          return;
        }

        if (error instanceof ApiClientError && error.status === 404) {
          setPollingError(error.message);
          setIsPolling(false);
          setNextDelayMs(null);
          return;
        }

        consecutiveErrors += 1;
        if (consecutiveErrors >= MAX_CONSECUTIVE_NETWORK_ERRORS) {
          setPollingError(
            error instanceof Error
              ? `Lost connection while checking job status: ${error.message}`
              : 'Lost connection to the API server while checking job status.',
          );
          setIsPolling(false);
          setNextDelayMs(null);
          return;
        }

        attempt += 1;
        scheduleNext(calculateBackoffDelayMs(attempt));
      }
    };

    // Schedule initial poll with base backoff (~500ms)
    scheduleNext(calculateBackoffDelayMs(0));

    return () => {
      cancelled = true;
      if (timerId !== null) {
        clearTimeout(timerId);
      }
      if (activeController) {
        activeController.abort();
      }
    };
  }, [jobId]);

  return {
    job,
    isPolling,
    pollCount,
    nextDelayMs,
    pollingError,
  };
}

export interface BackoffOptions {
  baseDelayMs?: number;
  maxDelayMs?: number;
  factor?: number;
  jitterRatio?: number;
  minDelayMs?: number;
  randomFn?: () => number;
}

export const DEFAULT_BACKOFF_OPTIONS = {
  baseDelayMs: 500,
  maxDelayMs: 5000,
  factor: 1.75,
  jitterRatio: 0.15,
  minDelayMs: 300,
} as const;

/**
 * Calculates exponential backoff delay with symmetric jitter (BR-10).
 * Average schedule: 500ms -> 875ms -> 1531ms -> 2680ms -> 4690ms -> cap 5000ms (±15% jitter).
 */
export function calculateBackoffDelayMs(
  attempt: number,
  options: BackoffOptions = {},
): number {
  const safeAttempt = Math.max(0, Math.floor(attempt));
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BACKOFF_OPTIONS.baseDelayMs;
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_BACKOFF_OPTIONS.maxDelayMs;
  const factor = options.factor ?? DEFAULT_BACKOFF_OPTIONS.factor;
  const jitterRatio = options.jitterRatio ?? DEFAULT_BACKOFF_OPTIONS.jitterRatio;
  const minDelayMs = options.minDelayMs ?? DEFAULT_BACKOFF_OPTIONS.minDelayMs;
  const randomFn = options.randomFn ?? Math.random;

  const exponential = Math.min(
    maxDelayMs,
    Math.round(baseDelayMs * Math.pow(factor, safeAttempt)),
  );
  const jitterRange = exponential * jitterRatio;
  const jitterOffset = (randomFn() * 2 - 1) * jitterRange;

  return Math.max(minDelayMs, Math.min(maxDelayMs + Math.round(jitterRange), Math.round(exponential + jitterOffset)));
}

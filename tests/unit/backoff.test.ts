import { describe, expect, it } from 'vitest';
import { calculateBackoffDelayMs } from '../../frontend/src/lib/backoff.js';
import {
  calculateSavingsPercent,
  formatBytes,
  MAX_FILE_SIZE_BYTES,
  validateImageFileClient,
} from '../../frontend/src/lib/formatters.js';

describe('frontend exponential backoff polling (BR-10)', () => {
  it('grows exponentially from 500ms up to 5000ms cap with zero jitter when randomFn=0.5', () => {
    const deterministic = { randomFn: () => 0.5 };

    expect(calculateBackoffDelayMs(0, deterministic)).toBe(500);
    expect(calculateBackoffDelayMs(1, deterministic)).toBe(875);
    expect(calculateBackoffDelayMs(2, deterministic)).toBe(1531);
    expect(calculateBackoffDelayMs(3, deterministic)).toBe(2680);
    expect(calculateBackoffDelayMs(4, deterministic)).toBe(4689);
    expect(calculateBackoffDelayMs(5, deterministic)).toBe(5000);
    expect(calculateBackoffDelayMs(10, deterministic)).toBe(5000);
  });

  it('applies symmetric ±15% jitter while honoring minDelayMs', () => {
    const low = calculateBackoffDelayMs(0, { randomFn: () => 0 });
    const high = calculateBackoffDelayMs(0, { randomFn: () => 1 });

    expect(low).toBe(425);
    expect(high).toBe(575);
    expect(calculateBackoffDelayMs(-3, { randomFn: () => 0.5 })).toBe(500);
  });
});

describe('frontend client-side validation & formatting helpers', () => {
  it('validates allowed image types and 20 MB boundary on client', () => {
    expect(
      validateImageFileClient({
        name: 'photo.webp',
        size: 1024 * 512,
        type: 'image/webp',
      }).ok,
    ).toBe(true);

    expect(
      validateImageFileClient({
        name: 'empty.png',
        size: 0,
        type: 'image/png',
      }).ok,
    ).toBe(false);

    expect(
      validateImageFileClient({
        name: 'too-big.jpg',
        size: MAX_FILE_SIZE_BYTES + 1,
        type: 'image/jpeg',
      }).ok,
    ).toBe(false);

    expect(
      validateImageFileClient({
        name: 'document.pdf',
        size: 1024,
        type: 'application/pdf',
      }).ok,
    ).toBe(false);
  });

  it('formats byte sizes and compression savings accurately', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.00 MB');
    expect(calculateSavingsPercent(1000, 200)).toBe(80);
  });
});

import { MAX_LONGEST_SIDE_PX, WEBP_QUALITY } from './config/constants.js';

export const WORKER_PIPELINE_SPEC = {
  maxLongestSidePx: MAX_LONGEST_SIDE_PX,
  webpQuality: WEBP_QUALITY,
  format: 'webp',
} as const;

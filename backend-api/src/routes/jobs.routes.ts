import { Hono } from 'hono';
import { z } from 'zod';
import type { JobService } from '../services/job.service.js';
import type { StorageService } from '../services/storage.service.js';
import type {
  ApiErrorResponse,
  ApiSuccessResponse,
  JobStatusResponseDto,
  UploadJobResponseDto,
} from '../types/job.types.js';

const uuidParamSchema = z.string().uuid('jobId must be a valid UUID v4');

export function createJobsRouter(
  jobService: JobService,
  storageService: StorageService,
): Hono {
  const router = new Hono();

  /**
   * POST /api/jobs
   * Accepts multipart/form-data with field `image` (JPG/PNG/WebP, max 20MB).
   * Immediately returns 202 Accepted with `job_id` without processing the image.
   */
  router.post('/', async (c) => {
    let body: Record<string, string | File | (string | File)[]>;
    try {
      body = await c.req.parseBody();
    } catch {
      const errorBody: ApiErrorResponse = {
        success: false,
        error: {
          code: 'INVALID_MULTIPART_BODY',
          message:
            'Request body must be valid multipart/form-data containing an "image" file field.',
        },
      };
      return c.json(errorBody, 400);
    }

    const rawField = body['image'];
    const imageFile = Array.isArray(rawField) ? rawField[0] : rawField;

    if (!(imageFile instanceof File)) {
      const errorBody: ApiErrorResponse = {
        success: false,
        error: {
          code: 'MISSING_IMAGE_FILE',
          message: 'Missing required multipart file field "image".',
        },
      };
      return c.json(errorBody, 400);
    }

    const result = await jobService.delegateImageUpload(imageFile);
    if (!result.ok) {
      const errorBody: ApiErrorResponse = {
        success: false,
        error: {
          code: result.code,
          message: result.message,
        },
      };
      return c.json(errorBody, result.status);
    }

    const successBody: ApiSuccessResponse<UploadJobResponseDto> = {
      success: true,
      data: result.data,
    };
    return c.json(successBody, 202);
  });

  /**
   * GET /api/jobs/:jobId
   * Returns current lifecycle status and metadata for the given job.
   */
  router.get('/:jobId', async (c) => {
    const parsedId = uuidParamSchema.safeParse(c.req.param('jobId'));
    if (!parsedId.success) {
      const errorBody: ApiErrorResponse = {
        success: false,
        error: {
          code: 'INVALID_JOB_ID',
          message: 'Invalid job_id format. Expected a valid UUID.',
        },
      };
      return c.json(errorBody, 400);
    }

    const result = await jobService.getJobStatus(parsedId.data);
    if (!result.ok) {
      const errorBody: ApiErrorResponse = {
        success: false,
        error: {
          code: result.code,
          message: result.message,
        },
      };
      return c.json(errorBody, result.status);
    }

    const successBody: ApiSuccessResponse<JobStatusResponseDto> = {
      success: true,
      data: result.data,
    };
    return c.json(successBody, 200);
  });

  /**
   * GET /api/jobs/:jobId/download
   * Streams the processed WebP output once job status === 'completed'.
   */
  router.get('/:jobId/download', async (c) => {
    const parsedId = uuidParamSchema.safeParse(c.req.param('jobId'));
    if (!parsedId.success) {
      const errorBody: ApiErrorResponse = {
        success: false,
        error: {
          code: 'INVALID_JOB_ID',
          message: 'Invalid job_id format. Expected a valid UUID.',
        },
      };
      return c.json(errorBody, 400);
    }

    const result = await jobService.prepareJobDownload(parsedId.data);
    if (!result.ok) {
      const errorBody: ApiErrorResponse = {
        success: false,
        error: {
          code: result.code,
          message: result.message,
        },
      };
      return c.json(errorBody, result.status);
    }

    const { fullPath, sizeBytes, downloadFilename, mimeType } = result.data;
    const isInline = c.req.query('inline') === '1';
    const dispositionType = isInline ? 'inline' : 'attachment';
    const webStream = storageService.openWebReadStream(fullPath);

    return new Response(webStream, {
      status: 200,
      headers: {
        'Content-Type': mimeType,
        'Content-Length': String(sizeBytes),
        'Content-Disposition': `${dispositionType}; filename="${downloadFilename}"`,
        'Cache-Control': 'private, max-age=3600',
      },
    });
  });

  return router;
}

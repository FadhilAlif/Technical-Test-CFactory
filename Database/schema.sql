-- =============================================================================
-- CFactory Async Image Processor (CAIP)
-- Database Initialization Script for NeonDB PostgreSQL
-- Path: /Database/schema.sql
-- =============================================================================

CREATE TABLE IF NOT EXISTS image_jobs (
    id                    UUID PRIMARY KEY,
    original_filename     VARCHAR(255) NOT NULL,
    original_mime_type    VARCHAR(50)  NOT NULL
                          CHECK (original_mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
    original_size_bytes   BIGINT       NOT NULL
                          CHECK (original_size_bytes > 0 AND original_size_bytes <= 20971520),
    original_path         TEXT         NOT NULL,
    processed_path        TEXT         NULL,
    processed_size_bytes  BIGINT       NULL
                          CHECK (processed_size_bytes IS NULL OR processed_size_bytes > 0),
    width                 INTEGER      NULL
                          CHECK (width IS NULL OR (width > 0 AND width <= 1280)),
    height                INTEGER      NULL
                          CHECK (height IS NULL OR (height > 0 AND height <= 1280)),
    status                VARCHAR(20)  NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    error_message         TEXT         NULL,
    attempts              INTEGER      NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    started_at            TIMESTAMPTZ  NULL,
    completed_at          TIMESTAMPTZ  NULL,
    updated_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Index for fast status filtering & worker startup state reconciliation
CREATE INDEX IF NOT EXISTS idx_image_jobs_status_created_at
    ON image_jobs (status, created_at DESC);

-- Trigger function to automatically keep updated_at current on every row update
CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_image_jobs_updated_at ON image_jobs;
CREATE TRIGGER set_image_jobs_updated_at
    BEFORE UPDATE ON image_jobs
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();

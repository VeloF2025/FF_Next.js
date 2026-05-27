-- Migration 353: Allow snags.report_id to be NULL for system-managed verification snags
-- Verification snags (category='verification') are created from Works QA without a
-- parent imported PDF report, so they have no report_id. The existing PDF-import
-- flow continues to require report_id at the application layer
-- (pages/api/snags/index.ts:handlePost).

ALTER TABLE snags ALTER COLUMN report_id DROP NOT NULL;

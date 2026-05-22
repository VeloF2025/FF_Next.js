-- Migration 351: works-qa per-photo snag workflow
--
-- Originally authored as 247_works_qa_photo_snags.sql in PR #1633 but
-- accidentally committed to scripts/migrations/ instead of
-- scripts/migrations/sql/ — the runner only scans the sql/ subdir, so
-- the file never applied. Renumbered to 351 (247 is taken by
-- 247_rbac_update_all_modules.sql) and moved to the correct location.
-- All statements use IF NOT EXISTS / DROP CONSTRAINT IF EXISTS so the
-- migration is idempotent even on environments where someone might
-- have manually applied the original file.
--
-- Hooks the existing snags / snag_reports / snag_photos plumbing (migration 242)
-- so per-photo snags raised from /field-ops/works-qa land in the same tables
-- as TQR audit snags and reuse the same NOC-ticket + WhatsApp pipeline.
--
-- Decided with Hein (2026-05-14):
--   - Option A: extend existing tables; do NOT create a parallel works_qa_photo_snags table.
--   - Add `source` column to snag_reports + snags so the two flows can be told apart.
--   - Add per-photo linkage (pole_qa_photo_id, slot_key) to snags.
--   - Add slot_approvals JSONB to pole_qa_photos for per-slot approve/snag state.

BEGIN;

-- ============================================================
-- 1. snag_reports: 'source' column + relax NOT NULL on audit_date
-- ============================================================
-- TQR reports come from a weekly PDF audit; works-qa reports are auto-created
-- on first snag for a pole and have no formal audit date.
ALTER TABLE snag_reports
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'tqr';

-- snag_reports_source_check is owned by migration 358 (P3 scoped reports,
-- PR #1674), which broadened the allowed values to ('tqr','works_qa','scope').
-- The original 351 added the narrower ('tqr','works_qa') check, but on any
-- DB where 358 already landed there are source='scope' rows that violate it.
-- Leaving the constraint untouched here lets 358 remain the single owner.

ALTER TABLE snag_reports
  ALTER COLUMN audit_date DROP NOT NULL;

ALTER TABLE snag_reports
  ADD COLUMN IF NOT EXISTS pole_qa_photo_id UUID REFERENCES pole_qa_photos(id);

CREATE INDEX IF NOT EXISTS idx_snag_reports_source
  ON snag_reports(source);

CREATE INDEX IF NOT EXISTS idx_snag_reports_pole_qa_photo
  ON snag_reports(pole_qa_photo_id)
  WHERE pole_qa_photo_id IS NOT NULL;

-- One auto-generated works-qa report per pole.
CREATE UNIQUE INDEX IF NOT EXISTS uq_snag_reports_works_qa_per_pole
  ON snag_reports(pole_qa_photo_id)
  WHERE source = 'works_qa';

COMMENT ON COLUMN snag_reports.source IS
  'tqr = weekly TQR audit PDF (migration 242); works_qa = auto-created per pole on first per-photo snag (migration 351).';
COMMENT ON COLUMN snag_reports.pole_qa_photo_id IS
  'For source=works_qa reports: the pole_qa_photos row this report aggregates. NULL for TQR.';

-- ============================================================
-- 2. snags: 'source' column + per-photo linkage
-- ============================================================
-- Mirror snag_reports.source so list/filter queries on `snags` alone don't
-- need to join snag_reports.
ALTER TABLE snags
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'tqr';

ALTER TABLE snags
  DROP CONSTRAINT IF EXISTS snags_source_check;
ALTER TABLE snags
  ADD CONSTRAINT snags_source_check
  CHECK (source IN ('tqr', 'works_qa'));

ALTER TABLE snags
  ADD COLUMN IF NOT EXISTS pole_qa_photo_id UUID REFERENCES pole_qa_photos(id);
ALTER TABLE snags
  ADD COLUMN IF NOT EXISTS slot_key TEXT;
ALTER TABLE snags
  ADD COLUMN IF NOT EXISTS slot_photo_key TEXT;
ALTER TABLE snags
  ADD COLUMN IF NOT EXISTS discipline TEXT;

ALTER TABLE snags
  DROP CONSTRAINT IF EXISTS snags_discipline_check;
ALTER TABLE snags
  ADD CONSTRAINT snags_discipline_check
  CHECK (discipline IS NULL OR discipline IN ('civil', 'dome', 'main_joint'));

CREATE INDEX IF NOT EXISTS idx_snags_source
  ON snags(source);

CREATE INDEX IF NOT EXISTS idx_snags_pole_qa_photo
  ON snags(pole_qa_photo_id)
  WHERE pole_qa_photo_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_snags_slot_key
  ON snags(slot_key)
  WHERE slot_key IS NOT NULL;

-- Idempotency support: at most one OPEN snag per pole+slot.
-- Per Hein's UX rule: a second snag attempt on a slot with an open snag is blocked
-- and the UI offers to amend the existing snag/ticket instead. Snags in
-- 'verified' or 'closed' state don't block re-snagging if the issue regresses.
CREATE UNIQUE INDEX IF NOT EXISTS uq_snags_open_per_slot
  ON snags(pole_qa_photo_id, slot_key)
  WHERE source = 'works_qa'
    AND pole_qa_photo_id IS NOT NULL
    AND slot_key IS NOT NULL
    AND status NOT IN ('verified', 'closed');

COMMENT ON COLUMN snags.source IS
  'Matches snag_reports.source. Lets us filter snags lists by works_qa vs tqr without joining.';
COMMENT ON COLUMN snags.pole_qa_photo_id IS
  'Set when snag came from works-qa per-photo flow; NULL for TQR snags.';
COMMENT ON COLUMN snags.slot_key IS
  'works-qa SLOT_META key, e.g. civil_03 / dome_02 / main_joint_11. NULL for TQR.';
COMMENT ON COLUMN snags.slot_photo_key IS
  'Object-storage key of the photo at the time of snagging. Survives subsequent replacements of that slot.';
COMMENT ON COLUMN snags.discipline IS
  'Derived from SLOT_META.discipline. NULL for TQR snags (which span multiple disciplines).';

-- ============================================================
-- 3. pole_qa_photos.slot_approvals: per-slot approve/snag state
-- ============================================================
-- Shape:
--   {
--     "civil_01": { "decision": "approved",         "by": "<uuid>", "at": "2026-05-14T..." },
--     "civil_03": { "decision": "snagged", "snag_id": "<uuid>",     "by": "<uuid>", "at": "..." },
--     ...
--   }
-- Per-slot table avoided: 21 slots × ~10k poles = 210k trivial rows; data is
-- always read with the pole. JSONB matches existing `vlm_results` pattern on
-- the same table. Integrity policed in photoSnagService + tests.
ALTER TABLE pole_qa_photos
  ADD COLUMN IF NOT EXISTS slot_approvals JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN pole_qa_photos.slot_approvals IS
  'Per-slot approve/snag decisions, keyed by SLOT_META.key. See migration 351 for the JSONB shape.';

COMMIT;

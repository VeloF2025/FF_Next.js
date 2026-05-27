-- Migration 331: attendance_search_presets (PRD-061 Phase B — saved filters)
--
-- Per-user filter sets for the Pulse Search page (`/staff/attendance/search`).
-- One row per saved preset; one optional default per user (FR-PRESET-06)
-- enforced by a partial unique index. Presets are NOT shared between users
-- (FR-PRESET-05, locked decision in PRD §3.1).
--
-- filter_json mirrors the Search querystring contract — staff IDs, dept
-- IDs, site IDs, project IDs, dateRange preset name + custom from/to,
-- exception kinds, day-of-week mask, only-OT, only-Sunday-holiday,
-- only-active. Carries a `v` integer so a future Phase A→B shape change
-- can migrate forward without dropping old presets (PRD §13 risk row).
--
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS attendance_search_presets (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- Trim+length policed in the API (FR-PRESET-02 caps at 60); CHECK is
    -- the second line of defence against a misbehaving client.
    name        TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),

    -- Free-form filter shape; the application validates it. Kept as JSONB
    -- so we can grow filters without an ALTER TABLE.
    filter_json JSONB NOT NULL,

    is_default  BOOLEAN NOT NULL DEFAULT false,

    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Listing the user's presets (newest-first by edit time)
CREATE INDEX IF NOT EXISTS idx_attendance_search_presets_user_updated
  ON attendance_search_presets (user_id, updated_at DESC);

-- One default per user, no row when nothing is starred. Partial unique
-- index makes "set new default" a UPDATE with a transactional clear-old
-- step rather than a constraint dance.
CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_search_presets_one_default_per_user
  ON attendance_search_presets (user_id)
  WHERE is_default = true;

-- ---------------------------------------------------------------------------
-- GRANTs for the runtime app user (Supabase: app runs as fibreflow_user,
-- migrations run as superuser per migration 310 footgun note).
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES
  ON attendance_search_presets TO fibreflow_user;

COMMENT ON TABLE attendance_search_presets IS
  'Per-user saved filter sets for /staff/attendance/search (Pulse Phase B). '
  'Presets are private — never visible to other users (FR-PRESET-05). '
  'filter_json is shape-versioned via {v:1, ...} so future filter additions '
  'do not invalidate old presets.';

-- Verify (uncomment after apply)
-- SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_name = 'attendance_search_presets' ORDER BY ordinal_position;
-- SELECT indexname FROM pg_indexes
--   WHERE tablename = 'attendance_search_presets' ORDER BY indexname;

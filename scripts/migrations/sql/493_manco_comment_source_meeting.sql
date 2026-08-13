-- 493: record which meeting an auto-extracted manco comment came from, so the
-- comment thread can be gated on attendance the way the meeting itself is.
--
-- pages/api/manco-action-items/extract-meeting-comments.ts copies verbatim
-- transcript lines into manco_action_item_comments. pages/api/manco-action-items/
-- comments.ts then serves that table with `SELECT *` under withAuth and no scoping,
-- so every authenticated user could read them. Gating the extraction alone does not
-- close it: the extracted rows are the leak, and they outlive the request that
-- created them.
--
-- Human-written comments must stay visible to everyone who can see the item —
-- gating the whole thread would break ordinary collaboration on manco items. So the
-- two kinds have to be distinguishable, and until now they were not: the only
-- marker was a `[From meeting: <title>]` prefix inside the free-text content, which
-- is both forgeable and dependent on a title that can change.
--
-- source_meeting_id makes the distinction structural. NULL means a person wrote it;
-- a value means it is meeting content and the reader must have attended that
-- meeting.

ALTER TABLE manco_action_item_comments
  ADD COLUMN IF NOT EXISTS source_meeting_id INTEGER;

COMMENT ON COLUMN manco_action_item_comments.source_meeting_id IS
  'Set when the comment was extracted from a meeting transcript. NULL = written by a person. Readers of a non-NULL row must be a participant of that meeting; see src/lib/actionItems/meetingAccess.ts.';

-- The gate reads this per row on every comment fetch.
CREATE INDEX IF NOT EXISTS idx_manco_comments_source_meeting
  ON manco_action_item_comments (source_meeting_id)
  WHERE source_meeting_id IS NOT NULL;

-- Remove the rows that already leaked.
--
-- These predate the column, so they would carry source_meeting_id IS NULL and the
-- new gate would read them as human-written and keep serving them to everyone —
-- the fix would look applied while changing nothing for the only rows that are
-- actually exposed. Backfilling instead of deleting was considered and rejected:
-- the meeting id is not recoverable from the row (only a title string is), and the
-- content has been readable organisation-wide, so it is disclosed either way.
--
-- At the time of writing this matches 5 rows, all verbatim quotes from a
-- three-participant meeting, attributed to named speakers. Scoped narrowly: only
-- rows that both carry the extractor's prefix and predate the column.
DELETE FROM manco_action_item_comments
 WHERE source_meeting_id IS NULL
   AND content LIKE '[From meeting: %';

-- No INSERT INTO migrations here, deliberately. scripts/run-pending-migrations.sh
-- tracks applied files by FILENAME in schema_migrations; the legacy `migrations`
-- table is not the tracker (its max version is 416 while the files reach 492) and
-- has no unique constraint on `version`, so an ON CONFLICT (version) upsert against
-- it fails outright. Migration 492 writes nothing there either.

-- Rollback: 467_mcp_sessions.sql
--
-- Dropping `kind` destroys the only marker distinguishing MCP sessions from browser
-- ones, so any surviving MCP session becomes indistinguishable from a login. Delete
-- them first rather than leaving credentials behind that nothing can identify or sweep.
--
-- ORDERING IS LOAD-BEARING: the DELETE must run BEFORE the columns are dropped. Moving
-- it after `DROP COLUMN kind` would make it a no-op-or-error and leave live MCP
-- credentials in the table with nothing left to identify them by — the precise outcome
-- this file exists to prevent.
--
-- CALLER DEPENDENCY: from PR C onward, `getSession`/`getUserSessions` in
-- src/lib/auth/session.ts SELECT kind, label and last_used_at explicitly, and
-- pages/api/auth/logout.ts calls getSession on every logout. Dev and production share
-- one database, so running this rollback while that code is deployed breaks logout with
-- a hard SQL error rather than degrading. Revert the application code first, or expect
-- to do both together.
BEGIN;

-- Guarded so the file is safe to re-run: after a completed rollback `kind` is gone, and
-- an unguarded DELETE would abort the retry with "column kind does not exist". Every
-- other statement here is already idempotent via IF EXISTS.
-- Resolved through `::regclass` rather than a table_schema literal, so the check
-- follows search_path exactly like every unqualified statement below it.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'user_sessions'::regclass
      AND attname = 'kind'
      AND attnum > 0
      AND NOT attisdropped
  ) THEN
    DELETE FROM user_sessions WHERE kind = 'mcp';
  END IF;
END $$;

DROP INDEX IF EXISTS idx_user_sessions_user_kind;
ALTER TABLE user_sessions DROP CONSTRAINT IF EXISTS user_sessions_kind_chk;
ALTER TABLE user_sessions DROP COLUMN IF EXISTS last_used_at;
ALTER TABLE user_sessions DROP COLUMN IF EXISTS label;
ALTER TABLE user_sessions DROP COLUMN IF EXISTS kind;

-- Clear the tracker so the forward migration is re-applied on the next deploy. The
-- rollback CLI (scripts/migrations/run.ts) also does this, but a rollback run by hand
-- with `psql -f` would otherwise leave 467 recorded as applied and the columns gone —
-- a state the forward runner will never repair on its own. Matches the convention in
-- rollback_451..457 and 461..464.
DELETE FROM schema_migrations WHERE filename = '467_mcp_sessions.sql';

COMMIT;

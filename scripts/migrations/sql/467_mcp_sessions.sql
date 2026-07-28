-- scripts/migrations/sql/467_mcp_sessions.sql
-- Read-only MCP tokens: tag sessions by kind so (a) "log out everywhere" can sweep
-- browser sessions without silently killing every user's MCP connection, and (b) the
-- auth wrappers can apply the read-only gate. Idempotent; safe to re-run.

ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'browser';
ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS label TEXT;
ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ;

-- ADD CONSTRAINT has no IF NOT EXISTS form, so guard it explicitly.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_sessions_kind_chk') THEN
    ALTER TABLE user_sessions
      ADD CONSTRAINT user_sessions_kind_chk CHECK (kind IN ('browser', 'mcp'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_user_sessions_user_kind
  ON user_sessions (user_id, kind);

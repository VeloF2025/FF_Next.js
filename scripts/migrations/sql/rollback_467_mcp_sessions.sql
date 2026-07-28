-- Rollback: 467_mcp_sessions.sql
--
-- Dropping `kind` destroys the only marker distinguishing MCP sessions from browser
-- ones, so any surviving MCP session becomes indistinguishable from a login. Delete
-- them first rather than leaving credentials behind that nothing can identify or sweep.
BEGIN;
DELETE FROM user_sessions WHERE kind = 'mcp';
DROP INDEX IF EXISTS idx_user_sessions_user_kind;
ALTER TABLE user_sessions DROP CONSTRAINT IF EXISTS user_sessions_kind_chk;
ALTER TABLE user_sessions DROP COLUMN IF EXISTS last_used_at;
ALTER TABLE user_sessions DROP COLUMN IF EXISTS label;
ALTER TABLE user_sessions DROP COLUMN IF EXISTS kind;
COMMIT;

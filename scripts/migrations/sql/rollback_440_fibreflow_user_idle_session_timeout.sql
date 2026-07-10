-- Rollback for 440_fibreflow_user_idle_session_timeout.sql
-- Removes the per-role idle_session_timeout backstop; existing sessions keep the
-- value inherited at connect time until they reconnect.
ALTER ROLE fibreflow_user RESET idle_session_timeout;

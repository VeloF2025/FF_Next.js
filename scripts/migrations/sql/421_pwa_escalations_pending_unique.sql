-- Migration 421: one PENDING escalation per (site_id, step_number) — partial unique index
-- (version = max(DB 420, file 420) + 1.)
--
-- pages/api/sitecam/escalate.ts always INSERTed a new pwa_escalations row, so a retried
-- or double-fired escalation (network retry, React re-invoke) created duplicate PENDING
-- supervisor-review rows for the same (site_id, step_number) and re-uploaded a
-- deterministically-named photo to VF Storage. A PARTIAL unique index on
-- (site_id, step_number) WHERE status = 'pending' lets the endpoint use an atomic
--   INSERT ... ON CONFLICT (site_id, step_number) WHERE status='pending' DO UPDATE
-- so a retry refreshes the existing pending row instead of duplicating it.
--
-- Scoped to status='pending' ONLY: a step legitimately re-escalates after a prior
-- escalation is resolved/rejected, so a full UNIQUE(site_id, step_number) would be wrong.
-- Built non-concurrently — the canonical runner wraps each migration in a single
-- transaction (psql -1), which disallows CREATE INDEX CONCURRENTLY; the table is small so
-- the brief lock is negligible. Verified 0 existing duplicate pending (site_id, step_number)
-- rows before writing this, so the unique build cannot fail on legacy data.
CREATE UNIQUE INDEX IF NOT EXISTS pwa_escalations_site_step_pending_uq
  ON pwa_escalations (site_id, step_number)
  WHERE status = 'pending';

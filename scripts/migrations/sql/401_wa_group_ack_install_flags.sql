-- Migration 401: decouple "send ACK" from "counts as installation" for WhatsApp groups
-- Purpose: today both behaviours are tied to group_type — an ACK is only sent when
--          group_type='dr_submission', and the daily-installations count excludes
--          one hard-coded project string ('Marketing Activations'). That conflates
--          two independent concerns. Home recon groups (LAW/MOA Home Recon, currently
--          group_type='pre_provision') must NOT count toward daily installations but
--          SHOULD receive the enriched DR ACK — the exact opposite of today's behaviour.
--
--          This migration adds two orthogonal boolean flags and a counted-rows view:
--            send_ack               → drives the bridge ACK gate (replaces the
--                                     hard-coded group_type='dr_submission' check)
--            counts_as_installation → drives the daily-installations count (replaces
--                                     the fragile project != 'Marketing Activations')
--
--          group_type is intentionally LEFT UNCHANGED (no new enum value) so the
--          chk_group_type CHECK constraint and existing pre_provision routing are
--          untouched. Safe to re-run.

-- ── Flags ──────────────────────────────────────────────────────────────────────
ALTER TABLE wa_monitored_groups
  ADD COLUMN IF NOT EXISTS send_ack               BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS counts_as_installation BOOLEAN NOT NULL DEFAULT true;

-- Preserve current ACK behaviour: only dr_submission groups ACK today.
UPDATE wa_monitored_groups
   SET send_ack = (group_type = 'dr_submission')
 WHERE send_ack IS DISTINCT FROM (group_type = 'dr_submission');

-- Home recon: ACK yes, count no. (group_jid is UNIQUE — targets exactly these rows.)
UPDATE wa_monitored_groups
   SET send_ack = true, counts_as_installation = false
 WHERE group_jid IN (
   '120363409368493163@g.us',  -- LAW Home Recon
   '120363426227615187@g.us'   -- MOA Home Recon
 );

-- Retire the fragile string filter: Marketing is processed + acked but never an install.
UPDATE wa_monitored_groups
   SET counts_as_installation = false
 WHERE project_name = 'Marketing';

-- ── Counted-rows view ────────────────────────────────────────────────────────────
-- Drop-in replacement for `FROM qa_photo_reviews WHERE project != 'Marketing Activations'`.
-- LEFT JOIN + COALESCE(..., true) is the safety net: rows whose wa_group_jid is NULL or
-- does not match a monitored group (legacy / ad-hoc) keep counting; only groups explicitly
-- flagged counts_as_installation = false are excluded.
CREATE OR REPLACE VIEW qa_photo_reviews_counted AS
  SELECT q.*
    FROM qa_photo_reviews q
    LEFT JOIN wa_monitored_groups g ON g.group_jid = q.wa_group_jid
   WHERE COALESCE(g.counts_as_installation, true);

COMMENT ON VIEW qa_photo_reviews_counted IS
  'qa_photo_reviews restricted to rows that count as installations (excludes groups with counts_as_installation=false, e.g. Home Recon, Marketing). See migration 401.';

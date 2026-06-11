-- Migration 409: machine-published marker on action_items (Cortex Phase 5 auto-publish)
-- Phase 5 ships meeting action items downstream with NO human review gate (auto-publish).
-- Auto-created tasks from auto-sealed Cortex meetings are flagged machine_published=true so
-- they are: (1) visually distinguishable in the action-items UI, (2) filterable, and
-- (3) bulk-revocable if capture quality goes bad (the kill-switch's companion). Human-
-- reviewed (human-Published) Cortex tasks land with machine_published=false, like any other.

ALTER TABLE action_items
  ADD COLUMN IF NOT EXISTS machine_published BOOLEAN NOT NULL DEFAULT FALSE;

-- Partial index over just the machine-published rows: powers the UI filter and the
-- one-shot bulk-revoke without scanning the whole table.
CREATE INDEX IF NOT EXISTS idx_action_items_machine_published
  ON action_items (created_at DESC)
  WHERE machine_published = TRUE;

-- Phase 5 makes auto-sealed (human_reviewed=FALSE) meetings deliver too, so the
-- migration-397 "undelivered" index — partial on `human_reviewed = TRUE` — now silently
-- excludes the auto-sealed undelivered rows and misleads anyone querying "what's left to
-- deliver?". Replace it with a coverage-complete partial index keyed only on delivery.
DROP INDEX IF EXISTS cortex_meeting_actions_undelivered_idx;
CREATE INDEX IF NOT EXISTS cortex_meeting_actions_undelivered_idx
  ON cortex_meeting_actions (sealed_at DESC)
  WHERE delivered_at IS NULL;

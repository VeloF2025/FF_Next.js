-- 524_oes_pp_exit_reason.sql
--
-- Gives the pre-provision list an EXIT PATH for entries that never activate.
--
-- THE PROBLEM
--
-- A PP row leaves the open list in exactly one way today: it activates. There is
-- no way to record that one never will. Faulty ONTs, false positives and
-- cancelled customers therefore sit on the list forever — 1,168 rows across
-- not_found / located_* at the time of writing, most of them months old. That
-- balance is not cosmetic: it gates Fibertime's ">100 open per POP, no new
-- ports" rule, so a list inflated by dead entries blocks real port allocation.
--
-- WHY decommissioned_at COULD NOT BE USED
--
-- 377 added decommissioned_at/_reason for the post-activation exit (ONT swap),
-- and guarded it with oes_pp_data_lifecycle_order_check:
--
--   decommissioned_at IS NULL
--     OR (activated_at IS NOT NULL AND decommissioned_at >= activated_at)
--
-- Every row that needs an exit reason has activated_at IS NULL, so that column
-- is unusable for them BY CONSTRUCTION — retireSupersededPpSerials() already
-- reports them as `blockedNoActivatedAt` for exactly this reason. The two exits
-- are genuinely different events and get genuinely different columns:
--
--   activated -> decommissioned   : 377, decommissioned_at   (swap/supersession)
--   never activated -> exited     : here, exit_reason_at      (non-activation)
--
-- WHERE THE VALUES CAME FROM
--
-- Seven, chosen so a person picks honestly. Past roughly seven a dropdown stops
-- being classified and starts being "first plausible option", which produces
-- confident-looking data that means nothing. `unknown` is a REAL member, not an
-- absence: the plan's standing rule is that blanks land in an explicit unknown
-- bucket and appear in the exceptions report, never silently as zero.
--
-- WHAT IS DELIBERATELY *NOT* CONSTRAINED
--
-- There is NO constraint forbidding exit_reason on a row that later activates.
-- It is tempting — the two exits should be mutually exclusive — but the nightly
-- OES import sets activated_at, so such a constraint would let a returning
-- customer ABORT THE IMPORT. A failed nightly import is a production incident;
-- a row carrying both is a harmless historical record of a re-entry, and the
-- open-balance query excludes it on activated_at alone. Correctness here comes
-- from the read side, not from a constraint the importer can trip.
--
-- IDEMPOTENCY
--
-- ADD COLUMN IF NOT EXISTS, and both constraints are added only when absent, so
-- the file is safe to re-run.

ALTER TABLE oes_pp_data
  ADD COLUMN IF NOT EXISTS exit_reason     TEXT,
  ADD COLUMN IF NOT EXISTS exit_reason_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS exit_reason_by  UUID;

-- Membership. Kept as a CHECK rather than an enum type: adding a value later is
-- a constraint swap inside one transaction, where ALTER TYPE ADD VALUE has
-- version-dependent transactionality and cannot remove a mistake at all.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'oes_pp_data'::regclass
       AND conname  = 'oes_pp_data_exit_reason_check'
  ) THEN
    ALTER TABLE oes_pp_data
      ADD CONSTRAINT oes_pp_data_exit_reason_check
      CHECK (exit_reason IS NULL OR exit_reason IN (
        'ont_faulty',          -- ONT dead / RMA'd
        'false_positive',      -- never genuinely pre-provisioned
        'duplicate',           -- the home already has a live PP
        'customer_cancelled',  -- customer withdrew
        'no_access',           -- could not gain access to the premises
        'moved_away',          -- premises vacated
        'unknown'              -- explicit; NEVER a silent zero
      ));
  END IF;
END $$;

-- Coherence: the reason and its timestamp move together. Without this a row can
-- carry a reason with no date (invisible to any dated metric) or a date with no
-- reason (counted as exited, attributable to nothing).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'oes_pp_data'::regclass
       AND conname  = 'oes_pp_data_exit_reason_coherence_check'
  ) THEN
    ALTER TABLE oes_pp_data
      ADD CONSTRAINT oes_pp_data_exit_reason_coherence_check
      CHECK ((exit_reason IS NULL) = (exit_reason_at IS NULL));
  END IF;
END $$;

-- Supports the open-balance snapshot, which is the hot path: it reads the rows
-- still open, i.e. exit_reason IS NULL, every night.
CREATE INDEX IF NOT EXISTS idx_oes_pp_data_open_no_exit
  ON oes_pp_data (date_registered)
  WHERE activated_at IS NULL AND exit_reason IS NULL;

-- Supports the fill-rate and exit-mix reporting, which read only exited rows.
CREATE INDEX IF NOT EXISTS idx_oes_pp_data_exit_reason
  ON oes_pp_data (exit_reason, exit_reason_at)
  WHERE exit_reason IS NOT NULL;

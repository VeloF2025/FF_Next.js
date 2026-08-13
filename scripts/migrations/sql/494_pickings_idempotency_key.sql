-- scripts/migrations/sql/494_pickings_idempotency_key.sql
-- Client-generated idempotency key on stock_pickings so duplicate submissions
-- from the offline PWA queue dedupe server-side — mirrors the returns flow
-- (migration 359). Without this, a network drop mid-submit made the offline
-- queue retry the whole create->confirm->sign->process chain, creating a NEW
-- picking and issuing the stock a second time (double-debit for quantity-based
-- lines, orphaned draft for serial lines).

ALTER TABLE stock_pickings
  ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(64);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_stock_pickings_idempotency
  ON stock_pickings(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

COMMENT ON COLUMN stock_pickings.idempotency_key IS
  'Client-generated UUID per submission (the offline queue item id). NULL for legacy / non-PWA pickings. Partial unique index dedupes PWA submissions.';

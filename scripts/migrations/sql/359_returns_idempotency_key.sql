-- scripts/migrations/sql/359_returns_idempotency_key.sql
-- Phase 3 of field-stock PWA: client-generated idempotency key on stock_returns
-- so duplicate submissions from the offline queue dedupe server-side.
-- See spec: docs/superpowers/specs/2026-05-20-field-stock-pwa-return-design.md

ALTER TABLE stock_returns
  ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(64);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_stock_returns_idempotency
  ON stock_returns(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

COMMENT ON COLUMN stock_returns.idempotency_key IS
  'Client-generated UUID per submission. NULL for legacy / non-PWA returns. Partial unique index dedupes PWA submissions.';

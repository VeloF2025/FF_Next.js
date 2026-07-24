-- Migration: 459_wa_message_logs_provider_message_id.sql
-- Description: Add provider_message_id (the Meta Cloud wamid) to wa_message_logs
--              with a partial unique index so re-delivered webhook events and
--              re-logged sends collapse to a single row via ON CONFLICT DO NOTHING.
-- Created: 2026-07-24
-- Phase 1.5: WhatsApp Cloud hardening — wamid idempotency.

BEGIN;

-- 1) The provider's message id (Meta Cloud `wamid.*`). Nullable: WAHA/group and
--    older rows have no wamid, and the unique index only covers non-null values.
ALTER TABLE wa_message_logs
  ADD COLUMN IF NOT EXISTS provider_message_id VARCHAR;

-- 2) Partial unique index — one row per non-null wamid. NULLs are unconstrained
--    (multiple WAHA/group rows without a wamid remain allowed). This is the
--    arbiter for `ON CONFLICT (provider_message_id) WHERE provider_message_id
--    IS NOT NULL DO NOTHING`.
CREATE UNIQUE INDEX IF NOT EXISTS idx_wa_logs_provider_message_id
  ON wa_message_logs (provider_message_id)
  WHERE provider_message_id IS NOT NULL;

COMMIT;

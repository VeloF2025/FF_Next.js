-- Migration: 247_wa_cloud_provider.sql
-- Description: Add the Cloud + WAHA 1:1 services to wa_message_logs and seed
--              provider config for the official Meta WhatsApp Cloud API 1:1 provider.
-- Created: 2026-07-24
-- Phase 1: WhatsApp Cloud provider + NOC ticket conversation panel.

BEGIN;

-- 1) Allow 'cloud' and 'waha' as message-log services (was: 'bridge','sender').
ALTER TABLE wa_message_logs DROP CONSTRAINT IF EXISTS wa_message_logs_service_check;
ALTER TABLE wa_message_logs
  ADD CONSTRAINT wa_message_logs_service_check
  CHECK (service IN ('bridge','sender','cloud','waha'));

-- 2) Seed provider config keys (idempotent). Values set later via the admin UI.
--    Default provider is 'bridge' — safe until a Cloud number is live.
INSERT INTO wa_service_config (config_key, config_value, config_type, category, description, is_sensitive)
VALUES
  ('wa_provider',              'bridge', 'string',  'provider', 'Active 1:1 WhatsApp provider: bridge | cloud', false),
  ('cloud_phone_number_id',    '',       'string',  'cloud',    'Meta WABA phone_number_id',                    false),
  ('cloud_access_token',       '',       'string',  'cloud',    'Meta system-user access token',                true),
  ('cloud_app_secret',         '',       'string',  'cloud',    'Meta app secret for X-Hub-Signature-256',      true),
  ('cloud_verify_token',       '',       'string',  'cloud',    'Webhook GET verify token',                     true)
ON CONFLICT (config_key) DO NOTHING;

COMMIT;

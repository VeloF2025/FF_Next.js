-- Migration: 095_wa_service_fallback.sql
-- Description: Add fallback/multi-phone support for WhatsApp services
-- Created: 2026-01-20

-- Add fallback columns to wa_service_config for sender/bridge services
-- This allows configuring primary and fallback phone numbers

-- Insert default configurations for sender service
INSERT INTO wa_service_config (config_key, config_value, category, description, updated_at)
VALUES
  ('sender_primary_phone', '+27824189511', 'sender', 'Primary phone number for sender service (Hein)', NOW()),
  ('sender_fallback_phone', '', 'sender', 'Fallback phone number if primary disconnects', NOW()),
  ('sender_auto_failover', 'false', 'sender', 'Auto-switch to fallback on connection loss', NOW())
ON CONFLICT (config_key) DO NOTHING;

-- Insert default configurations for bridge service
INSERT INTO wa_service_config (config_key, config_value, category, description, updated_at)
VALUES
  ('bridge_primary_phone', '+27640412391', 'bridge', 'Primary phone number for bridge service (Louis)', NOW()),
  ('bridge_fallback_phone', '', 'bridge', 'Fallback phone number if primary disconnects', NOW()),
  ('bridge_auto_failover', 'false', 'bridge', 'Auto-switch to fallback on connection loss', NOW())
ON CONFLICT (config_key) DO NOTHING;

-- Create a table to track phone number history and status
CREATE TABLE IF NOT EXISTS wa_phone_numbers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service VARCHAR(20) NOT NULL CHECK (service IN ('sender', 'bridge')),
  phone_number VARCHAR(20) NOT NULL,
  display_name VARCHAR(100),
  role VARCHAR(20) NOT NULL CHECK (role IN ('primary', 'fallback')),
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'paired', 'unpaired')),
  last_paired_at TIMESTAMPTZ,
  last_disconnected_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(service, phone_number)
);

-- Insert current known phone numbers
INSERT INTO wa_phone_numbers (service, phone_number, display_name, role, status, last_paired_at)
VALUES
  ('sender', '+27824189511', 'Hein (082 418 9511)', 'primary', 'paired', NOW()),
  ('bridge', '+27640412391', 'Louis (064 041 2391)', 'primary', 'paired', NOW())
ON CONFLICT (service, phone_number) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  last_paired_at = EXCLUDED.last_paired_at;

-- Add index for quick lookups
CREATE INDEX IF NOT EXISTS idx_wa_phone_numbers_service ON wa_phone_numbers(service);
CREATE INDEX IF NOT EXISTS idx_wa_phone_numbers_role ON wa_phone_numbers(service, role);

-- Add audit log entries for phone changes
COMMENT ON TABLE wa_phone_numbers IS 'Tracks WhatsApp phone numbers for services with their pairing status';

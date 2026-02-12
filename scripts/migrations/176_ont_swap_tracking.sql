-- Migration 176: ONT Swap Tracking via WhatsApp Pre-Provision Groups
-- Tracks ONT replacements reported in WhatsApp groups

-- ============================================================================
-- A. Create ont_swap_records table
-- ============================================================================

CREATE TABLE IF NOT EXISTS ont_swap_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  drop_number TEXT NOT NULL,
  project TEXT NOT NULL,
  old_serial TEXT,
  new_serial TEXT NOT NULL,
  swap_type TEXT CHECK (swap_type IN ('pre_provision', 'encrypted_ont')),
  status TEXT NOT NULL DEFAULT 'pending_review'
    CHECK (status IN ('pending_review', 'confirmed_oes', 'reviewed', 'rejected')),
  oes_status TEXT,
  reason TEXT,
  wa_message_id TEXT,
  wa_group_jid TEXT,
  wa_sender_jid TEXT,
  wa_sender_name TEXT,
  raw_message TEXT,
  old_serial_source TEXT,
  pp_data_id INTEGER REFERENCES oes_pp_data(id) ON DELETE SET NULL,
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  review_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Dedup: one swap record per DR + new serial
CREATE UNIQUE INDEX IF NOT EXISTS idx_ont_swap_records_dr_serial
  ON ont_swap_records (drop_number, new_serial);

-- Query indexes
CREATE INDEX IF NOT EXISTS idx_ont_swap_records_drop_number ON ont_swap_records (drop_number);
CREATE INDEX IF NOT EXISTS idx_ont_swap_records_new_serial ON ont_swap_records (new_serial);
CREATE INDEX IF NOT EXISTS idx_ont_swap_records_project ON ont_swap_records (project);
CREATE INDEX IF NOT EXISTS idx_ont_swap_records_status ON ont_swap_records (status);
CREATE INDEX IF NOT EXISTS idx_ont_swap_records_created_at ON ont_swap_records (created_at DESC);

-- ============================================================================
-- B. Update wa_monitored_groups constraint to allow pre_provision type
-- ============================================================================

ALTER TABLE wa_monitored_groups DROP CONSTRAINT IF EXISTS chk_group_type;
ALTER TABLE wa_monitored_groups ADD CONSTRAINT chk_group_type
  CHECK (group_type IN ('dr_submission', 'maintenance', 'admin', 'pre_provision'));

-- ============================================================================
-- C. Seed Mohadin Pre-Provision group (placeholder JID — update via WA Portal)
-- ============================================================================

INSERT INTO wa_monitored_groups (group_jid, group_name, group_type, project_name, is_active)
VALUES (
  'PLACEHOLDER_MOHADIN_PP',
  'Mohadin Pre-Provision and Encrypted ONTs',
  'pre_provision',
  'Mohadin',
  false
)
ON CONFLICT (group_jid) DO NOTHING;

/**
 * Migration 118: Installation Gap Tracking
 *
 * Purpose: Track DRs that are "Installed but Not Activated"
 * - Installed = WA submission OR 1Map has installer name
 * - Activated = Appeared on OES report
 * - Gap = Installed but never activated (money spent, not live)
 *
 * Date: 2026-01-24
 * Author: PAI System
 */

-- ====================================================================================
-- 1. ADD NEW COLUMNS TO dr_photo_unified_reviews
-- ====================================================================================

-- Installer name from 1Map (if not null, means installation happened)
ALTER TABLE dr_photo_unified_reviews
ADD COLUMN IF NOT EXISTS installer_name VARCHAR(255);

-- When the DR was activated (appeared on OES report)
ALTER TABLE dr_photo_unified_reviews
ADD COLUMN IF NOT EXISTS oes_activated_at TIMESTAMP WITH TIME ZONE;

-- OES serial number (for matching)
ALTER TABLE dr_photo_unified_reviews
ADD COLUMN IF NOT EXISTS oes_serial VARCHAR(100);

-- OES team name
ALTER TABLE dr_photo_unified_reviews
ADD COLUMN IF NOT EXISTS oes_team VARCHAR(100);

-- Comment for why not activated (manual tracking)
ALTER TABLE dr_photo_unified_reviews
ADD COLUMN IF NOT EXISTS activation_gap_reason TEXT;

-- ====================================================================================
-- 2. CREATE INDEX FOR GAP QUERIES
-- ====================================================================================

-- Index for finding installed but not activated DRs
CREATE INDEX IF NOT EXISTS idx_unified_installation_gap
ON dr_photo_unified_reviews(oes_activated_at)
WHERE oes_activated_at IS NULL
  AND (wa_received_at IS NOT NULL OR installer_name IS NOT NULL);

-- Index for installer name queries
CREATE INDEX IF NOT EXISTS idx_unified_installer_name
ON dr_photo_unified_reviews(installer_name)
WHERE installer_name IS NOT NULL;

-- Index for OES activation date
CREATE INDEX IF NOT EXISTS idx_unified_oes_activated_at
ON dr_photo_unified_reviews(oes_activated_at)
WHERE oes_activated_at IS NOT NULL;

-- ====================================================================================
-- 3. CREATE VIEW FOR INSTALLATION GAP REPORT
-- ====================================================================================

CREATE OR REPLACE VIEW v_installation_gaps AS
SELECT
  u.drop_number,
  u.project,
  u.installer_name,
  u.wa_received_at,
  u.created_at as first_seen_at,
  u.photo_count,
  u.ont_serial_scanned,
  u.ups_serial_scanned,
  u.qa_decision,
  u.feedback_sent,
  u.activation_gap_reason,
  -- Calculate days since installation
  EXTRACT(DAY FROM NOW() - COALESCE(u.wa_received_at, u.created_at)) as days_since_install,
  -- Determine installation source
  CASE
    WHEN u.wa_received_at IS NOT NULL THEN 'whatsapp'
    WHEN u.installer_name IS NOT NULL THEN 'onemap'
    ELSE 'unknown'
  END as install_source
FROM dr_photo_unified_reviews u
WHERE u.oes_activated_at IS NULL  -- Not activated
  AND (u.wa_received_at IS NOT NULL OR u.installer_name IS NOT NULL)  -- But installed
ORDER BY COALESCE(u.wa_received_at, u.created_at) DESC;

-- ====================================================================================
-- 4. VERIFICATION
-- ====================================================================================

DO $$
BEGIN
  -- Check new columns exist
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'dr_photo_unified_reviews'
      AND column_name = 'installer_name'
  ) THEN
    RAISE NOTICE '✅ Column installer_name added successfully';
  ELSE
    RAISE EXCEPTION '❌ Column installer_name was not added';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'dr_photo_unified_reviews'
      AND column_name = 'oes_activated_at'
  ) THEN
    RAISE NOTICE '✅ Column oes_activated_at added successfully';
  ELSE
    RAISE EXCEPTION '❌ Column oes_activated_at was not added';
  END IF;

  -- Check view exists
  IF EXISTS (
    SELECT 1 FROM information_schema.views
    WHERE table_name = 'v_installation_gaps'
  ) THEN
    RAISE NOTICE '✅ View v_installation_gaps created successfully';
  ELSE
    RAISE EXCEPTION '❌ View v_installation_gaps was not created';
  END IF;

  RAISE NOTICE '';
  RAISE NOTICE '====================================================================';
  RAISE NOTICE 'Migration 118: Installation Gap Tracking - COMPLETE';
  RAISE NOTICE '====================================================================';
  RAISE NOTICE 'Added columns:';
  RAISE NOTICE '  - installer_name: From 1Map (if set = installation happened)';
  RAISE NOTICE '  - oes_activated_at: When DR appeared on OES report';
  RAISE NOTICE '  - oes_serial, oes_team: OES data reference';
  RAISE NOTICE '  - activation_gap_reason: Manual tracking for gaps';
  RAISE NOTICE '';
  RAISE NOTICE 'Created view:';
  RAISE NOTICE '  - v_installation_gaps: DRs installed but not activated';
  RAISE NOTICE '====================================================================';
END $$;

-- Migration: 092_qfield_sync_view
-- Purpose: Create view for QFieldCloud OES data sync
-- Date: 2026-01-19
-- Status: APPLIED TO PRODUCTION 2026-01-19

-- View that JOINs oes_activations with drops and projects
-- to provide complete data for QField mobile sync
CREATE OR REPLACE VIEW v_qfield_oes_activations AS
SELECT
  oe.id,
  oe.drop_number,
  oe.activation_date,
  oe.serial_number,
  oe.latitude,
  oe.longitude,
  -- Zone: format as 'Z' + zone_no
  COALESCE('Z' || d.zone_no::text, 'UNKNOWN') as zone,
  -- PON: format as 'PON' + pon_no
  COALESCE('PON' || d.pon_no::text, 'UNKNOWN') as pon,
  -- Project: prefer projects.project_name, fallback to team mapping
  COALESCE(p.project_name,
    CASE
      WHEN oe.team LIKE 'law%' THEN 'Lawley'
      WHEN oe.team LIKE 'moa%' OR oe.team LIKE 'moh%' THEN 'Mohadin'
      WHEN oe.team LIKE 'mam%' THEN 'Mamelodi'
      WHEN oe.team LIKE 'etw%' THEN 'Etwatwa'
      ELSE 'Unknown'
    END
  ) as project_name,
  -- Signal data
  oe.ont_rx_sig_dbm,
  oe.olt_rx_sig_dbm,
  oe.link_budget_ont_olt_db,
  oe.link_budget_olt_ont_db,
  oe.current_ont_rx,
  oe.olt_address,
  -- Status
  oe.status,
  oe.team,
  -- Timestamps
  oe.created_at,
  oe.updated_at
FROM oes_activations oe
LEFT JOIN drops d ON oe.drop_id = d.id
LEFT JOIN projects p ON d.project_id = p.id;

-- Create index on updated_at for efficient delta sync
CREATE INDEX IF NOT EXISTS idx_oes_activations_updated_at
ON oes_activations(updated_at);

-- Comment
COMMENT ON VIEW v_qfield_oes_activations IS
'QFieldCloud sync view - JOINs OES data with drops and projects for complete activation data';

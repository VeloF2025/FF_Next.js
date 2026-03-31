-- Migration: 265_qfield_thembisa_pop1_sync
-- Purpose: Link Thembisa POP 1/2/3 to FT_Master_Progress QField project
--          and add team fallback mapping in OES view
-- Date: 2026-03-31

-- ============================================================================
-- 1. Link Thembisa POP 1, 2, 3 to FT_Master_Progress
-- ============================================================================

-- FT_Master_Progress QField project ID (from qfield_projects table)
-- Thembisa POP 1: 7d8b94d6-8e5a-4dbb-9ede-69ce3884e004
-- Thembisa POP 2: d3df9135-9aa3-415d-87b6-17cce547eb22
-- Thembisa POP 3: 1de088dd-fe24-43fb-b8d3-94fca61ef91d

INSERT INTO qfield_project_links (qfield_project_id, fibreflow_project_id)
VALUES
  ('405f8444-253f-4d82-9d8e-3fd1665aa518', '7d8b94d6-8e5a-4dbb-9ede-69ce3884e004'),
  ('405f8444-253f-4d82-9d8e-3fd1665aa518', 'd3df9135-9aa3-415d-87b6-17cce547eb22'),
  ('405f8444-253f-4d82-9d8e-3fd1665aa518', '1de088dd-fe24-43fb-b8d3-94fca61ef91d')
ON CONFLICT DO NOTHING;

-- ============================================================================
-- 2. Update OES view with Thembisa + Tonga team fallback mappings
--    Must DROP + CREATE because column list changed in a prior migration
-- ============================================================================

DROP VIEW IF EXISTS v_qfield_oes_activations;

CREATE VIEW v_qfield_oes_activations AS
SELECT
  oe.id,
  oe.drop_number,
  oe.activation_date,
  oe.serial_number,
  oe.latitude  AS oes_latitude,
  oe.longitude AS oes_longitude,
  d.latitude   AS planned_latitude,
  d.longitude  AS planned_longitude,
  -- Distance between planned and actual (meters)
  CASE
    WHEN oe.latitude IS NOT NULL AND d.latitude IS NOT NULL
    THEN ROUND(111320 * SQRT(
           POWER(oe.latitude - d.latitude, 2)::float8 +
           POWER((oe.longitude - d.longitude)::float8 * COS(RADIANS(oe.latitude::float8)), 2)
         ))
    ELSE NULL
  END AS distance_meters,
  COALESCE('Z' || d.zone_no::text, 'UNKNOWN') as zone,
  COALESCE('PON' || d.pon_no::text, 'UNKNOWN') as pon,
  COALESCE(p.project_name,
    CASE
      WHEN oe.team ILIKE 'law%' THEN 'Lawley'
      WHEN oe.team ILIKE 'moa%' OR oe.team ILIKE 'moh%' THEN 'Mohadin'
      WHEN oe.team ILIKE 'mam%' THEN 'Mamelodi'
      WHEN oe.team ILIKE 'etw%' THEN 'Etwatwa'
      WHEN oe.team ILIKE 'thm%' OR oe.team ILIKE 'tem%' OR oe.team ILIKE 'the%' THEN 'Thembisa POP 1'
      WHEN oe.team ILIKE 'ton%' THEN 'Tonga'
      ELSE 'Unknown'
    END
  ) as project_name,
  oe.ont_rx_sig_dbm,
  oe.olt_rx_sig_dbm,
  oe.link_budget_ont_olt_db,
  oe.link_budget_olt_ont_db,
  oe.current_ont_rx,
  oe.olt_address,
  oe.status,
  oe.team,
  oe.created_at,
  oe.updated_at
FROM oes_activations oe
LEFT JOIN drops d ON oe.drop_id = d.id
LEFT JOIN projects p ON d.project_id = p.id;

COMMENT ON VIEW v_qfield_oes_activations IS
'QFieldCloud sync view - JOINs OES data with drops and projects for complete activation data. Updated 2026-03-31: added Thembisa/Tonga team fallbacks.';

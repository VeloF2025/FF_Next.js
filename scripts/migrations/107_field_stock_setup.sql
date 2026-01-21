-- Migration 107: Field Stock Setup
-- Creates technician locations and field stock views/functions

-- Create technician locations for existing field technicians
DO $$
DECLARE
  tech RECORD;
  loc_code VARCHAR(20);
BEGIN
  FOR tech IN
    SELECT id, first_name, last_name, phone
    FROM staff
    WHERE status = 'active'
    AND position IN ('Senior Technician', 'Assistant Technician', 'Fibre Maintenance Technician', 'Team Leader')
  LOOP
    loc_code := 'TECH-' || UPPER(SUBSTRING(tech.first_name, 1, 3)) || UPPER(SUBSTRING(tech.last_name, 1, 3));

    -- Check if location already exists
    IF NOT EXISTS (SELECT 1 FROM stock_locations WHERE assigned_to_id = tech.id) THEN
      INSERT INTO stock_locations (
        code,
        name,
        location_type,
        is_virtual,
        is_active,
        assigned_to_id,
        assigned_to_name,
        assigned_to_phone,
        created_by
      ) VALUES (
        loc_code,
        tech.first_name || ' ' || tech.last_name || ' (Vehicle)',
        'technician',
        TRUE,
        TRUE,
        tech.id,
        tech.first_name || ' ' || tech.last_name,
        tech.phone,
        'migration'
      )
      ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;
END $$;

-- Add index for technician lookups
CREATE INDEX IF NOT EXISTS idx_stock_locations_assigned_to ON stock_locations(assigned_to_id) WHERE assigned_to_id IS NOT NULL;

-- View: Technician stock summary (quantity per technician per item)
CREATE OR REPLACE VIEW v_technician_stock_summary AS
SELECT
  sl.id AS location_id,
  sl.code AS location_code,
  sl.assigned_to_id AS technician_id,
  sl.assigned_to_name AS technician_name,
  sl.assigned_to_phone AS technician_phone,
  si.id AS stock_item_id,
  si.code AS item_code,
  si.name AS item_name,
  si.category,
  si.unit_of_measure,
  si.is_serialized,
  COALESCE(sq.quantity_on_hand, 0) AS quantity_on_hand,
  COALESCE(sq.quantity_reserved, 0) AS quantity_reserved,
  COALESCE(sq.quantity_on_hand, 0) - COALESCE(sq.quantity_reserved, 0) AS quantity_available,
  sq.last_count_at,
  sq.last_count_by
FROM stock_locations sl
CROSS JOIN stock_items si
LEFT JOIN stock_quants sq ON sq.location_id = sl.id AND sq.stock_item_id = si.id
WHERE sl.location_type = 'technician'
AND sl.is_active = TRUE
AND si.is_active = TRUE;

-- View: Field stock movement history
CREATE OR REPLACE VIEW v_field_stock_movements AS
SELECT
  'picking' AS movement_type,
  sp.id AS movement_id,
  sp.picking_number AS reference,
  sp.picking_type,
  sp.source_location_id,
  sl_src.name AS source_location_name,
  sp.destination_location_id,
  sl_dest.name AS destination_location_name,
  sp.technician_id,
  sp.technician_name,
  spl.stock_item_id,
  si.code AS item_code,
  si.name AS item_name,
  spl.quantity_requested,
  spl.quantity_delivered,
  spl.serial_ids,
  sp.status,
  sp.picked_at AS movement_date,
  sp.picked_by AS moved_by,
  sp.created_at
FROM stock_pickings sp
JOIN stock_picking_lines spl ON spl.picking_id = sp.id
JOIN stock_items si ON si.id = spl.stock_item_id
LEFT JOIN stock_locations sl_src ON sl_src.id = sp.source_location_id
LEFT JOIN stock_locations sl_dest ON sl_dest.id = sp.destination_location_id
WHERE sl_dest.location_type = 'technician' OR sl_src.location_type = 'technician'

UNION ALL

SELECT
  'consumption' AS movement_type,
  sc.id AS movement_id,
  COALESCE(sc.drop_number, sc.home_install_id::TEXT) AS reference,
  'consumption' AS picking_type,
  sc.consumed_from_location_id AS source_location_id,
  sl.name AS source_location_name,
  (SELECT id FROM stock_locations WHERE code = 'CUSTOMER' LIMIT 1) AS destination_location_id,
  'Customer Installed' AS destination_location_name,
  sc.consumed_by_id AS technician_id,
  sc.consumed_by_name AS technician_name,
  sc.stock_item_id,
  si.code AS item_code,
  si.name AS item_name,
  sc.quantity AS quantity_requested,
  sc.quantity AS quantity_delivered,
  CASE WHEN sc.serial_id IS NOT NULL THEN ARRAY[sc.serial_id] ELSE NULL END AS serial_ids,
  CASE WHEN sc.verified THEN 'verified' ELSE 'pending' END AS status,
  sc.consumed_at AS movement_date,
  sc.consumed_by_name AS moved_by,
  sc.created_at
FROM stock_consumptions sc
JOIN stock_items si ON si.id = sc.stock_item_id
LEFT JOIN stock_locations sl ON sl.id = sc.consumed_from_location_id

UNION ALL

SELECT
  'return' AS movement_type,
  sr.id AS movement_id,
  sr.return_number AS reference,
  'return' AS picking_type,
  sr.source_location_id,
  sl_src.name AS source_location_name,
  sr.destination_location_id,
  sl_dest.name AS destination_location_name,
  sr.technician_id,
  sr.technician_name,
  srl.stock_item_id,
  si.code AS item_code,
  si.name AS item_name,
  srl.quantity_returned AS quantity_requested,
  srl.quantity_accepted AS quantity_delivered,
  srl.serial_ids,
  sr.status,
  sr.received_at AS movement_date,
  sr.received_by AS moved_by,
  sr.created_at
FROM stock_returns sr
JOIN stock_return_lines srl ON srl.return_id = sr.id
JOIN stock_items si ON si.id = srl.stock_item_id
LEFT JOIN stock_locations sl_src ON sl_src.id = sr.source_location_id
LEFT JOIN stock_locations sl_dest ON sl_dest.id = sr.destination_location_id;

-- View: Technician dashboard summary
CREATE OR REPLACE VIEW v_technician_field_dashboard AS
SELECT
  sl.id AS location_id,
  sl.code AS location_code,
  sl.assigned_to_id AS technician_id,
  sl.assigned_to_name AS technician_name,
  sl.assigned_to_phone AS technician_phone,
  -- Stock counts
  COUNT(DISTINCT sq.stock_item_id) FILTER (WHERE sq.quantity_on_hand > 0) AS unique_items,
  COALESCE(SUM(sq.quantity_on_hand), 0)::INTEGER AS total_quantity,
  COALESCE(SUM(sq.quantity_reserved), 0)::INTEGER AS reserved_quantity,
  -- Pending pickings
  (SELECT COUNT(*) FROM stock_pickings sp
   WHERE sp.destination_location_id = sl.id
   AND sp.status IN ('draft', 'confirmed', 'ready')) AS pending_pickings,
  -- Pending returns
  (SELECT COUNT(*) FROM stock_returns sr
   WHERE sr.source_location_id = sl.id
   AND sr.status IN ('draft', 'submitted')) AS pending_returns,
  -- Recent consumption
  (SELECT COUNT(*) FROM stock_consumptions sc
   WHERE sc.consumed_from_location_id = sl.id
   AND sc.consumed_at >= NOW() - INTERVAL '7 days') AS consumptions_7d,
  -- Last activity
  GREATEST(
    (SELECT MAX(picked_at) FROM stock_pickings WHERE destination_location_id = sl.id),
    (SELECT MAX(consumed_at) FROM stock_consumptions WHERE consumed_from_location_id = sl.id),
    (SELECT MAX(received_at) FROM stock_returns WHERE source_location_id = sl.id)
  ) AS last_activity_at
FROM stock_locations sl
LEFT JOIN stock_quants sq ON sq.location_id = sl.id
WHERE sl.location_type = 'technician'
AND sl.is_active = TRUE
GROUP BY sl.id, sl.code, sl.assigned_to_id, sl.assigned_to_name, sl.assigned_to_phone;

-- Function: Get technician's stock items
CREATE OR REPLACE FUNCTION get_technician_stock(p_technician_id UUID)
RETURNS TABLE (
  stock_item_id UUID,
  item_code VARCHAR,
  item_name VARCHAR,
  category VARCHAR,
  unit_of_measure VARCHAR,
  is_serialized BOOLEAN,
  quantity_on_hand INTEGER,
  quantity_reserved INTEGER,
  quantity_available INTEGER,
  serials JSONB
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    si.id AS stock_item_id,
    si.code AS item_code,
    si.name AS item_name,
    si.category,
    si.unit_of_measure,
    si.is_serialized,
    COALESCE(sq.quantity_on_hand, 0)::INTEGER AS quantity_on_hand,
    COALESCE(sq.quantity_reserved, 0)::INTEGER AS quantity_reserved,
    (COALESCE(sq.quantity_on_hand, 0) - COALESCE(sq.quantity_reserved, 0))::INTEGER AS quantity_available,
    COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
        'id', ss.id,
        'serial_number', ss.serial_number,
        'status', ss.status
      ))
      FROM stock_serials ss
      WHERE ss.stock_item_id = si.id
      AND ss.current_location_id = sl.id
      AND ss.status = 'available'),
      '[]'::JSONB
    ) AS serials
  FROM stock_locations sl
  CROSS JOIN stock_items si
  LEFT JOIN stock_quants sq ON sq.location_id = sl.id AND sq.stock_item_id = si.id
  WHERE sl.assigned_to_id = p_technician_id
  AND sl.location_type = 'technician'
  AND si.is_active = TRUE
  AND COALESCE(sq.quantity_on_hand, 0) > 0
  ORDER BY si.category, si.name;
END;
$$ LANGUAGE plpgsql;

-- Function: Issue stock to technician (simplified)
CREATE OR REPLACE FUNCTION issue_stock_to_technician(
  p_source_location_id UUID,
  p_technician_id UUID,
  p_items JSONB, -- Array of {stock_item_id, quantity, serial_ids?}
  p_issued_by VARCHAR DEFAULT 'system'
)
RETURNS UUID AS $$
DECLARE
  v_picking_id UUID;
  v_picking_number VARCHAR;
  v_tech_location_id UUID;
  v_item JSONB;
BEGIN
  -- Get technician's location
  SELECT id INTO v_tech_location_id
  FROM stock_locations
  WHERE assigned_to_id = p_technician_id
  AND location_type = 'technician'
  LIMIT 1;

  IF v_tech_location_id IS NULL THEN
    RAISE EXCEPTION 'Technician does not have a stock location';
  END IF;

  -- Generate picking number
  SELECT 'PK-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || LPAD(COALESCE(
    (SELECT COUNT(*) + 1 FROM stock_pickings WHERE created_at::DATE = CURRENT_DATE),
    1
  )::TEXT, 4, '0') INTO v_picking_number;

  -- Create picking header
  INSERT INTO stock_pickings (
    picking_number,
    picking_type,
    source_location_id,
    destination_location_id,
    technician_id,
    technician_name,
    status,
    created_by
  )
  SELECT
    v_picking_number,
    'issue',
    p_source_location_id,
    v_tech_location_id,
    p_technician_id,
    assigned_to_name,
    'ready',
    p_issued_by
  FROM stock_locations WHERE id = v_tech_location_id
  RETURNING id INTO v_picking_id;

  -- Create picking lines
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    INSERT INTO stock_picking_lines (
      picking_id,
      stock_item_id,
      quantity_requested,
      serial_ids
    ) VALUES (
      v_picking_id,
      (v_item->>'stock_item_id')::UUID,
      (v_item->>'quantity')::INTEGER,
      CASE
        WHEN v_item->'serial_ids' IS NOT NULL
        THEN (SELECT ARRAY(SELECT jsonb_array_elements_text(v_item->'serial_ids'))::UUID[])
        ELSE NULL
      END
    );
  END LOOP;

  RETURN v_picking_id;
END;
$$ LANGUAGE plpgsql;

-- Add comment
COMMENT ON VIEW v_technician_field_dashboard IS 'Summary dashboard for field stock per technician';
COMMENT ON FUNCTION get_technician_stock IS 'Get all stock items held by a specific technician';
COMMENT ON FUNCTION issue_stock_to_technician IS 'Create a stock picking to issue items to a technician';

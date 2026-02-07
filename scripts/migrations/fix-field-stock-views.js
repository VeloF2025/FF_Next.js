/**
 * Fix field stock views - use correct column names based on actual schema
 */

const { neon } = require('@neondatabase/serverless');

const DATABASE_URL = process.env.DATABASE_URL || 'process.env.DATABASE_URL';

async function run() {
  const sql = neon(DATABASE_URL);

  // Create v_field_stock_movements view (pickings only for now - simpler)
  await sql`
    CREATE OR REPLACE VIEW v_field_stock_movements AS
    SELECT
      'picking'::text AS movement_type,
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
      si.item_code AS item_code,
      si.name AS item_name,
      spl.planned_quantity AS quantity_requested,
      spl.actual_quantity AS quantity_delivered,
      spl.serial_ids,
      sp.status,
      sp.effective_date AS movement_date,
      sp.signed_by AS moved_by,
      sp.created_at
    FROM stock_pickings sp
    JOIN stock_picking_lines spl ON spl.picking_id = sp.id
    JOIN stock_items si ON si.id = spl.stock_item_id
    LEFT JOIN stock_locations sl_src ON sl_src.id = sp.source_location_id
    LEFT JOIN stock_locations sl_dest ON sl_dest.id = sp.destination_location_id
    WHERE sl_dest.location_type = 'technician' OR sl_src.location_type = 'technician'
  `;
  console.log('✓ Created v_field_stock_movements view');

  // Create v_technician_field_dashboard view
  await sql`
    CREATE OR REPLACE VIEW v_technician_field_dashboard AS
    SELECT
      sl.id AS location_id,
      sl.code AS location_code,
      sl.assigned_to_id AS technician_id,
      sl.assigned_to_name AS technician_name,
      sl.assigned_to_phone AS technician_phone,
      COUNT(DISTINCT sq.stock_item_id) FILTER (WHERE sq.quantity > 0) AS unique_items,
      COALESCE(SUM(sq.quantity), 0)::INTEGER AS total_quantity,
      COALESCE(SUM(sq.reserved_quantity), 0)::INTEGER AS reserved_quantity,
      (SELECT COUNT(*) FROM stock_pickings sp
       WHERE sp.destination_location_id = sl.id
       AND sp.status IN ('draft', 'confirmed', 'ready')) AS pending_pickings,
      (SELECT COUNT(*) FROM stock_returns sr
       WHERE sr.return_to_location_id = sl.id
       AND sr.status IN ('draft', 'submitted')) AS pending_returns,
      (SELECT COUNT(*) FROM stock_consumptions sc
       WHERE sc.consumed_from_location_id = sl.id
       AND sc.consumption_date >= NOW() - INTERVAL '7 days') AS consumptions_7d,
      GREATEST(
        (SELECT MAX(effective_date) FROM stock_pickings WHERE destination_location_id = sl.id),
        (SELECT MAX(consumption_date) FROM stock_consumptions WHERE consumed_from_location_id = sl.id),
        (SELECT MAX(received_date) FROM stock_returns WHERE return_to_location_id = sl.id)
      ) AS last_activity_at
    FROM stock_locations sl
    LEFT JOIN stock_quants sq ON sq.location_id = sl.id
    WHERE sl.location_type = 'technician'
    AND sl.is_active = TRUE
    GROUP BY sl.id, sl.code, sl.assigned_to_id, sl.assigned_to_name, sl.assigned_to_phone
  `;
  console.log('✓ Created v_technician_field_dashboard view');

  // Update v_technician_stock_summary to use correct column name
  await sql`DROP VIEW IF EXISTS v_technician_stock_summary`;
  await sql`
    CREATE VIEW v_technician_stock_summary AS
    SELECT
      sl.id AS location_id,
      sl.code AS location_code,
      sl.assigned_to_id AS technician_id,
      sl.assigned_to_name AS technician_name,
      sl.assigned_to_phone AS technician_phone,
      si.id AS stock_item_id,
      si.item_code AS item_code,
      si.name AS item_name,
      si.category,
      si.uom AS unit_of_measure,
      CASE WHEN si.tracking_type = 'serial' THEN true ELSE false END AS is_serialized,
      COALESCE(sq.quantity, 0)::INTEGER AS quantity_on_hand,
      COALESCE(sq.reserved_quantity, 0)::INTEGER AS quantity_reserved,
      (COALESCE(sq.quantity, 0) - COALESCE(sq.reserved_quantity, 0))::INTEGER AS quantity_available,
      sq.updated_at AS last_count_at,
      NULL::VARCHAR AS last_count_by
    FROM stock_locations sl
    CROSS JOIN stock_items si
    LEFT JOIN stock_quants sq ON sq.location_id = sl.id AND sq.stock_item_id = si.id
    WHERE sl.location_type = 'technician'
    AND sl.is_active = TRUE
    AND si.is_active = TRUE
  `;
  console.log('✓ Updated v_technician_stock_summary view');

  // Verify views
  const views = await sql`
    SELECT table_name FROM information_schema.views
    WHERE table_schema = 'public'
    AND (table_name LIKE 'v_technician%' OR table_name LIKE 'v_field%')
  `;
  console.log('\nViews:', views.map(v => v.table_name).join(', '));

  console.log('\n✅ Field stock views created successfully');
}

run().catch(e => console.error('Error:', e.message));

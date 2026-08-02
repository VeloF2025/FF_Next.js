import {
  defineLiveSqlGate,
  SAMPLE_DATE,
  SAMPLE_TIMESTAMPTZ,
  SAMPLE_UUID,
  type SqlTemplate,
} from './sqlLiveGate';

const TEMPLATES: SqlTemplate[] = [
  {
    name: 'clock-in rate snapshot insert-select',
    text: `
      INSERT INTO staff_rate_at_clock_in (entry_id, hourly_rate_cents)
      SELECT $1::uuid, ROUND(hourly_rate * 100)::bigint
      FROM staff
      WHERE id = $2::uuid AND hourly_rate IS NOT NULL
      ON CONFLICT (entry_id) DO NOTHING`,
    params: [SAMPLE_UUID, SAMPLE_UUID],
  },
  {
    name: 'Cartrack candidate entries',
    text: `
      SELECT e.id, e.staff_id, e.work_date::text AS work_date,
             e.clock_in_at::text, e.clock_out_at::text,
             e.clock_in_lat::text, e.clock_in_lon::text,
             e.clock_out_lat::text, e.clock_out_lon::text,
             ct.external_id AS cartrack_vehicle_id,
             EXISTS (SELECT 1 FROM attendance_gps_verifications v
               WHERE v.entry_id = e.id AND v.check_type = 'in') AS has_in_verification,
             EXISTS (SELECT 1 FROM attendance_gps_verifications v
               WHERE v.entry_id = e.id AND v.check_type = 'out') AS has_out_verification
      FROM attendance_entries e
      JOIN vehicle_assignments va ON va.id = e.vehicle_assignment_id
      JOIN fleet_vehicles fv ON fv.id = va.fleet_vehicle_id
      LEFT JOIN fleet_vehicle_trackers ct
        ON ct.vehicle_id = fv.id AND ct.is_active AND ct.provider = 'cartrack'
      WHERE e.status IN ('closed', 'auto_closed', 'manual')
        AND e.vehicle_assignment_id IS NOT NULL
        AND e.work_date >= $1::date AND e.work_date <= $2::date
      ORDER BY e.clock_in_at ASC`,
    params: [SAMPLE_DATE, SAMPLE_DATE],
  },
  {
    name: 'Cartrack verification upsert',
    text: `
      INSERT INTO attendance_gps_verifications (
        entry_id, check_type, verdict, vehicle_cartrack_id,
        vehicle_lat, vehicle_lon, vehicle_ts, device_lat, device_lon,
        distance_m, threshold_m, reconciled_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
      ON CONFLICT (entry_id, check_type) DO NOTHING
      RETURNING id`,
    params: [SAMPLE_UUID, 'in', 'match', '123', -26.2, 28, SAMPLE_TIMESTAMPTZ, -26.2, 28, 10.5, 500],
  },
  {
    name: 'Cartrack mismatch verification insert',
    text: `
      INSERT INTO attendance_gps_verifications (
        entry_id, check_type, verdict, vehicle_cartrack_id,
        vehicle_lat, vehicle_lon, vehicle_ts, device_lat, device_lon,
        distance_m, threshold_m, reconciled_at
      ) VALUES ($1, $2, 'mismatch', $3, $4, $5, $6::timestamptz, $7, $8, $9, $10, NOW())
      ON CONFLICT (entry_id, check_type) DO NOTHING
      RETURNING id`,
    params: [SAMPLE_UUID, 'in', '123', -26.2, 28, SAMPLE_TIMESTAMPTZ, -26.2, 28, 5000, 500],
  },
  {
    name: 'Cartrack mismatch exception insert',
    text: `
      INSERT INTO attendance_exceptions (entry_id, exception_kind, severity, details)
      VALUES ($1::uuid, 'vehicle_gps_mismatch', 'info', jsonb_build_object(
        'distance_m', $2::numeric, 'threshold_m', $3::numeric,
        'check_type', $4::text,
        'note', 'Cartrack vehicle position differs from device GPS. Corroboration only — not fraud.'
      ))
      ON CONFLICT (entry_id)
        WHERE exception_kind = 'vehicle_gps_mismatch' AND resolved_at IS NULL
        DO NOTHING
      RETURNING id`,
    params: [SAMPLE_UUID, 5000, 500, 'in'],
  },
];

defineLiveSqlGate('attendance evidence SQL live-schema gate', TEMPLATES);

import { defineLiveSqlGate, SAMPLE_UUID, type SqlTemplate } from './sqlLiveGate';

const OWN_SELECT = `
  SELECT a.*, e.staff_id AS entry_staff_id, e.work_date::text AS entry_work_date,
         e.clock_in_at::text AS entry_clock_in_at, e.clock_out_at::text AS entry_clock_out_at
  FROM attendance_adjustments a
  JOIN attendance_entries e ON e.id = a.entry_id`;

const TEMPLATES: SqlTemplate[] = [
  {
    name: 'cancel own pending adjustment with ownership join',
    text: `
      UPDATE attendance_adjustments a
      SET status = 'cancelled', reviewed_by = $2::uuid, reviewed_at = NOW(),
          review_note = 'self-cancelled by staff', updated_at = NOW()
      FROM attendance_entries e
      WHERE a.id = $1::uuid AND a.entry_id = e.id
        AND e.staff_id = $2::uuid AND a.status = 'pending'
      RETURNING a.*`,
    params: [SAMPLE_UUID, SAMPLE_UUID],
  },
  {
    name: 'list own adjustments default branch',
    text: `${OWN_SELECT}
      WHERE e.staff_id = $1::uuid
      ORDER BY CASE a.status WHEN 'pending' THEN 0 ELSE 1 END ASC, a.created_at DESC
      LIMIT $2::int`,
    params: [SAMPLE_UUID, 30],
  },
  {
    name: 'list own adjustments status-scoped branch',
    text: `${OWN_SELECT}
      WHERE e.staff_id = $1::uuid AND a.status = $2::text
      ORDER BY a.created_at DESC
      LIMIT $3::int`,
    params: [SAMPLE_UUID, 'pending', 30],
  },
  {
    name: 'count supervised adjustments scoped branch',
    text: `
      SELECT a.status, COUNT(*)::text AS count
      FROM attendance_adjustments a
      JOIN attendance_entries e ON e.id = a.entry_id
      WHERE e.staff_id = ANY($1::uuid[])
      GROUP BY a.status`,
    params: [[SAMPLE_UUID]],
  },
  {
    name: 'count supervised adjustments unscoped branch',
    text: `
      SELECT a.status, COUNT(*)::text AS count
      FROM attendance_adjustments a
      GROUP BY a.status`,
    params: [],
  },
  {
    name: 'count own adjustments by status',
    text: `
      SELECT a.status, COUNT(*)::text AS count
      FROM attendance_adjustments a
      JOIN attendance_entries e ON e.id = a.entry_id
      WHERE e.staff_id = $1::uuid
      GROUP BY a.status`,
    params: [SAMPLE_UUID],
  },
  {
    name: 'resolve staff IDs supervised by viewer',
    text: `
      WITH RECURSIVE descendants AS (
        SELECT id, 1 AS depth FROM staff WHERE reports_to = $1::uuid
        UNION ALL
        SELECT s.id, d.depth + 1 FROM staff s
        JOIN descendants d ON s.reports_to = d.id WHERE d.depth < $2::int
      ), viewer AS (
        SELECT id, department FROM staff WHERE id = $1::uuid
      ), viewer_has_reports AS (
        SELECT EXISTS (SELECT 1 FROM staff WHERE reports_to = $1::uuid) AS yes
      )
      SELECT id FROM viewer
      UNION SELECT id FROM descendants
      UNION SELECT s.id FROM staff s, viewer v, viewer_has_reports vhr
      WHERE vhr.yes AND v.department IS NOT NULL AND s.department IS NOT NULL
        AND s.department = v.department`,
    params: [SAMPLE_UUID, 10],
  },
  {
    name: 'list adjustments for review scoped to staff',
    text: `
      SELECT a.*, e.staff_id AS entry_staff_id, e.work_date::text AS entry_work_date,
             e.clock_in_at::text AS entry_clock_in_at, e.clock_out_at::text AS entry_clock_out_at,
             TRIM(COALESCE(s.first_name,'') || ' ' || COALESCE(s.last_name,'')) AS staff_full_name
      FROM attendance_adjustments a
      JOIN attendance_entries e ON e.id = a.entry_id
      JOIN staff s ON s.id = e.staff_id
      WHERE a.status = $1::text AND e.staff_id = ANY($2::uuid[])
      ORDER BY a.created_at DESC
      LIMIT $3::int`,
    params: ['pending', [SAMPLE_UUID], 50],
  },
  {
    name: 'check supervisor authority with hierarchy and department fallback',
    text: `
      WITH RECURSIVE ancestors AS (
        SELECT reports_to AS ancestor_id, 1 AS depth FROM staff WHERE id = $1::uuid
        UNION ALL
        SELECT s.reports_to, a.depth + 1 FROM staff s
        JOIN ancestors a ON s.id = a.ancestor_id
        WHERE a.ancestor_id IS NOT NULL AND a.depth < $3::int
      )
      SELECT (
        EXISTS (SELECT 1 FROM ancestors WHERE ancestor_id = $2::uuid)
        OR EXISTS (
          SELECT 1 FROM staff v, staff t
          WHERE v.id = $2::uuid AND t.id = $1::uuid
            AND v.department IS NOT NULL AND t.department IS NOT NULL
            AND v.department = t.department
            AND EXISTS (SELECT 1 FROM staff r WHERE r.reports_to = v.id)
        )
      ) AS allowed`,
    params: [SAMPLE_UUID, SAMPLE_UUID, 10],
  },
];

defineLiveSqlGate('attendance adjustment SQL live-schema gate', TEMPLATES);

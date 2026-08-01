import type { SnapshotSource } from './types';

/**
 * Registered snapshot sources. Adding one is a row here — no migration, because
 * metric_snapshots stores dims and measures as JSONB.
 *
 * Every `sql` must return exactly (entity_id, dims, measures) and must derive dates
 * from the bound `$2::date`, never from CURRENT_DATE. See SnapshotSource in types.ts.
 */
export const SNAPSHOT_SOURCES: readonly SnapshotSource[] = [
  {
    key: 'pp_open',
    description: 'Open pre-provisions — on the OES PP list and not yet activated',
    // entity_id is p.id, NOT p.serial_number: oes_pp_data holds 3,483 rows against
    // only 3,482 distinct serials (ALCLB48F4CCD appears twice), so a serial key
    // would collide. With no ON CONFLICT clause that now aborts the write loudly
    // rather than silently dropping a row.
    //
    // `IS DISTINCT FROM` rather than `<>` so a NULL resolution_status counts as
    // not-activated. Zero NULLs exist today; this is future-proofing, not a fix.
    sql: `
      SELECT
        p.id::text AS entity_id,
        jsonb_build_object(
          'project',  p.project,
          'olt_name', p.olt_name,
          'olt_pon',  p.olt_pon,
          'serial',   p.serial_number
        ) AS dims,
        jsonb_build_object(
          'age_days',          ($2::date - p.date_registered),
          'resolution_status', p.resolution_status,
          'registered_on',     p.date_registered
        ) AS measures
      FROM oes_pp_data p
      WHERE p.activated_at IS NULL
        AND p.resolution_status IS DISTINCT FROM 'activated'
    `,
  },
  {
    key: 'tickets_open',
    description: 'Open maintenance tickets by status and age',
    // maintenance_tickets.project_id is TEXT holding uuid strings, and 1,871 rows
    // hold the empty string. `''::uuid` throws, so NULLIF before casting. Today no
    // open ticket carries an empty string, so a bare cast happens to pass — that is
    // the WHERE clause protecting it, not safety.
    sql: `
      SELECT
        t.id::text AS entity_id,
        jsonb_build_object('project', p.project_name) AS dims,
        jsonb_build_object(
          'status',   t.status,
          'age_days', ($2::date - (t.created_at AT TIME ZONE 'Africa/Johannesburg')::date)
        ) AS measures
      FROM maintenance_tickets t
      LEFT JOIN projects p ON p.id = NULLIF(t.project_id, '')::uuid
      WHERE t.status NOT IN ('resolved', 'cancelled', 'verified')
    `,
  },
] as const;

export function findSource(key: string): SnapshotSource | undefined {
  return SNAPSHOT_SOURCES.find((s) => s.key === key);
}

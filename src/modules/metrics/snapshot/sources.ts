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
    // `maintenance_tickets.project_id` is TEXT and holds THREE kinds of value:
    // uuid strings, the empty string (1,871 rows), and free-text project NAMES —
    // two open tickets currently carry 'Mohadin' and 'Lawley'.
    //
    // So we must never cast it to uuid. `'Mohadin'::uuid` raises
    // "invalid input syntax for type uuid", which would abort the whole nightly
    // snapshot. A cast survives today only because of the plan PostgreSQL happens
    // to choose — a different plan, or one more bad row, and the job dies. Compare
    // as text instead: it cannot throw, whatever the column contains.
    //
    // The name arm of the join resolves those free-text rows rather than leaving
    // them dimensionless, which is the point of a conformed project dimension.
    //
    // `status IS NULL OR ...` because `NULL NOT IN (...)` evaluates to NULL, which
    // silently DROPS the row — an undercount recorded as a complete day. No NULL
    // statuses exist today (7 distinct values, none null); this is the guard, not
    // a fix. Note 'closed' is deliberately absent from the terminal list: it is not
    // a status this table uses.
    sql: `
      SELECT
        t.id::text AS entity_id,
        jsonb_build_object('project', p.project_name) AS dims,
        jsonb_build_object(
          'status',   t.status,
          'age_days', ($2::date - (t.created_at AT TIME ZONE 'Africa/Johannesburg')::date)
        ) AS measures
      FROM maintenance_tickets t
      LEFT JOIN projects p
        ON p.id::text = t.project_id
        OR p.project_name = t.project_id
      WHERE t.status IS NULL
         OR t.status NOT IN ('resolved', 'cancelled', 'verified')
    `,
  },
] as const;

export function findSource(key: string): SnapshotSource | undefined {
  return SNAPSHOT_SOURCES.find((s) => s.key === key);
}

/**
 * reportNumberGenerator.ts
 *
 * Generates unique `SCOPE-<projectCode>-<YYYYMMDD>-<seq>` report numbers.
 * Uses the `snag_report_seq` counter table (created by migration 358) combined
 * with `pg_advisory_xact_lock` to serialise concurrent generators for the
 * same project+day — guaranteeing distinct sequence values under load.
 */

import { sql, transaction } from '@/lib/db-pool';

/** Strips non-alphanumeric chars, takes first 4 chars, uppercases. */
function projectCode(name: string): string {
  return name.replace(/[^A-Za-z0-9]/g, '').slice(0, 4).toUpperCase() || 'PROJ';
}

/** UTC YYYYMMDD string from a Date. */
function yyyymmdd(d: Date): string {
  return [
    d.getUTCFullYear(),
    String(d.getUTCMonth() + 1).padStart(2, '0'),
    String(d.getUTCDate()).padStart(2, '0'),
  ].join('');
}

/**
 * Generates the next unique report number: `SCOPE-<CODE>-<YYYYMMDD>-<NNN>`.
 *
 * Atomically increments a per-(project_id, date_part) counter in
 * `snag_report_seq` using `INSERT ... ON CONFLICT DO UPDATE`.
 * The counter initialises from the count of existing `snag_reports` rows
 * matching the same prefix, so it stays consistent with externally-inserted rows.
 *
 * @param projectId - UUID of the project
 * @param when      - Date for the YYYYMMDD component (defaults to now)
 */
export async function generateScopeReportNumber(
  projectId: string,
  when: Date = new Date()
): Promise<string> {
  const projectRows = await sql<{ project_name: string }>`
    SELECT project_name FROM projects WHERE id = ${projectId} LIMIT 1
  `;
  if (projectRows.length === 0) throw new Error(`Project not found: ${projectId}`);

  const code = projectCode(projectRows[0]!.project_name);
  const datePart = yyyymmdd(when);
  const prefix = `SCOPE-${code}-${datePart}-`;

  return transaction(async (txn) => {
    // Serialise concurrent generators for the same project+day.
    await txn.query(
      `SELECT pg_advisory_xact_lock(hashtext($1)::bigint # hashtext($2)::bigint)`,
      [projectId, datePart]
    );

    // Atomically claim the next sequence slot.
    // On first use, seed from existing snag_reports rows to stay consistent.
    const rows = await txn.query<{ last_seq: number }>(
      `INSERT INTO snag_report_seq (project_id, date_part, last_seq)
       VALUES (
         $1, $2,
         (SELECT COUNT(*)::int + 1 FROM snag_reports
          WHERE project_id = $1 AND report_number LIKE $3)
       )
       ON CONFLICT (project_id, date_part) DO UPDATE
         SET last_seq = snag_report_seq.last_seq + 1
       RETURNING last_seq`,
      [projectId, datePart, `${prefix}%`]
    );

    return `${prefix}${String(rows[0]!.last_seq).padStart(3, '0')}`;
  });
}

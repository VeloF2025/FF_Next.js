/**
 * Consolidated "Unresolved Pre-Provision" worklist — every current `not_found`
 * PP serial across all projects, classified for reconciliation. Cross-project
 * companion to the per-group reports.
 *
 * @module lib/group-nonactivation/opsQueries
 */
import { pool } from '@/lib/db';
import type { ResidualClass } from './format';

export interface OpsRow {
  serial: string;
  project: string;
  residualClass: ResidualClass;
  hintDrop: string | null;
  dateRegistered: string;
  agingDays: number;
}

interface OpsRaw {
  serial_number: string;
  project: string;
  residual_class: ResidualClass;
  hint_drop: string | null;
  date_registered: string;
  aging_days: number;
}

/** All open `not_found` PP serials, classified + aged as of `asOfDateIso` (SAST). */
export async function getConsolidatedNotFound(asOfDateIso: string): Promise<OpsRow[]> {
  const { rows } = await pool.query(
    `SELECT pp.serial_number, pp.project,
            ($1::date - pp.date_registered) AS aging_days,
            pp.date_registered::text AS date_registered,
            CASE
              WHEN EXISTS (SELECT 1 FROM loeks_field_mappings l
                            WHERE UPPER(TRIM(l.ont_serial)) = UPPER(TRIM(pp.serial_number))
                              AND l.dr_number !~ '^DR[0-9]+$') THEN 'placeholder'
              WHEN EXISTS (SELECT 1 FROM onemap_properties o
                            WHERE UPPER(TRIM(o.ont_barcode)) = UPPER(TRIM(pp.serial_number))
                              AND o.drop_number IS NOT NULL)
                OR EXISTS (SELECT 1 FROM loeks_field_mappings l
                            WHERE UPPER(TRIM(l.ont_serial)) = UPPER(TRIM(pp.serial_number))
                              AND l.dr_number ~ '^DR[0-9]+$') THEN 'resolvable'
              WHEN EXISTS (SELECT 1 FROM stock_serials ss
                            WHERE UPPER(TRIM(ss.serial_number)) = UPPER(TRIM(pp.serial_number)))
                THEN 'in_stock_no_install'
              ELSE 'unknown'
            END AS residual_class,
            COALESCE(
              (SELECT o.drop_number FROM onemap_properties o
                WHERE UPPER(TRIM(o.ont_barcode)) = UPPER(TRIM(pp.serial_number))
                  AND o.drop_number IS NOT NULL LIMIT 1),
              (SELECT l.dr_number FROM loeks_field_mappings l
                WHERE UPPER(TRIM(l.ont_serial)) = UPPER(TRIM(pp.serial_number))
                  AND l.dr_number ~ '^DR[0-9]+$' LIMIT 1)
            ) AS hint_drop
       FROM oes_pp_data pp
      WHERE pp.resolution_status = 'not_found'
      ORDER BY pp.project, residual_class, aging_days DESC, pp.serial_number`,
    [asOfDateIso],
  );
  return (rows as OpsRaw[]).map((r) => ({
    serial: r.serial_number,
    project: r.project,
    residualClass: r.residual_class,
    hintDrop: r.hint_drop,
    dateRegistered: r.date_registered,
    agingDays: Number(r.aging_days),
  }));
}

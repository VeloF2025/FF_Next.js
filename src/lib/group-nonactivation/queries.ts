/**
 * Data queries for the per-group daily non-activation + PP report.
 *
 * Cohort = a group's FIRST submissions on a given day (qa_photo_reviews is one
 * row per DR, updated in place; created_at = first-seen). Bucketed against OES
 * activations and the project's pre-provision (PP) list.
 *
 * @module lib/group-nonactivation/queries
 */
import { pool } from '@/lib/db';
import { DR_CANONICAL, type ResidualClass } from './format';

export { DR_CANONICAL };
export type { ResidualClass };

/** Home-recon (pre_provision) groups explicitly in scope alongside all dr_submission groups. */
export const TARGET_HOME_RECON_JIDS = [
  '120363409368493163@g.us', // LAW Home Recon
  '120363426227615187@g.us', // MOA Home Recon
];

/** group.project_name → oes_pp_data.project (only the names that differ). */
const PP_PROJECT_MAP: Record<string, string> = {
  'Thembisa POP 1': 'TEM',
  'Thembisa POP 3': 'TEM-3',
};

export function ppProjectFor(projectName: string | null): string {
  if (!projectName) return '';
  return PP_PROJECT_MAP[projectName] ?? projectName;
}

export interface TargetGroup {
  groupJid: string;
  groupName: string;
  groupType: string;
  project: string | null;
  /** PP is project-level → shown on activations (dr_submission) groups only. */
  showPp: boolean;
}

export interface CohortRow {
  dropNumber: string;
  serial: string | null;
  lid: string | null;
  submittedSast: string | null;
  activationDate: string | null;
  activationSerial: string | null;
  onPp: boolean;
}

export interface BacklogRow {
  dropNumber: string;
  lid: string | null;
  subDate: string;
}

export interface PpRow {
  serial: string;
  resolutionStatus: string;
  resolvedDrop: string | null;
  oltName: string | null;
  oltPon: string | null;
  dateRegistered: string;
  residualClass: ResidualClass;
  hintDrop: string | null;
}

interface GroupRaw {
  group_jid: string;
  group_name: string;
  group_type: string;
  project: string;
}
interface CohortRaw {
  drop_number: string;
  serial: string | null;
  lid: string | null;
  sub_sast: string | null;
  act_date: string | null;
  act_serial: string | null;
  on_pp: boolean;
}
interface BacklogRaw {
  drop_number: string;
  lid: string | null;
  sub_date: string;
}
interface PpRaw {
  serial_number: string;
  resolution_status: string;
  resolved_drop_number: string | null;
  olt_name: string | null;
  olt_pon: string | null;
  date_registered: string;
  residual_class: ResidualClass;
  hint_drop: string | null;
}

export async function getTargetGroups(): Promise<TargetGroup[]> {
  const { rows } = await pool.query(
    `SELECT group_jid, group_name, group_type, COALESCE(project_name, '') AS project
       FROM wa_monitored_groups
      WHERE is_active
        AND (group_type = 'dr_submission' OR group_jid = ANY($1::text[]))
      ORDER BY group_name`,
    [TARGET_HOME_RECON_JIDS],
  );
  return (rows as GroupRaw[]).map((r) => ({
    groupJid: r.group_jid,
    groupName: r.group_name,
    groupType: r.group_type,
    project: r.project || null,
    showPp: r.group_type === 'dr_submission',
  }));
}

export async function getCohort(groupJid: string, dateIso: string): Promise<CohortRow[]> {
  const { rows } = await pool.query(
    `SELECT q.drop_number,
            NULLIF(q.ont_serial_scanned, '') AS serial,
            q.submitted_by AS lid,
            to_char(q.whatsapp_message_date AT TIME ZONE 'Africa/Johannesburg',
                    'YYYY-MM-DD HH24:MI') AS sub_sast,
            (SELECT a.activation_date::text FROM oes_activations a
              WHERE LOWER(a.drop_number) = LOWER(q.drop_number)
                AND a.status = 'Active' LIMIT 1) AS act_date,
            (SELECT a.serial_number FROM oes_activations a
              WHERE LOWER(a.drop_number) = LOWER(q.drop_number)
                AND a.status = 'Active' LIMIT 1) AS act_serial,
            EXISTS (SELECT 1 FROM oes_pp_data p
                     WHERE LOWER(p.resolved_drop_number) = LOWER(q.drop_number)
                        OR (q.ont_serial_scanned <> ''
                            AND UPPER(TRIM(p.serial_number)) = UPPER(TRIM(q.ont_serial_scanned)))) AS on_pp
       FROM qa_photo_reviews q
      WHERE q.wa_group_jid = $1
        AND (q.created_at AT TIME ZONE 'Africa/Johannesburg')::date = $2::date
      ORDER BY q.drop_number`,
    [groupJid, dateIso],
  );
  return (rows as CohortRaw[]).map((r) => ({
    dropNumber: r.drop_number,
    serial: r.serial,
    lid: r.lid,
    submittedSast: r.sub_sast,
    activationDate: r.act_date,
    activationSerial: r.act_serial,
    onPp: r.on_pp,
  }));
}

export async function getBacklog(
  groupJid: string,
  fromIso: string,
  toIso: string,
): Promise<BacklogRow[]> {
  const { rows } = await pool.query(
    `SELECT q.drop_number, q.submitted_by AS lid,
            (q.created_at AT TIME ZONE 'Africa/Johannesburg')::date::text AS sub_date
       FROM qa_photo_reviews q
      WHERE q.wa_group_jid = $1
        AND (q.created_at AT TIME ZONE 'Africa/Johannesburg')::date BETWEEN $2::date AND $3::date
        AND NOT EXISTS (SELECT 1 FROM oes_activations a
                         WHERE LOWER(a.drop_number) = LOWER(q.drop_number) AND a.status = 'Active')
        AND NOT EXISTS (SELECT 1 FROM oes_pp_data p
                         WHERE LOWER(p.resolved_drop_number) = LOWER(q.drop_number)
                            OR (q.ont_serial_scanned <> ''
                                AND UPPER(TRIM(p.serial_number)) = UPPER(TRIM(q.ont_serial_scanned))))
      ORDER BY sub_date, q.drop_number`,
    [groupJid, fromIso, toIso],
  );
  return (rows as BacklogRaw[]).map((r) => ({
    dropNumber: r.drop_number,
    lid: r.lid,
    subDate: r.sub_date,
  }));
}

/**
 * PP list for a project on a date (serial-keyed). For not_found rows, classify
 * the reconciliation residual and surface a likely DR hint when one exists.
 */
export async function getPpList(ppProject: string, dateIso: string): Promise<PpRow[]> {
  const { rows } = await pool.query(
    `SELECT pp.serial_number, pp.resolution_status, pp.resolved_drop_number,
            pp.olt_name, pp.olt_pon::text AS olt_pon, pp.date_registered::text AS date_registered,
            CASE
              WHEN pp.resolution_status <> 'not_found' THEN 'resolved'
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
      WHERE pp.project = $1 AND pp.date_registered = $2::date
      ORDER BY (pp.resolution_status = 'not_found') DESC, pp.resolution_status, pp.serial_number`,
    [ppProject, dateIso],
  );
  return (rows as PpRaw[]).map((r) => ({
    serial: r.serial_number,
    resolutionStatus: r.resolution_status,
    resolvedDrop: r.resolved_drop_number,
    oltName: r.olt_name,
    oltPon: r.olt_pon,
    dateRegistered: r.date_registered,
    residualClass: r.residual_class,
    hintDrop: r.hint_drop,
  }));
}

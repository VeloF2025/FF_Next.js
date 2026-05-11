/**
 * ONT Serials Master Export
 * GET /api/reports/ont-serials-export
 *
 * Exports every ONT serial in the system to Excel, across three sources:
 *   1. OES Activations  — confirmed active on Nokia OES report
 *   2. Pre-Provision    — in OES PP DATA tab, not yet activated
 *   3. Field Scan / Other — scanned from WhatsApp or 1Map, not in OES or PP
 *
 * Columns: Serial, Source, Project, DR, Zone, PON, Date Registered, Activation Date
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import * as XLSX from 'xlsx';
import { withAuth } from '@/lib/auth';
import pool from '@/lib/db';
import { log } from '@/lib/logger';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';

interface OntSerialRow {
  serial_number: string;
  source: string;
  project: string | null;
  dr_number: string | null;
  zone_no: number | null;
  zone_code: string | null;
  pon_no: number | null;
  pon_code: string | null;
  date_registered: string | null;
  activation_date: string | null;
}

const QUERY = `
  SELECT
    oa.serial_number,
    'OES'::text                           AS source,
    COALESCE(p.project_name, oa.team)     AS project,
    oa.drop_number                        AS dr_number,
    d.zone_no,
    d.zone_code,
    d.pon_no,
    d.pon_code,
    oa.activation_date::text              AS date_registered,
    oa.activation_date::text              AS activation_date
  FROM oes_activations oa
  LEFT JOIN drops    d ON LOWER(TRIM(d.drop_number)) = LOWER(TRIM(oa.drop_number))
  LEFT JOIN projects p ON p.id = d.project_id

  UNION ALL

  SELECT
    pp.serial_number,
    'Pre-Provision'::text                 AS source,
    pp.project,
    pp.resolved_drop_number               AS dr_number,
    d.zone_no,
    d.zone_code,
    d.pon_no,
    d.pon_code,
    pp.date_registered::text              AS date_registered,
    NULL::text                            AS activation_date
  FROM oes_pp_data pp
  LEFT JOIN drops d ON LOWER(TRIM(d.drop_number)) = LOWER(TRIM(pp.resolved_drop_number))
  WHERE NOT EXISTS (
    SELECT 1 FROM oes_activations oa WHERE oa.serial_number = pp.serial_number
  )

  UNION ALL

  SELECT
    ur.ont_serial_scanned                 AS serial_number,
    CASE
      WHEN ur.photo_source ILIKE '%1map%' THEN '1Map Scan'
      ELSE 'Field Scan'
    END                                   AS source,
    ur.project,
    ur.drop_number                        AS dr_number,
    d.zone_no,
    d.zone_code,
    d.pon_no,
    d.pon_code,
    ur.submitted_date::text               AS date_registered,
    ur.oes_activated_at::date::text       AS activation_date
  FROM dr_photo_unified_reviews ur
  LEFT JOIN drops d ON LOWER(TRIM(d.drop_number)) = LOWER(TRIM(ur.drop_number))
  WHERE ur.ont_serial_scanned IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM oes_activations oa WHERE oa.serial_number = ur.ont_serial_scanned
    )
    AND NOT EXISTS (
      SELECT 1 FROM oes_pp_data pp WHERE pp.serial_number = ur.ont_serial_scanned
    )

  ORDER BY
    CASE source
      WHEN 'OES'           THEN 1
      WHEN 'Pre-Provision' THEN 2
      ELSE                      3
    END,
    COALESCE(activation_date, date_registered) DESC NULLS LAST
`;

function toExcel(rows: OntSerialRow[]): Buffer {
  const headers = [
    'Serial Number',
    'Source',
    'Project',
    'DR Number',
    'Zone No',
    'Zone Code',
    'PON No',
    'PON Code',
    'Date Registered',
    'Activation Date',
  ];

  const data = rows.map((r) => [
    r.serial_number ?? '',
    r.source ?? '',
    r.project ?? '',
    r.dr_number ?? '',
    r.zone_no ?? '',
    r.zone_code ?? '',
    r.pon_no ?? '',
    r.pon_code ?? '',
    r.date_registered ?? '',
    r.activation_date ?? '',
  ]);

  const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
  ws['!cols'] = [
    { wch: 20 }, // Serial Number
    { wch: 14 }, // Source
    { wch: 18 }, // Project
    { wch: 14 }, // DR Number
    { wch: 9 },  // Zone No
    { wch: 12 }, // Zone Code
    { wch: 8 },  // PON No
    { wch: 12 }, // PON Code
    { wch: 16 }, // Date Registered
    { wch: 16 }, // Activation Date
  ];

  ws['!freeze'] = { xSplit: 0, ySplit: 1 };

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'ONT Serials');

  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.error(res, ErrorCode.METHOD_NOT_ALLOWED, 'Method not allowed');
  }

  try {
    const result = await pool.query<OntSerialRow>(QUERY);
    const rows = result.rows;

    log.info(`Exporting ${rows.length} ONT serials`, undefined, 'OntSerialsExport');

    const filename = `ont-serials-${new Date().toISOString().slice(0, 10)}.xlsx`;
    const excel = toExcel(rows);

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.status(200).send(excel);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    log.error('Export failed', { message: msg }, 'OntSerialsExport');
    return apiResponse.error(res, ErrorCode.INTERNAL_ERROR, msg);
  }
}

export default withAuth(handler);

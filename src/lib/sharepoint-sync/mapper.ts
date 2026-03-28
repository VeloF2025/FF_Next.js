/**
 * SP Tracker Column Mapper and Coercion Functions
 */

import type { SpPonRow } from './types';

export const COL_MAP: Record<string, keyof SpPonRow> = {
  Zone: 'zone_no',
  'HLD PON': 'hld_pon',
  'Z PON': 'z_pon',
  'OLT Port': 'olt_port',
  'Scope - Poles': 'scope_poles',
  'Scope - Drops': 'scope_drops',
  'Scope - String': 'scope_string',
  'Pole Perm': 'pole_perm',
  'Poles Planted': 'poles_planted',
  'Sign-ups': 'sign_ups',
  'CWC - Poles': 'cwc_poles_date',
  'CWC - Stringing': 'cwc_stringing_date',
  'Ready For Optical': 'ready_for_optical_date',
  'Ready For Optical (RFO)': 'ready_for_optical_date',
  'CWC - QA Approved': 'cwc_qa_approved',
  'Optical - Splicing': 'optical_splicing_date',
  'Optical - Submitted': 'optical_submitted_date',
  'Optical - Activated': 'optical_activated_date',
  'Optical - Activated (ATP)': 'optical_activated_date',
  'ATP - QA Approved': 'atp_qa_approved',
  'Homes - PO': 'homes_po',
  'Homes - Recon': 'homes_recon',
  Activated: 'activated',
  Available: 'available',
  'PON Age': 'pon_age_days',
  'PON Age (Days)': 'pon_age_days',
  '% - Original': 'pct_original',
  '% - Recon': 'pct_recon',
  Blockage: 'blockage',
};

export function excelDateToISO(val: unknown): string | null {
  if (!val || val === 0) return null;
  if (typeof val === 'number' && val > 1000) {
    const d = new Date(Date.UTC(1899, 11, 30) + val * 86400000);
    return d.toISOString().split('T')[0];
  }
  if (typeof val === 'string' && val.match(/^\d{4}-\d{2}/)) {
    return val.substring(0, 10);
  }
  return null;
}

export function coerceNumber(val: unknown): number | null {
  if (val === null || val === undefined || val === '') return null;
  const n = Number(val);
  return Number.isNaN(n) ? null : n;
}

export function coerceDecimal(val: unknown): number | null {
  if (val === null || val === undefined || val === '') return null;
  const n = Number(val);
  return Number.isNaN(n) ? null : Math.min(Math.max(n, 0), 1);
}

export function mapRowData(rowData: unknown[], headerMap: Map<number, keyof SpPonRow>): Partial<SpPonRow> {
  const row: Partial<SpPonRow> = {};
  for (const [colIdx, dbCol] of headerMap) {
    const rawVal = Array.isArray(rowData) ? rowData[colIdx] : null;

    if (
      dbCol === 'cwc_poles_date' ||
      dbCol === 'cwc_stringing_date' ||
      dbCol === 'ready_for_optical_date' ||
      dbCol === 'optical_splicing_date' ||
      dbCol === 'optical_submitted_date' ||
      dbCol === 'optical_activated_date'
    ) {
      row[dbCol] = excelDateToISO(rawVal);
    } else if (dbCol === 'pct_original' || dbCol === 'pct_recon') {
      row[dbCol] = coerceDecimal(rawVal);
    } else if (dbCol === 'cwc_qa_approved' || dbCol === 'atp_qa_approved') {
      row[dbCol] = coerceNumber(rawVal) ? 1 : 0;
    } else if (dbCol === 'blockage') {
      row[dbCol] = rawVal ? String(rawVal).trim() || null : null;
    } else {
      row[dbCol] = coerceNumber(rawVal);
    }
  }
  return row;
}

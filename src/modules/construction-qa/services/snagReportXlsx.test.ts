import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { buildScopeSnagWorkbook } from './snagReportXlsx';
import type { SnagReportMeta, SnagReportScopeRow } from './snagReportRenderer';

const meta: SnagReportMeta = {
  reportNumber: 'SCOPE-LAWL-20260520-001',
  projectName: 'Lawley',
  scope: 'zone',
  zones: [24], pons: [], poles: [],
  fromDate: '2026-04-20', toDate: '2026-05-20',
  severities: ['critical', 'major', 'minor'],
  categories: ['pole_quality'],
  generatedAt: '2026-05-20T02:30:00Z',
  generatedBy: 'test',
};

const rows: SnagReportScopeRow[] = [{
  id: 's1', snag_number: 1, category: 'pole_quality', severity: 'major', status: 'open',
  description: 'Pole leaning', zone_no: 24, pon_no: 265, pole_number: 'LAW.P.X001',
  pole_qa_photo_id: 'p1', slot_key: 'civil_after', created_at: '2026-05-19T10:00:00Z',
  noc_ticket_uid: 'NOC-12345',
}];

describe('buildScopeSnagWorkbook', () => {
  it('produces a 3-sheet workbook (Summary, Snags, Scope)', () => {
    const wb = buildScopeSnagWorkbook(meta, rows);
    expect(wb.SheetNames).toEqual(['Summary', 'Snags', 'Scope']);
  });

  it('Snags sheet uses ISO dates (no locale strings)', () => {
    const wb = buildScopeSnagWorkbook(meta, rows);
    const snags = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets.Snags!);
    expect(snags[0]!.created_at).toBe('2026-05-19');
  });

  it('Summary KPIs reflect row counts', () => {
    const wb = buildScopeSnagWorkbook(meta, rows);
    const sum = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets.Summary!);
    const totalRow = sum.find(r => r.label === 'Total snags');
    expect(totalRow?.value).toBe(1);
    const majorRow = sum.find(r => r.label === 'Major');
    expect(majorRow?.value).toBe(1);
  });

  it('Scope sheet describes the parameters used', () => {
    const wb = buildScopeSnagWorkbook(meta, rows);
    const scope = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets.Scope!);
    const zonesRow = scope.find(r => r.label === 'zones');
    expect(zonesRow?.value).toBe('24');
  });

  it('handles empty rows array — totals all zero', () => {
    const wb = buildScopeSnagWorkbook(meta, []);
    const sum = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets.Summary!);
    expect(sum.find(r => r.label === 'Total snags')?.value).toBe(0);
  });
});

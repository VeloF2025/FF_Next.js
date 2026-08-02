import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';

import { serializeReportCsv, serializeReportXlsx } from '../exportSerializers';
import type { ReportColumn } from '../types';

const COLUMNS: ReadonlyArray<ReportColumn> = [
  { key: 'worker', label: 'Worker' },
  { key: 'approved_days', label: 'Approved', format: 'integer' },
  { key: 'approved_regular_hours', label: 'Ordinary', format: 'number' },
  { key: 'lock_versions', label: 'Lock versions' },
];

function readSheet(buffer: Buffer): unknown[][] {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  return XLSX.utils.sheet_to_json(workbook.Sheets['payroll-readiness']!, { header: 1 });
}

describe('attendance report export serializers', () => {
  it('serializes empty scope as header-only CSV and XLSX', () => {
    expect(serializeReportCsv([], COLUMNS)).toBe('Worker,Approved,Ordinary,Lock versions');
    expect(readSheet(serializeReportXlsx([], COLUMNS, 'payroll-readiness'))).toEqual([
      ['Worker', 'Approved', 'Ordinary', 'Lock versions'],
    ]);
  });

  it('preserves report column order and values identically in CSV and XLSX', () => {
    const rows = [{
      lock_versions: '1,2,10', approved_regular_hours: 24.126,
      worker: 'Alice "A", Worker', approved_days: 4,
    }];
    expect(serializeReportCsv(rows, COLUMNS)).toBe(
      'Worker,Approved,Ordinary,Lock versions\r\n"Alice ""A"", Worker",4,24.13,"1,2,10"',
    );
    expect(readSheet(serializeReportXlsx(rows, COLUMNS, 'payroll-readiness'))).toEqual([
      ['Worker', 'Approved', 'Ordinary', 'Lock versions'],
      ['Alice "A", Worker', 4, 24.13, '1,2,10'],
    ]);
  });

  it.each(['=2+3', '+cmd', '-cmd', '@cmd'])('neutralizes CSV formula prefix %s without changing XLSX text', (worker) => {
    const rows = [{ worker, approved_days: 1, approved_regular_hours: 8, lock_versions: '3' }];

    expect(serializeReportCsv(rows, COLUMNS).split('\r\n')[1]).toBe(`'${worker},1,8,3`);
    expect(readSheet(serializeReportXlsx(rows, COLUMNS, 'payroll-readiness'))[1]?.[0]).toBe(worker);
  });
});

/**
 * Shared fixtures for the two workbook suites — the rendering one and the
 * disclosure one. Kept beside them rather than duplicated: the two suites have
 * to agree on what a default report looks like, or a row one of them proves is
 * absent is a row the other never asked for.
 */
import ExcelJS from 'exceljs';
import { buildOperationsWorkbook } from '../operationsWorkbook';
import type { OperationsWorkbookMetadata } from '../operationsWorkbook';
import type { OperationsAnalyticsResponse, OperationsMetricValue } from '../types';

export const PROJECT = '33333333-3333-4333-8333-333333333333';

export const metadata: OperationsWorkbookMetadata = {
  generatedAt: '2026-08-25T09:30:00.000Z',
  scopeLabel: 'Projects you manage',
  anonymityMinContributors: 5,
};

export function value(over: Partial<OperationsMetricValue> & { metricKey: string }): OperationsMetricValue {
  return {
    numerator: 0, denominator: null, histogram: null, coverage: { months: 1, of: 1 },
    ...over,
  } as OperationsMetricValue;
}

export function report(over: Partial<OperationsAnalyticsResponse> = {}): OperationsAnalyticsResponse {
  return {
    filters: { start: '2026-01-01', end: '2026-03-31' },
    metricVersion: 1,
    retainedDetailFrom: '2026-02-01',
    cards: [value({ metricKey: 'incident.late', numerator: 12, coverage: { months: 3, of: 3 } })],
    series: [
      { monthStart: '2026-01-01', values: [value({ metricKey: 'incident.late', numerator: 5 })] },
      { monthStart: '2026-02-01', values: [value({ metricKey: 'incident.late', numerator: 7 })] },
    ],
    suppressionNotices: [],
    freshness: { aggregatesThrough: '2026-07-01', lastRunStatus: 'succeeded' },
    ...over,
  } as OperationsAnalyticsResponse;
}

/** Builds the workbook and reads it back, so every assertion is made on the file. */
export async function open(
  response: OperationsAnalyticsResponse, meta = metadata,
): Promise<ExcelJS.Workbook> {
  const buffer = await buildOperationsWorkbook(response, meta);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  return workbook;
}

/** Every cell value in the workbook, as the strings a reader would see. */
export function everyCellText(workbook: ExcelJS.Workbook): string[] {
  const texts: string[] = [];
  workbook.eachSheet((sheet) => {
    sheet.eachRow((row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        if (cell.value !== null && cell.value !== undefined) texts.push(String(cell.text));
      });
    });
  });
  return texts;
}

/** One sheet's rows as arrays of display text, header row included. */
export function rowsOf(workbook: ExcelJS.Workbook, name: string): string[][] {
  const sheet = workbook.getWorksheet(name);
  if (!sheet) throw new Error(`no sheet named ${name}`);
  const rows: string[][] = [];
  sheet.eachRow((row) => {
    const cells: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell) => { cells.push(cell.text); });
    rows.push(cells);
  });
  return rows;
}

export function rowStartingWith(workbook: ExcelJS.Workbook, sheet: string, first: string): string[] {
  const found = rowsOf(workbook, sheet).find((row) => row[0] === first);
  if (!found) throw new Error(`no row starting with ${first} on ${sheet}`);
  return found;
}

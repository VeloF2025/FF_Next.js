/**
 * The operations analytics report as a workbook (stage 8 task 8).
 *
 * It renders an `OperationsAnalyticsResponse` and derives nothing of its own:
 * the endpoint builds it from the same service, parsed by the same
 * `operationsFilters`, that answers the screen. That is the whole design
 * constraint. An export with its own query or its own filter parser is an
 * export that eventually disagrees with the screen it was taken from, and a
 * reader holding the file has no way to tell which of the two is wrong.
 *
 * Three sheets, at the same grain the response uses:
 *
 * - **Summary** — one row per card, the figures for the whole range.
 * - **Monthly Trends** — one row per month and metric, each month labelled with
 *   the side of the retention boundary it came from.
 * - **Metadata** — the filters applied, the scope, the boundary, the freshness
 *   of the aggregates behind the historic half, and every suppression notice.
 *
 * There is deliberately no per-incident sheet. The drill-down endpoint answers
 * in incident ids, which are opened in the queue where the viewer's scope is
 * enforced per incident; a spreadsheet of incident rows would be that data
 * outside the system that governs it, and nothing in the response carries it.
 */
import ExcelJS from 'exceljs';
import type { OperationsAnalyticsResponse, OperationsFilters, OperationsMetricValue } from './types';
import {
  NO_FIGURES, NO_FIGURES_AT_ALL, coverageText, figureCells, safeText,
} from './operationsWorkbookCells';

export { NOT_RETAINED } from './operationsWorkbookCells';

export interface OperationsWorkbookMetadata {
  /** ISO instant. Stated on the file so two exports of the same range are distinguishable. */
  generatedAt: string;
  /** What the figures cover, in the viewer's terms. Never a role name. */
  scopeLabel: string;
  /** The effective `k`. Read from the settings, never restated here. */
  anonymityMinContributors: number;
}

const PERCENT_FORMAT = '0.0%';

const SUMMARY_HEADERS = [
  'Metric', 'Count', 'Out of', 'Percentage', 'Samples', 'Average (seconds)',
  'Median bucket', 'Months covered',
];

const TREND_HEADERS = [
  'Month', 'Metric', 'Count', 'Out of', 'Percentage', 'Samples', 'Average (seconds)',
  'Median bucket', 'Source',
];

/**
 * Each `op_` filter under the name it is given on the query string, in the
 * parser's order, absent ones included.
 *
 * A filter that was not applied has to be stated as not applied. Omitting it
 * leaves a reader unable to tell a filter nobody set from one the export forgot
 * to mention, and those two files describe different populations.
 */
function filterRows(filters: OperationsFilters): [string, string][] {
  const given: [string, string | undefined][] = [
    ['op_start', filters.start],
    ['op_end', filters.end],
    ['op_project', filters.projectId],
    ['op_manager', filters.managerUserId],
    ['op_site', filters.operationalSiteId],
    ['op_driver', filters.staffId],
    ['op_vehicle', filters.vehicleId],
    ['op_type', filters.incidentType],
    ['op_severity', filters.severity],
    ['op_outcome', filters.outcome],
    ['op_evidence', filters.evidenceAvailable === undefined ? undefined : String(filters.evidenceAvailable)],
  ];
  return given.map(([name, value]) => [name, value ?? '(no filter)']);
}

/** Where a month's figures came from, decided by the one boundary the response states. */
function sourceOf(monthStart: string, retainedDetailFrom: string): string {
  return monthStart >= retainedDetailFrom ? 'Retained detail' : 'Published aggregate';
}

/** Writes a row, neutralising every string and formatting every percentage cell. */
function addRow(
  sheet: ExcelJS.Worksheet, cells: readonly (string | number | null)[], percentageColumn: number | null,
): ExcelJS.Row {
  const row = sheet.addRow(cells.map((cell) => (typeof cell === 'string' ? safeText(cell) : cell)));
  if (percentageColumn !== null && typeof cells[percentageColumn - 1] === 'number') {
    row.getCell(percentageColumn).numFmt = PERCENT_FORMAT;
  }
  return row;
}

function addHeader(sheet: ExcelJS.Worksheet, headers: readonly string[]): void {
  const row = sheet.addRow([...headers]);
  row.font = { bold: true };
}

function summaryRow(value: OperationsMetricValue): (string | number | null)[] {
  return [value.metricKey, ...figureCells(value), coverageText(value.coverage)];
}

function addSummary(workbook: ExcelJS.Workbook, report: OperationsAnalyticsResponse): void {
  const sheet = workbook.addWorksheet('Summary');
  addHeader(sheet, SUMMARY_HEADERS);
  if (report.cards.length === 0) {
    addRow(sheet, [NO_FIGURES_AT_ALL], null);
    return;
  }
  for (const card of report.cards) addRow(sheet, summaryRow(card), 4);
}

/**
 * Omitted entirely when there is no series, rather than written as a sheet of
 * headings — an empty grid is the shape a reader takes for "we looked and there
 * was nothing", which is a claim this file is not in a position to make.
 */
function addTrends(workbook: ExcelJS.Workbook, report: OperationsAnalyticsResponse): void {
  if (report.series.length === 0) return;
  const sheet = workbook.addWorksheet('Monthly Trends');
  addHeader(sheet, TREND_HEADERS);
  for (const month of report.series) {
    const source = sourceOf(month.monthStart, report.retainedDetailFrom);
    if (month.values.length === 0) {
      // Kept rather than skipped: a month absent from the sheet reads as a
      // month outside the range, and this one is inside it and reported nothing.
      addRow(sheet, [month.monthStart, NO_FIGURES, null, null, null, null, null, null, source], null);
      continue;
    }
    for (const value of month.values) {
      addRow(sheet, [month.monthStart, value.metricKey, ...figureCells(value), source], 5);
    }
  }
}

/** The freshness of the aggregates the historic half was read from, said plainly. */
function freshnessRows(report: OperationsAnalyticsResponse): [string, string][] {
  const { aggregatesThrough, lastRunStatus } = report.freshness;
  const rows: [string, string][] = [
    ['Aggregates through', aggregatesThrough ?? 'none recorded'],
    ['Last aggregation run', lastRunStatus ?? 'never run'],
  ];
  if (lastRunStatus === 'succeeded' && aggregatesThrough !== null) return rows;
  rows.push(['Warning',
    'The nightly aggregation did not last complete successfully, so months before the retention '
    + 'boundary may be incomplete or out of date. Figures for those months are missing, not zero.']);
  return rows;
}

function addMetadata(
  workbook: ExcelJS.Workbook, report: OperationsAnalyticsResponse, metadata: OperationsWorkbookMetadata,
): void {
  const sheet = workbook.addWorksheet('Metadata');
  addHeader(sheet, ['Field', 'Value']);
  const rows: [string, string | number][] = [
    ['Report', 'Fleet operations analytics'],
    ['Generated at (UTC)', metadata.generatedAt],
    ['Scope', metadata.scopeLabel],
    ['Metric version', report.metricVersion],
    ['Anonymity threshold', metadata.anonymityMinContributors],
    ['Retention boundary', report.retainedDetailFrom],
    ['', `Months from ${report.retainedDetailFrom} are derived from retained operational detail. `
      + 'Earlier months are read from published anonymous monthly aggregates, which carry counts '
      + 'but no durations and describe groups of at least the anonymity threshold above.'],
    ...freshnessRows(report),
    ...filterRows(report.filters),
  ];
  for (const row of rows) addRow(sheet, row, null);

  addRow(sheet, [''], null);
  addHeader(sheet, ['Notes']);
  if (report.suppressionNotices.length === 0) {
    addRow(sheet, ['None. Nothing was withheld from the figures above.'], null);
    return;
  }
  for (const notice of report.suppressionNotices) addRow(sheet, [notice], null);
}

export async function buildOperationsWorkbook(
  report: OperationsAnalyticsResponse, metadata: OperationsWorkbookMetadata,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  addSummary(workbook, report);
  addTrends(workbook, report);
  addMetadata(workbook, report, metadata);
  for (const sheet of workbook.worksheets) {
    sheet.columns.forEach((column) => { column.width = column.width ?? 22; });
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

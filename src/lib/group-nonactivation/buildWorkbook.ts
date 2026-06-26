/**
 * exceljs workbook builder for one group's daily non-activation + PP report.
 * Tabs: Summary / Not Activated / Pre-Provision (activations groups only) / Activated.
 *
 * @module lib/group-nonactivation/buildWorkbook
 */
import ExcelJS from 'exceljs';
import type { TargetGroup, CohortRow, BacklogRow, PpRow } from './queries';
import { isCanonicalDr, dayDiffIso, RESIDUAL_LABEL } from './format';

const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF305496' } };
const HEADER_FONT: Partial<ExcelJS.Font> = { bold: true, color: { argb: 'FFFFFFFF' } };
const MISS_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFCE4D6' } };
const DQ_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } };
const OK_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2EFDA' } };

export interface GroupReportData {
  group: TargetGroup;
  cohort: CohortRow[];
  backlog: BacklogRow[];
  ppList: PpRow[];
  cohortDate: string;
  generatedDate: string;
}

export interface GroupReportCounts {
  cohort: number;
  activated: number;
  miss: number;
  pp: number;
  ppNotFound: number;
  backlog: number;
  typos: number;
}

function styleHeaderRow(row: ExcelJS.Row): void {
  row.eachCell((cell: ExcelJS.Cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  });
  row.height = 18;
}

function autosize(ws: ExcelJS.Worksheet): void {
  ws.columns.forEach((col: Partial<ExcelJS.Column>) => {
    let width = 10;
    col.eachCell?.({ includeEmpty: false }, (cell: ExcelJS.Cell) => {
      const len = cell.value == null ? 0 : String(cell.value).length;
      if (len + 2 > width) width = len + 2;
    });
    col.width = Math.min(Math.max(width, 10), 48);
  });
}

function addSummary(wb: ExcelJS.Workbook, d: GroupReportData, c: GroupReportCounts): void {
  const ws = wb.addWorksheet('Summary');
  ws.addRow([`${d.group.groupName} — Non-activation report`]);
  ws.getCell('A1').font = { bold: true, size: 14 };
  ws.addRow([`Project: ${d.group.project ?? '—'}   |   Group type: ${d.group.groupType}`]);
  ws.addRow([`Cohort (first submissions): ${d.cohortDate}   |   Generated: ${d.generatedDate}`]);
  ws.addRow([]);
  styleHeaderRow(ws.addRow(["Yesterday's submissions in this group", 'Count']));
  ws.addRow(['Activated', c.activated]);
  ws.addRow(['Not activated', c.miss]);
  ws.addRow(['  of which likely-typo DR numbers', c.typos]);
  ws.addRow(['TOTAL submitted', c.cohort]);
  ws.addRow(['Carried-over backlog (older, still open)', c.backlog]);
  if (d.group.showPp) {
    ws.addRow([]);
    styleHeaderRow(ws.addRow(['Pre-provision serials added yesterday', c.pp]));
    ws.addRow(['  of which not_found (needs reconciliation)', c.ppNotFound]);
  }
  ws.addRow([]);
  styleHeaderRow(ws.addRow(['Misses by submitter (yesterday)', 'Count']));
  const bySubmitter = new Map<string, number>();
  for (const m of d.cohort.filter((r) => !r.activationDate && !r.onPp)) {
    const key = m.lid ?? '(unknown)';
    bySubmitter.set(key, (bySubmitter.get(key) ?? 0) + 1);
  }
  [...bySubmitter.entries()]
    .sort((a, b) => b[1] - a[1])
    .forEach(([lid, n]) => ws.addRow([lid, n]));
  autosize(ws);
}

function addNotActivated(wb: ExcelJS.Workbook, d: GroupReportData): void {
  const ws = wb.addWorksheet('Not Activated');
  styleHeaderRow(
    ws.addRow(['DR Number', 'Submitter (WA LID)', 'Submitted (SAST)', 'Aging (days)', 'Status', 'Data-quality flag']),
  );
  const addRow = (dr: string, lid: string | null, sub: string, aging: number, status: string): void => {
    const flag = isCanonicalDr(dr) ? '' : '⚠ MALFORMED DR (likely typo)';
    const row = ws.addRow([dr, lid ?? '', sub, aging, status, flag]);
    row.getCell(5).fill = MISS_FILL;
    if (flag) row.getCell(6).fill = DQ_FILL;
  };
  const aging = dayDiffIso(d.cohortDate, d.generatedDate);
  d.cohort
    .filter((r) => !r.activationDate && !r.onPp)
    .forEach((r) => addRow(r.dropNumber, r.lid, r.submittedSast ?? '', aging, 'NEW (yesterday)'));
  d.backlog.forEach((r) =>
    addRow(r.dropNumber, r.lid, r.subDate, dayDiffIso(r.subDate, d.generatedDate), 'CARRIED-OVER'),
  );
  autosize(ws);
}

function addPreProvision(wb: ExcelJS.Workbook, d: GroupReportData): void {
  const ws = wb.addWorksheet('Pre-Provision');
  styleHeaderRow(
    ws.addRow(['ONT Serial', 'Reason / status', 'Resolved/likely DR', 'Reconciliation', 'OLT', 'PON', 'Registered']),
  );
  d.ppList.forEach((r) => {
    const dr = r.resolvedDrop ?? r.hintDrop ?? '';
    const recon = r.resolutionStatus === 'not_found' ? RESIDUAL_LABEL[r.residualClass] : '';
    const row = ws.addRow([r.serial, r.resolutionStatus, dr, recon, r.oltName ?? '', r.oltPon ?? '', r.dateRegistered]);
    row.getCell(1).fill = DQ_FILL;
  });
  autosize(ws);
}

function addActivated(wb: ExcelJS.Workbook, d: GroupReportData): void {
  const ws = wb.addWorksheet('Activated');
  styleHeaderRow(
    ws.addRow(['DR Number', 'ONT Serial (OES)', 'Submitter (WA LID)', 'Submitted (SAST)', 'Activation date']),
  );
  d.cohort
    .filter((r) => r.activationDate)
    .forEach((r) => {
      const row = ws.addRow([r.dropNumber, r.activationSerial ?? '', r.lid ?? '', r.submittedSast ?? '', r.activationDate ?? '']);
      row.getCell(5).fill = OK_FILL;
    });
  autosize(ws);
}

export async function buildGroupWorkbook(
  d: GroupReportData,
): Promise<{ buffer: Buffer; counts: GroupReportCounts }> {
  const counts: GroupReportCounts = {
    cohort: d.cohort.length,
    activated: d.cohort.filter((r) => r.activationDate).length,
    miss: d.cohort.filter((r) => !r.activationDate && !r.onPp).length,
    pp: d.ppList.length,
    ppNotFound: d.ppList.filter((r) => r.resolutionStatus === 'not_found').length,
    backlog: d.backlog.length,
    typos: d.cohort.filter((r) => !r.activationDate && !r.onPp && !isCanonicalDr(r.dropNumber)).length,
  };

  const wb = new ExcelJS.Workbook();
  addSummary(wb, d, counts);
  addNotActivated(wb, d);
  if (d.group.showPp) addPreProvision(wb, d);
  addActivated(wb, d);

  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  return { buffer, counts };
}

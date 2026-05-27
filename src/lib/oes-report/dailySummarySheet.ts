import ExcelJS from 'exceljs';
import type { DailySummary, DailyCount } from './dailySummaryQueries';
import type { SiteCode } from './queries';
import { siteLabel } from './queries';

const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' },
};
const HEADER_FONT: Partial<ExcelJS.Font> = {
  bold: true, color: { argb: 'FFFFFFFF' },
};

const SECTION_FILL: ExcelJS.Fill = {
  type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF374151' },
};
const SECTION_FONT: Partial<ExcelJS.Font> = {
  bold: true, color: { argb: 'FFFFFFFF' },
};

const TOTAL_FONT: Partial<ExcelJS.Font> = { bold: true };

function pivot(counts: DailyCount[]): Map<string, Map<string, number>> {
  // key: site → (day → count)
  const m = new Map<string, Map<string, number>>();
  for (const c of counts) {
    let inner = m.get(c.site);
    if (!inner) { inner = new Map(); m.set(c.site, inner); }
    inner.set(c.day, c.count);
  }
  return m;
}

function addSection(
  sheet: ExcelJS.Worksheet,
  title: string,
  sites: SiteCode[],
  days: string[],
  counts: DailyCount[],
): void {
  const sectionRow = sheet.addRow([title, ...days.map(() => ''), '']);
  sectionRow.eachCell((cell: ExcelJS.Cell) => {
    cell.fill = SECTION_FILL;
    cell.font = SECTION_FONT;
  });

  const data = pivot(counts);
  const dayTotals = days.map(() => 0);

  for (const site of sites) {
    const inner = data.get(site);
    const rowValues: (string | number)[] = [siteLabel(site)];
    let siteTotal = 0;
    days.forEach((d, i) => {
      const n = inner?.get(d) ?? 0;
      rowValues.push(n);
      siteTotal += n;
      dayTotals[i]! += n;
    });
    rowValues.push(siteTotal);
    sheet.addRow(rowValues);
  }

  const grand = dayTotals.reduce((a, b) => a + b, 0);
  const totalRow = sheet.addRow(['Total', ...dayTotals, grand]);
  totalRow.font = TOTAL_FONT;
  totalRow.eachCell((cell: ExcelJS.Cell) => {
    cell.border = { top: { style: 'thin', color: { argb: 'FF9CA3AF' } } };
  });

  sheet.addRow([]);
}

export function addDailySummarySheet(
  wb: ExcelJS.Workbook,
  summary: DailySummary,
): ExcelJS.Worksheet {
  const sheet = wb.addWorksheet('Daily Summary');
  const { days, sites } = summary;

  // Column widths: 22 for label, 12 per date, 10 for row-total
  sheet.columns = [
    { width: 22 },
    ...days.map(() => ({ width: 12 })),
    { width: 10 },
  ];

  const headerRow = sheet.addRow(['Site', ...days, 'Total']);
  headerRow.eachCell((cell: ExcelJS.Cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  });
  headerRow.getCell(1).alignment = { horizontal: 'left' };
  headerRow.height = 18;
  sheet.addRow([]);

  addSection(sheet, 'Activations',          sites, days, summary.activations);
  addSection(sheet, "PP's (new that day)",  sites, days, summary.ppsNew);
  addSection(sheet, "PP's (outstanding)",   sites, days, summary.ppsOutstanding);
  addSection(sheet, 'Disputes',             sites, days, summary.disputes);

  return sheet;
}

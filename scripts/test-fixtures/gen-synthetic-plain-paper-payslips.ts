/**
 * Regenerate the synthetic Plain Paper payslips test fixture.
 *
 * Run from the repo root:
 *   npx tsx scripts/test-fixtures/gen-synthetic-plain-paper-payslips.ts
 *
 * Output:
 *   src/modules/payslips/__tests__/fixtures/synthetic-plain-paper-payslips.pdf
 *
 * Mimics Sage's "Plain Paper Payslip" export, which Velocity moved to in July
 * 2026 — one page per employee. Two properties of that template are what the
 * parser depends on, so the fixture reproduces both:
 *
 *   1. Each row's text items land in the content stream right-to-left, so
 *      pdfjs emits the *value before its label* ("VF002\tEmployee Code").
 *      `drawRow` therefore draws its items in reverse x order.
 *   2. Long employee names wrap onto their own lines, with the "known as"
 *      name in parentheses beneath, and the "Employee" label below that.
 *
 * Amounts use a space thousands separator, as Sage does.
 *
 * All names, IDs and amounts are entirely fictional; no real payroll data ever
 * enters the repo (POPIA + standard test-data hygiene).
 *
 * If you regenerate this file, also update the page-count / first-row
 * assertions in `pdfSplitter.test.ts`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

interface SyntheticEmp {
  code: string;
  /** Full name as Sage prints it, without the known-as suffix. */
  name: string;
  knownAs: string;
  /** null models an employee with no ID captured in Sage. */
  id: string | null;
  jobTitle: string;
  /** Pre-formatted with a space thousands separator, as Sage prints them. */
  earnings: string;
  deductions: string;
  nett: string;
  /** Sage wraps names past ~24 chars onto their own lines. */
  wrapName: boolean;
}

const STAFF: SyntheticEmp[] = [
  {
    code: 'AC002',
    name: 'JANE DOE',
    knownAs: 'JANE',
    id: '8001015009088',
    jobTitle: 'Projects Administrator',
    earnings: '25 000.00',
    deductions: '3 558.12',
    nett: '21 441.88',
    wrapName: false,
  },
  {
    code: 'AC022',
    name: 'PIETER JOHANNES VAN NIEKERK',
    knownAs: 'PIETER',
    id: '8703165009086',
    jobTitle: 'Network Planner',
    earnings: '30 000.00',
    deductions: '4 858.12',
    nett: '25 141.88',
    wrapName: true,
  },
  {
    code: 'AC032',
    name: 'THABO GLADWELL MOKOENA',
    knownAs: 'THABO',
    id: null,
    jobTitle: 'Fibre Maintenance Technician',
    earnings: '22 701.87',
    deductions: '2 960.61',
    nett: '19 741.26',
    wrapName: true,
  },
  {
    code: 'AC049',
    name: 'NOMSA SITHOLE',
    knownAs: 'NOMSA',
    id: '9101015009085',
    jobTitle: 'Network Field Assistant',
    earnings: '7 105.66',
    deductions: '71.06',
    nett: '7 034.60',
    wrapName: false,
  },
];

const PAY_DATE = '2026/07/31';

async function main(): Promise<void> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const draw = (
    page: ReturnType<typeof doc.addPage>,
    text: string,
    x: number,
    y: number,
    opts: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb> } = {}
  ): void => {
    page.drawText(text, {
      x,
      y,
      size: opts.size ?? 9,
      font: opts.bold ? bold : font,
      color: opts.color ?? rgb(0.1, 0.1, 0.1),
    });
  };

  /**
   * Draw one visual row. Items are given left-to-right for readability but
   * emitted right-to-left, which is what makes pdfjs report the value ahead
   * of its label — the defining quirk of this template.
   */
  const drawRow = (
    page: ReturnType<typeof doc.addPage>,
    y: number,
    items: Array<{ text: string; x: number; bold?: boolean }>
  ): void => {
    for (const item of [...items].reverse()) {
      draw(page, item.text, item.x, y, { bold: item.bold });
    }
  };

  for (const s of STAFF) {
    const page = doc.addPage([595, 842]);

    drawRow(page, 800, [
      { text: 'Acme Demo (Pty) Ltd', x: 50, bold: true },
      { text: 'Pay Date', x: 380, bold: true },
      { text: PAY_DATE, x: 470 },
    ]);

    if (s.wrapName) {
      // Sage pushes a long name below the label row, with the known-as name
      // under it and the "Employee" label under that.
      drawRow(page, 760, [
        { text: 'Employee Code', x: 380, bold: true },
        { text: s.code, x: 470 },
      ]);
      draw(page, s.name, 130, 748);
      draw(page, `(${s.knownAs})`, 130, 736);
      draw(page, 'Employee', 50, 724, { bold: true });
    } else {
      drawRow(page, 760, [
        { text: 'Employee', x: 50, bold: true },
        { text: `${s.name} (${s.knownAs})`, x: 130 },
        { text: 'Employee Code', x: 380, bold: true },
        { text: s.code, x: 470 },
      ]);
    }

    const idRow: Array<{ text: string; x: number; bold?: boolean }> = [
      { text: 'Job title', x: 50, bold: true },
      { text: s.jobTitle, x: 130 },
      { text: 'Identity Number', x: 380, bold: true },
    ];
    if (s.id) idRow.push({ text: s.id, x: 470 });
    drawRow(page, 700, idRow);

    drawRow(page, 640, [
      { text: 'Earnings', x: 50, bold: true },
      { text: 'Amount', x: 250, bold: true },
      { text: 'Deductions', x: 320, bold: true },
      { text: 'Amount', x: 500, bold: true },
    ]);

    drawRow(page, 620, [
      { text: 'Basic salary', x: 50 },
      { text: s.earnings, x: 250 },
      { text: 'Tax', x: 320 },
      { text: '3 381.00', x: 500 },
    ]);

    drawRow(page, 600, [
      { text: 'Total earnings', x: 50, bold: true },
      { text: s.earnings, x: 250, bold: true },
      { text: 'Total deductions', x: 320, bold: true },
      { text: s.deductions, x: 500, bold: true },
    ]);

    drawRow(page, 580, [
      { text: 'Nett pay', x: 320, bold: true },
      { text: s.nett, x: 500, bold: true },
    ]);

    // YTD block — "Taxable earnings" is deliberately larger than total
    // earnings so a loosened anchor regex fails the fixture loudly.
    drawRow(page, 520, [
      { text: 'Taxable earnings', x: 320, bold: true },
      { text: '136 111.11', x: 500 },
    ]);

    draw(
      page,
      'Synthetic test data — no real staff or payroll information.',
      50,
      50,
      { size: 7, color: rgb(0.6, 0.6, 0.6) }
    );
  }

  const bytes = await doc.save();
  const outPath = path.resolve(
    __dirname,
    '..',
    '..',
    'src/modules/payslips/__tests__/fixtures/synthetic-plain-paper-payslips.pdf'
  );
  fs.writeFileSync(outPath, bytes);
  console.log(`Wrote ${bytes.length} bytes to ${outPath}`);
  console.log(`Page count: ${STAFF.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

/**
 * Regenerate the synthetic combined-payslips test fixture.
 *
 * Run from the repo root:
 *   npx tsx scripts/test-fixtures/gen-synthetic-payslips.ts
 *
 * Output:
 *   src/modules/payslips/__tests__/fixtures/synthetic-payslips.pdf
 *
 * The fixture mimics VIP's monthly Velocity-payslips.pdf export — one page per
 * employee, with Emp Code / Emp Name / Id Number / Payment Dt / Total
 * Earnings / NETT PAY laid out in the same positions as the real export. All
 * names, IDs, and amounts are entirely fictional; no real payroll data ever
 * enters the repo (POPIA + standard test-data hygiene).
 *
 * If you regenerate this file, also update the sha256 / page-count / first-row
 * assertions in `pdfSplitter.test.ts`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

interface SyntheticEmp {
  code: string;
  name: string;
  id: string | null;
  salary: number;
  deductions: number;
  /** Pre-formatted nett pay with thousands separator — must be the only such number on the page. */
  nett: string;
}

const STAFF: SyntheticEmp[] = [
  { code: 'AC001', name: 'Mr A Smith',     id: '8001015009088', salary: 25000.00, deductions: 3599.12,  nett: '21,400.88' },
  { code: 'AC002', name: 'Ms B Jones',     id: '8502154004087', salary: 26606.25, deductions: 4016.75,  nett: '22,589.50' },
  { code: 'AC003', name: 'Mr C Brown',     id: null,            salary: 20000.00, deductions: 2115.01,  nett: '17,884.99' },
  { code: 'AC004', name: 'Mr D Khumalo',   id: '8703165009086', salary: 28500.00, deductions: 6509.12,  nett: '21,990.88' },
  { code: 'AC005', name: 'Ms E Naidoo',    id: '9101015009085', salary:  8000.00, deductions:   80.00,  nett:  '7,920.00' },
  { code: 'AC006', name: 'Mr F Patel',     id: '7506014009084', salary: 60000.00, deductions: 12658.62, nett: '47,341.38' },
  { code: 'AC007', name: 'Mr G Mokoena',   id: '8909085009083', salary: 55000.00, deductions: 10721.12, nett: '44,278.88' },
  { code: 'AC008', name: 'Ms H Williams',  id: '9203145009082', salary: 21500.00, deductions:  2686.00, nett: '18,814.00' },
  { code: 'AC009', name: 'Mr I Coetzee',   id: '7912155009081', salary: 15000.00, deductions:  1271.95, nett: '13,728.05' },
  { code: 'AC010', name: 'Ms J Dube',      id: '8806285009080', salary: 25843.68, deductions:  3818.49, nett: '22,025.19' },
  { code: 'AC011', name: 'Mr K Botha',     id: '9405115009079', salary: 13890.00, deductions:  1154.11, nett: '12,735.89' },
  { code: 'AC012', name: 'Ms L Nkosi',     id: '8112225009078', salary: 40800.00, deductions:  7774.88, nett: '33,025.12' },
];

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
      x, y,
      size: opts.size ?? 9,
      font: opts.bold ? bold : font,
      color: opts.color ?? rgb(0.1, 0.1, 0.1),
    });
  };

  for (const s of STAFF) {
    const page = doc.addPage([595, 842]);

    draw(page, 'Co. Name', 50, 800, { bold: true });
    draw(page, 'Acme Demo (Pty) Ltd', 130, 800);
    draw(page, 'Co. Address', 280, 800, { bold: true });
    draw(page, '1 Demo Street', 360, 800);
    draw(page, 'Payment Dt', 470, 800, { bold: true });
    draw(page, '2026/04/30', 530, 800);

    draw(page, 'Emp Code', 50, 770, { bold: true });
    draw(page, s.code, 130, 770);

    draw(page, 'Emp Name', 50, 750, { bold: true });
    draw(page, s.name, 130, 750);

    if (s.id) {
      draw(page, 'Id Number', 280, 750, { bold: true });
      draw(page, s.id, 360, 750);
    }

    draw(page, 'EARNINGS', 50, 700, { bold: true, size: 11 });
    draw(page, 'DEDUCTIONS', 320, 700, { bold: true, size: 11 });

    draw(page, 'Description', 50, 680);
    draw(page, 'Amount', 250, 680);
    draw(page, 'Description', 320, 680);
    draw(page, 'Amount', 540, 680);

    draw(page, 'Salary', 50, 660);
    draw(page, s.salary.toFixed(2), 250, 660);

    draw(page, 'PAYE & UIF', 320, 660);
    draw(page, s.deductions.toFixed(2), 540, 660);

    draw(page, 'Total Earnings', 50, 620, { bold: true });
    draw(page, s.salary.toFixed(2), 250, 620, { bold: true });

    draw(page, 'Total Deductions', 320, 620, { bold: true });
    draw(page, s.deductions.toFixed(2), 540, 620, { bold: true });

    draw(page, 'NETT PAY', 380, 560, { bold: true, size: 12 });
    draw(page, s.nett, 510, 560, { bold: true, size: 12 });

    draw(page,
      'Synthetic test data — no real staff or payroll information.',
      50, 50,
      { size: 7, color: rgb(0.6, 0.6, 0.6) }
    );
  }

  const bytes = await doc.save();
  const outPath = path.resolve(
    __dirname,
    '..',
    '..',
    'src/modules/payslips/__tests__/fixtures/synthetic-payslips.pdf'
  );
  fs.writeFileSync(outPath, bytes);
  console.log(`Wrote ${bytes.length} bytes to ${outPath}`);
  console.log(`Page count: ${STAFF.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

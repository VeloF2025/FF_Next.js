/**
 * Standalone verification script for the reusable ReportTemplate.
 *
 * Renders the Uptake Report with mock data (no DB needed) and produces:
 *   /tmp/ff-uptake-preview.html
 *   /tmp/ff-uptake-preview.pdf
 *
 * Run: npx tsx scripts/verify-uptake-report.ts
 */
import fs from 'node:fs/promises';
import puppeteer from 'puppeteer';

import { generateReportHtml, buildUptakeReport } from '../src/templates/reports';

async function main() {
  // Realistic mock data — looks like Lawley
  const reportData = buildUptakeReport({
    projectName: 'Lawley',
    periodLabel: '01 Apr – 20 Apr 2026',
    reportId: 'VF-202604-UPTK-LAWLEY-001',
    generatedBy: 'Hein van Vuuren',
    generatedAt: new Date().toISOString(),
    companyName: 'VelocityFibre',
    targetPct: 65,
    pons: [
      { pon: 'PON-L-001', drops: 450, active: 310 },
      { pon: 'PON-L-002', drops: 400, active: 248 },
      { pon: 'PON-L-003', drops: 410, active: 220 },
      { pon: 'PON-L-004', drops: 420, active: 235 },
      { pon: 'PON-L-005', drops: 380, active: 245 },
      { pon: 'PON-L-006', drops: 350, active: 180 },
      { pon: 'PON-L-007', drops: 300, active: 180 },
      { pon: 'PON-L-008', drops: 330, active: 180 },
      { pon: 'PON-L-009', drops: 330, active: 130 },
      { pon: 'PON-L-010', drops: 390, active: 160 },
      { pon: 'PON-L-011', drops: 380, active: 100 },
      { pon: 'PON-L-012', drops: 290, active: 100 },
    ],
  });

  const html = generateReportHtml(reportData);
  const htmlPath = '/tmp/ff-uptake-preview.html';
  const pdfPath = '/tmp/ff-uptake-preview.pdf';

  await fs.writeFile(htmlPath, html, 'utf8');
  console.log(`HTML written: ${htmlPath} (${html.length} bytes)`);

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    await page.pdf({
      path: pdfPath,
      format: 'A4',
      printBackground: true,
      margin: { top: '0mm', right: '0mm', bottom: '0mm', left: '0mm' },
    });

    // Also take a full-page PNG for a screenshot preview
    const pngPath = '/tmp/ff-uptake-preview.png';
    await page.setViewport({ width: 794, height: 1123, deviceScaleFactor: 2 }); // A4 @ 96dpi
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    await page.screenshot({ path: pngPath, fullPage: true });
    console.log(`PDF written:  ${pdfPath}`);
    console.log(`PNG written:  ${pngPath}`);
  } finally {
    await browser.close();
  }

  // Sanity checks on the output
  const checks: Array<[string, boolean]> = [
    ['contains title', html.includes('Project Uptake Report')],
    ['contains report ID', html.includes('VF-202604-UPTK-LAWLEY-001')],
    ['contains all KPI labels', ['Total Drops', 'Activated', 'Uptake %', 'Target'].every(s => html.includes(s))],
    ['contains bar chart section', html.includes('Uptake per PON')],
    ['contains table section', html.includes('PON Status Overview')],
    ['contains signature label', html.includes('Project Manager Approval')],
    ['pill variants emitted', html.includes('On Track') && html.includes('Critical')],
    ['target marker rendered', html.includes('bar-target')],
  ];
  console.log('\nSanity checks:');
  for (const [label, ok] of checks) {
    console.log(`  ${ok ? '✓' : '✗'} ${label}`);
  }
  const failed = checks.filter(([, ok]) => !ok).length;
  if (failed > 0) {
    console.error(`\n${failed} check(s) failed.`);
    process.exit(1);
  }
  console.log('\nAll checks passed.');
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});

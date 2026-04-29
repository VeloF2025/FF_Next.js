/**
 * GET /api/vlm-training/report
 *
 * Generates a PDF report of the VLM training dataset.
 * Grouped by region with drop list, step completeness, and metadata.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';
import { query } from '@/lib/db-pool';

interface RegionRow extends Record<string, unknown> {
  region: string;
  total: string;
  avg_steps: string;
  full_count: string;
}

interface DropRow extends Record<string, unknown> {
  drop_number: string;
  region: string;
  core_steps_present: number;
  dome_steps_present: number;
  installer_name: string | null;
  installation_date: string | null;
}

function buildHtml(regions: RegionRow[], drops: DropRow[], generatedAt: string): string {
  const totalDrops = drops.length;
  const regionCount = regions.length;

  const regionSummaryRows = regions
    .map(
      (r) => `
      <tr>
        <td>${r.region}</td>
        <td>${r.total}</td>
        <td>${r.avg_steps}/9</td>
        <td>${r.full_count}</td>
      </tr>`
    )
    .join('');

  const dropsByRegion = new Map<string, DropRow[]>();
  for (const drop of drops) {
    if (!dropsByRegion.has(drop.region)) dropsByRegion.set(drop.region, []);
    dropsByRegion.get(drop.region)!.push(drop);
  }

  const regionSections = [...dropsByRegion.entries()]
    .map(([region, regionDrops]) => {
      const dropRows = regionDrops
        .map(
          (d) => `
          <tr>
            <td style="font-family:monospace">${d.drop_number}</td>
            <td>${d.core_steps_present}/9${d.dome_steps_present > 0 ? ` +${d.dome_steps_present}D` : ''}</td>
            <td>${d.installer_name ?? '—'}</td>
            <td>${d.installation_date ? d.installation_date.substring(0, 10) : '—'}</td>
          </tr>`
        )
        .join('');

      return `
        <div class="region-section">
          <h2 class="region-heading">${region} <span class="region-count">${regionDrops.length} drops</span></h2>
          <table class="drop-table">
            <thead>
              <tr><th>Drop #</th><th>Steps</th><th>Installer</th><th>Date</th></tr>
            </thead>
            <tbody>${dropRows}</tbody>
          </table>
        </div>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  :root {
    --bg: #0d1117;
    --card: #161b22;
    --border: #30363d;
    --text: #e6edf3;
    --muted: #8b949e;
    --accent: #58a6ff;
    --green: #3fb950;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: var(--bg); color: var(--text); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 12px; padding: 32px; }
  .cover { margin-bottom: 48px; border-bottom: 1px solid var(--border); padding-bottom: 32px; }
  .cover-logo { font-size: 11px; font-weight: 700; letter-spacing: 2px; color: var(--muted); text-transform: uppercase; margin-bottom: 24px; }
  .cover-title { font-size: 28px; font-weight: 700; color: var(--text); line-height: 1.2; margin-bottom: 8px; }
  .cover-subtitle { font-size: 14px; color: var(--muted); margin-bottom: 24px; }
  .cover-stats { display: flex; gap: 32px; }
  .stat-box { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 16px 24px; }
  .stat-label { font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: var(--muted); margin-bottom: 4px; }
  .stat-value { font-size: 24px; font-weight: 700; color: var(--accent); }
  .summary-table, .drop-table { width: 100%; border-collapse: collapse; margin-bottom: 24px; font-size: 11px; }
  .summary-table th, .drop-table th { text-align: left; padding: 8px 12px; background: var(--card); border-bottom: 1px solid var(--border); color: var(--muted); font-weight: 600; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; }
  .summary-table td, .drop-table td { padding: 7px 12px; border-bottom: 1px solid var(--border); color: var(--text); }
  .summary-table tr:last-child td, .drop-table tr:last-child td { border-bottom: none; }
  .section-heading { font-size: 14px; font-weight: 600; color: var(--text); margin-bottom: 12px; margin-top: 32px; }
  .region-section { page-break-inside: avoid; margin-bottom: 32px; }
  .region-heading { font-size: 15px; font-weight: 700; color: var(--accent); margin-bottom: 12px; border-bottom: 1px solid var(--border); padding-bottom: 8px; }
  .region-count { font-size: 12px; font-weight: 400; color: var(--muted); }
  .footer { border-top: 1px solid var(--border); margin-top: 48px; padding-top: 16px; color: var(--muted); font-size: 10px; display: flex; justify-content: space-between; }
</style>
</head>
<body>

<div class="cover">
  <div class="cover-logo">VelocityFibre — FibreFlow</div>
  <div class="cover-title">Fibertime National Sample<br>VLM Training Dataset</div>
  <div class="cover-subtitle">Methodology: ≥8 of 9 core installation steps present · Max 350 per region · Signature photos excluded</div>
  <div class="cover-stats">
    <div class="stat-box">
      <div class="stat-label">Total Drops</div>
      <div class="stat-value">${totalDrops.toLocaleString()}</div>
    </div>
    <div class="stat-box">
      <div class="stat-label">Regions</div>
      <div class="stat-value">${regionCount}</div>
    </div>
    <div class="stat-box">
      <div class="stat-label">Generated</div>
      <div class="stat-value" style="font-size:14px;padding-top:8px">${generatedAt}</div>
    </div>
  </div>
</div>

<h2 class="section-heading">Region Summary</h2>
<table class="summary-table">
  <thead>
    <tr><th>Region</th><th>Drops</th><th>Avg Steps</th><th>Full (9/9)</th></tr>
  </thead>
  <tbody>${regionSummaryRows}</tbody>
</table>

${regionSections}

<div class="footer">
  <span>FibreFlow VLM Training Dataset — Confidential</span>
  <span>Generated ${generatedAt}</span>
</div>
</body>
</html>`;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'unknown', ['GET']);
  }

  try {
    const regions = await query<RegionRow>(`
      SELECT
        region,
        COUNT(*)::text as total,
        ROUND(AVG(core_steps_present), 1)::text as avg_steps,
        COUNT(*) FILTER (WHERE core_steps_present = 9)::text as full_count
      FROM vlm_training_dataset
      WHERE excluded_from_training = false
      GROUP BY region
      ORDER BY total::int DESC
    `);

    const drops = await query<DropRow>(`
      SELECT drop_number, region, core_steps_present, dome_steps_present,
             installer_name, installation_date::text
      FROM vlm_training_dataset
      WHERE excluded_from_training = false
      ORDER BY region, core_steps_present DESC, drop_number
    `);

    const generatedAt = new Date().toLocaleDateString('en-ZA', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
      timeZone: 'Africa/Johannesburg',
    });

    const html = buildHtml(regions, drops, generatedAt);

    const puppeteer = await import('puppeteer');
    const browser = await puppeteer.default.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });
      const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '0mm', right: '0mm', bottom: '0mm', left: '0mm' },
      });

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="vlm-training-sample-${new Date().toISOString().slice(0, 10)}.pdf"`
      );
      res.send(Buffer.from(pdfBuffer));
    } finally {
      await browser.close();
    }
  } catch (err) {
    log.error('Failed to generate VLM training report', { err }, 'vlm-training');
    return apiResponse.error(res, 'INTERNAL_ERROR' as never, 'Failed to generate report');
  }
}

export default withAuth(handler);

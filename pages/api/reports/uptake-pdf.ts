/**
 * API Route: /api/reports/uptake-pdf?projectId=<uuid> OR ?project=<name>
 *
 * Renders the Uptake Report as a PDF via puppeteer. Reuses the shared fetcher
 * from /api/reports/uptake.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth, withPermission } from '@/lib/auth';
import { generateReportHtml, buildUptakeReport } from '@/templates/reports';
import { fetchUptakePayload, type UptakeLookup } from './uptake';

function buildReportId(projectName: string): string {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const slug = projectName
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toUpperCase()
    .slice(0, 12) || 'PROJECT';
  const seq = String(Math.floor(Math.random() * 1000)).padStart(3, '0');
  return `VF-${year}${month}-UPTK-${slug}-${seq}`;
}

function formatPeriodLabel(): string {
  const end = new Date();
  const start = new Date(end.getFullYear(), end.getMonth(), 1);
  const fmt = (d: Date) => d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  return `${fmt(start)} – ${fmt(end)}`;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }

  const { projectId, project } = req.query;
  const lookup: UptakeLookup = {};
  if (typeof projectId === 'string' && projectId) lookup.projectId = projectId;
  if (typeof project === 'string' && project) lookup.projectName = project;

  if (!lookup.projectId && !lookup.projectName) {
    return apiResponse.badRequest(res, 'projectId or project query parameter is required');
  }

  try {
    const payload = await fetchUptakePayload(lookup);
    if (!payload) {
      return apiResponse.notFound(res, 'Project', lookup.projectId ?? lookup.projectName ?? '');
    }

    const reportData = buildUptakeReport({
      projectName: payload.projectName,
      periodLabel: formatPeriodLabel(),
      reportId: buildReportId(payload.projectName),
      generatedBy: 'FibreFlow',
      generatedAt: new Date().toISOString(),
      companyName: 'VelocityFibre',
      targetPct: payload.targetPct,
      pons: payload.pons,
    });

    const html = generateReportHtml(reportData);

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

      const buffer = Buffer.from(pdfBuffer);
      const filename = `${reportData.reportId}.pdf`;

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Length', buffer.length);

      log.info('Uptake PDF generated', { lookup, reportId: reportData.reportId }, 'UptakeReportPDF');
      return res.send(buffer);
    } finally {
      await browser.close();
    }
  } catch (error) {
    log.error('Uptake PDF generation failed', { error, lookup }, 'UptakeReportPDF');
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(withPermission('analytics.read')(handler));

export const config = {
  api: { responseLimit: '10mb' },
};

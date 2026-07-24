/**
 * H&S Digital Safety File export (goal Phase 5, §7.5)
 *
 * GET /api/health-safety/project/[projectId]/safety-file
 *   ?format=pdf  → single PDF (default) assembling the project's appointment
 *                  letters with their captured signatures
 *   ?format=json → the assembled data (letters incl. signature image + summary)
 *
 * PDF is produced via Puppeteer — the sanctioned PDF path (§4.6).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';

import { log } from '@/lib/logger';
import { generateSafetyFileHtml, type SafetyFileData } from '@/templates/health-safety/safety-file-template';
import type { AppointmentLetter } from '@/modules/health-safety/types/appointment.types';
import { withHsPermission } from '@/modules/health-safety/services/hsAuth';

const sql = neon(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { projectId } = req.query;
  if (!projectId || typeof projectId !== 'string') {
    return apiResponse.badRequest(res, 'projectId is required');
  }
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }

  try {
    const [project] = await sql`SELECT id, project_name FROM projects WHERE id = ${projectId}`;
    if (!project) {
      return apiResponse.notFound(res, 'Project', projectId);
    }

    const letters = (await sql`
      SELECT * FROM hs_appointment_letters WHERE project_id = ${projectId}
      ORDER BY letter_type, created_at
    `) as unknown as AppointmentLetter[];

    const [summary] = await sql`
      SELECT
        (SELECT COUNT(*) FROM hs_worker_training WHERE project_id = ${projectId})::int AS training,
        (SELECT COUNT(*) FROM hs_toolbox_talks WHERE project_id = ${projectId})::int AS toolbox,
        (SELECT COUNT(*) FROM hs_ppe_issuance WHERE project_id = ${projectId})::int AS ppe,
        (SELECT COUNT(*) FROM hs_permits WHERE project_id = ${projectId})::int AS permits,
        (SELECT COUNT(*) FROM hs_project_audits WHERE project_id = ${projectId})::int AS audits
    `;

    const data: SafetyFileData = {
      projectName: String(project.project_name ?? 'Project'),
      generatedAt: new Date().toISOString(),
      letters,
      summary: {
        training: Number(summary?.training ?? 0),
        toolbox: Number(summary?.toolbox ?? 0),
        ppe: Number(summary?.ppe ?? 0),
        permits: Number(summary?.permits ?? 0),
        audits: Number(summary?.audits ?? 0),
      },
    };

    if (req.query.format === 'json') {
      return apiResponse.success(res, data);
    }

    const html = generateSafetyFileHtml(data);
    const puppeteer = await import('puppeteer');
    const browser = await puppeteer.default.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });
      const pdfBuffer = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' } });
      const buffer = Buffer.from(pdfBuffer);
      const filename = `Safety-File_${String(project.project_name ?? 'project').replace(/[^a-z0-9]+/gi, '-')}.pdf`;
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Length', buffer.length);
      return res.send(buffer);
    } finally {
      await browser.close();
    }
  } catch (error) {
    log.error('[H&S Safety File Export] Error', { error });
    return apiResponse.internalError(res, error);
  }
}

export default withHsPermission(handler);

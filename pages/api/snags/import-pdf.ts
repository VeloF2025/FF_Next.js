/**
 * TQR PDF Import API
 *
 * POST /api/snags/import-pdf
 *
 * Accepts a multipart upload of a Tera Fibre Quality Report PDF + project_id.
 * Extracts metadata, findings, and snag photos, then persists everything to
 * snag_reports, snags, and snag_photos tables.
 *
 * Status: WORKING
 * NLNH Confidence: HIGH (validated against TQR 0012/2026)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import formidable from 'formidable';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth, getAuthUser } from '@/lib/auth';
import { parseTqrText } from '@/modules/construction-qa/services/tqr-pdf-parser';
import {
  listPdfImages,
  filterSnagPhotos,
  extractJpegs,
  uploadSnagPhotos,
  uploadSourcePdf,
} from '@/modules/construction-qa/services/tqr-image-extractor';
import type { SnagReport, Snag } from '@/modules/construction-qa/types/snag.types';
import { processSnagPostInsert } from '@/modules/construction-qa/services/snag-import-helpers';
import { insertSnagPhotos } from './snag-photo-mapper';

// ============================================================
// Next.js Config — disable body parser for multipart
// ============================================================

export const config = {
  api: {
    bodyParser: false,
    responseLimit: '50mb',
  },
};

const sql = neon(process.env.DATABASE_URL!);

// ============================================================
// Handler
// ============================================================

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'Unknown', ['POST']);
  }

  const user = getAuthUser(req);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tqr-import-'));

  try {
    // ── 1. Parse multipart form ──────────────────────────────
    const form = formidable({ maxFileSize: 100 * 1024 * 1024, keepExtensions: true });
    const [fields, files] = await form.parse(req);

    const projectId = Array.isArray(fields.project_id)
      ? fields.project_id[0]
      : fields.project_id;

    if (!projectId) {
      return apiResponse.badRequest(res, 'project_id is required');
    }

    const uploadedFile = Array.isArray(files.file) ? files.file[0] : files.file;
    if (!uploadedFile) {
      return apiResponse.badRequest(res, 'No PDF file uploaded (field name: file)');
    }

    // ── 2. Validate project exists ───────────────────────────
    const projectRows = await sql`
      SELECT id, project_name FROM projects WHERE id = ${projectId}
    ` as Array<{ id: string; project_name: string }>;

    if (projectRows.length === 0) {
      return apiResponse.notFound(res, 'Project', projectId);
    }

    const pdfPath      = uploadedFile.filepath;
    const origFilename = uploadedFile.originalFilename ?? 'report.pdf';
    const textPath     = path.join(tempDir, 'report.txt');

    log.info('TqrPdfImport: starting import', { origFilename, projectId });

    // ── 3. Extract text ──────────────────────────────────────
    execSync(`/usr/bin/pdftotext -layout "${pdfPath}" "${textPath}"`, {
      timeout: 60_000,
    });
    const pdfText = fs.readFileSync(textPath, 'utf-8');

    // ── 4. Parse text ────────────────────────────────────────
    const { metadata, findings, gridMapping, auditScores } = parseTqrText(pdfText);

    if (!metadata.reportNumber) {
      return apiResponse.badRequest(
        res,
        'Could not extract report number from PDF. Ensure this is a TQR PDF.'
      );
    }
    if (!metadata.auditDate) {
      return apiResponse.badRequest(
        res,
        'Could not extract audit date from PDF.'
      );
    }

    log.info('TqrPdfImport: parsed metadata', {
      reportNumber: metadata.reportNumber,
      auditDate: metadata.auditDate,
      findingCount: findings.length,
      gridSlots: gridMapping.totalSlots,
    });

    // ── 5. Check for duplicate report ────────────────────────
    const existing = await sql`
      SELECT id FROM snag_reports WHERE report_number = ${metadata.reportNumber}
    ` as Array<{ id: string }>;

    if (existing.length > 0) {
      return apiResponse.error(
        res,
        ErrorCode.CONFLICT,
        `Report ${metadata.reportNumber} has already been imported (id: ${existing[0]?.id ?? 'unknown'})`
      );
    }

    // ── 6. Extract and upload images ─────────────────────────
    const imageList    = listPdfImages(pdfPath);
    const snagEntries  = filterSnagPhotos(imageList);

    log.info('TqrPdfImport: image filter', {
      totalImages: imageList.length,
      snagPhotoCount: snagEntries.length,
    });

    const extractedImages = extractJpegs(pdfPath, tempDir, snagEntries);

    const uploadedPhotos = await uploadSnagPhotos(
      extractedImages,
      projectId,
      metadata.reportNumber
    );

    log.info('TqrPdfImport: photos uploaded', { count: uploadedPhotos.length });

    // ── 7. Upload source PDF to VF Storage ───────────────────
    const pdfUrl = await uploadSourcePdf(
      fs.readFileSync(pdfPath),
      origFilename,
      projectId,
      metadata.reportNumber
    );

    // ── 8. Insert snag_report ─────────────────────────────────
    const reportRows = await sql`
      INSERT INTO snag_reports (
        project_id, report_number, site_name, client, contractor,
        audit_date, auditor, source_pdf_url, source_pdf_filename,
        quality_assurance,  quality_nc,
        health_assurance,   health_nc,
        safety_assurance,   safety_nc,
        environment_assurance, environment_nc,
        traffic_assurance,  traffic_nc,
        total_findings, import_status, imported_by
      ) VALUES (
        ${projectId},
        ${metadata.reportNumber},
        ${metadata.siteName ?? null},
        ${metadata.client ?? null},
        ${metadata.contractor ?? null},
        ${metadata.auditDate},
        ${metadata.auditor ?? null},
        ${pdfUrl},
        ${origFilename},
        ${auditScores.qualityAssurance},     ${auditScores.qualityNc},
        ${auditScores.healthAssurance},      ${auditScores.healthNc},
        ${auditScores.safetyAssurance},      ${auditScores.safetyNc},
        ${auditScores.environmentAssurance}, ${auditScores.environmentNc},
        ${auditScores.trafficAssurance},     ${auditScores.trafficNc},
        ${findings.length},
        'complete',
        ${user?.id ?? null}
      )
      RETURNING *
    ` as SnagReport[];

    const report = reportRows[0];
    if (!report) {
      return apiResponse.error(res, ErrorCode.INTERNAL_ERROR, 'Failed to create snag report');
    }

    // ── 9. Insert snags, auto-resolve poles, detect repeats ──
    const createdSnags: Snag[] = [];
    let autoResolved = 0;
    let repeatsDetected = 0;

    for (const finding of findings) {
      // Extract pole_references from the finding if available (parser may add this later)
      const poleRefs = 'poleReferences' in finding
        ? (finding.poleReferences as string[] | undefined) ?? null
        : null;

      const snagRows = await sql`
        INSERT INTO snags (
          report_id, project_id, snag_number,
          category, severity, description,
          pole_references, status
        ) VALUES (
          ${report.id},
          ${projectId},
          ${finding.snagNumber},
          ${finding.category},
          'major',
          ${finding.description},
          ${poleRefs},
          'open'
        )
        RETURNING *
      ` as Snag[];

      const snag = snagRows[0];
      if (!snag) continue;

      const result = await processSnagPostInsert({
        snag,
        projectId,
        reportId: report.id,
        poleRefs,
        sql,
      });

      createdSnags.push(result.snag);
      if (result.autoResolved) autoResolved++;
      if (result.isRepeat) repeatsDetected++;
    }

    log.info('TqrPdfImport: pole resolution + repeat detection complete', {
      reportId: report.id,
      autoResolved,
      repeatsDetected,
    });

    // ── 10. Map photos to snags and insert snag_photos ────────
    const photoRecords = await insertSnagPhotos(
      createdSnags,
      uploadedPhotos,
      gridMapping.snagNumbers,
      user?.id ?? null
    );

    log.info('TqrPdfImport: complete', {
      reportId: report.id,
      reportNumber: report.report_number,
      snags: createdSnags.length,
      photos: photoRecords.length,
    });

    return apiResponse.created(res, {
      report,
      snags: createdSnags,
      photoCount: photoRecords.length,
      unmappedPhotos: uploadedPhotos.length - photoRecords.length,
      autoResolved,
      repeatsDetected,
    }, `Imported ${createdSnags.length} findings with ${photoRecords.length} photos`);

  } catch (error) {
    log.error('TqrPdfImport: import failed', { error });
    return apiResponse.internalError(res, error, 'PDF import failed');
  } finally {
    // ── Cleanup temp files ────────────────────────────────────
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (cleanupErr) {
      log.warn('TqrPdfImport: temp cleanup failed', { tempDir, error: cleanupErr });
    }
  }
}

export default withAuth(handler);

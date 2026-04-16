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
  filterFieldReportPhotos,
} from '@/modules/construction-qa/services/tqr-image-extractor';
import { detectPdfFormat } from '@/modules/construction-qa/services/detect-pdf-format';
import {
  parseFieldReport,
  type FieldSnagRow,
} from '@/modules/construction-qa/services/field-report-pdf-parser';
import { detectRepeats } from '@/modules/construction-qa/services/snag-repeat-detector';
import type { SnagReport } from '@/modules/construction-qa/types/snag.types';
import { createSnagsPerPhoto } from './snag-photo-mapper';

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
// Field Report Import Helper
// ============================================================

async function importFieldReport(params: {
  pdfText: string;
  pdfPath: string;
  originalFilename: string;
  projectId: string;
  userId: string | null;
  sql: typeof sql;
  tempDir: string;
}): Promise<{
  reportId: string;
  reportNumber: string;
  snagCount: number;
  photoCount: number;
}> {
  const { pdfText, pdfPath, originalFilename, projectId, userId, sql: sqlFn, tempDir } = params;

  const { rows, suggestedName } = parseFieldReport(pdfText, originalFilename);

  if (rows.length === 0) {
    throw new Error('No snag rows found in field report PDF.');
  }

  const today        = new Date().toISOString().split('T')[0]!;
  const slug         = suggestedName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const reportNumber = `FIELD-${slug}-${today}`;

  log.info('FieldReportImport: starting', { reportNumber, rowCount: rows.length, projectId });

  // ── A. Extract + upload photos ──────────────────────────
  const imageList      = listPdfImages(pdfPath);
  const filteredImages = filterFieldReportPhotos(imageList);
  const extractedFiles = extractJpegs(pdfPath, tempDir, filteredImages);
  const uploadedPhotos = await uploadSnagPhotos(extractedFiles, projectId, reportNumber);

  if (uploadedPhotos.length !== rows.length) {
    log.warn('FieldReportImport: photo/row count mismatch', {
      photos: uploadedPhotos.length,
      rows: rows.length,
    });
  }

  // ── B. Upload source PDF ────────────────────────────────
  const pdfBuffer    = fs.readFileSync(pdfPath);
  const sourcePdfUrl = await uploadSourcePdf(pdfBuffer, originalFilename, projectId, reportNumber);

  // ── C. Insert snag_report ───────────────────────────────
  const reportRows = await sqlFn`
    INSERT INTO snag_reports (
      project_id, report_number, site_name, audit_date,
      source_pdf_url, source_pdf_filename,
      quality_assurance, quality_nc,
      health_assurance, health_nc,
      safety_assurance, safety_nc,
      environment_assurance, environment_nc,
      traffic_assurance, traffic_nc,
      total_findings, import_status, import_notes, imported_by
    ) VALUES (
      ${projectId}, ${reportNumber}, ${suggestedName}, ${today},
      ${sourcePdfUrl ?? null}, ${originalFilename},
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      ${rows.length}, 'complete', ${'field_report import - table format'}, ${userId}
    )
    RETURNING id
  ` as Array<{ id: string }>;

  const reportId = reportRows[0]?.id;
  if (!reportId) throw new Error('Failed to create snag_report record');

  // ── D. Insert snags + photos ────────────────────────────
  let snagCount  = 0;
  let photoCount = 0;

  for (let i = 0; i < rows.length; i++) {
    const row   = rows[i] as FieldSnagRow;
    const photo = uploadedPhotos[i] ?? null;

    const snagRows = await sqlFn`
      INSERT INTO snags (
        report_id, project_id, snag_number,
        category, severity, description,
        status, is_repeat, repeat_count, reopen_count
      ) VALUES (
        ${reportId}, ${projectId}, ${row.rowIndex + 1},
        ${row.category}, ${row.severity}, ${row.description},
        'open', false, 0, 0
      )
      RETURNING id
    ` as Array<{ id: string }>;

    const snagId = snagRows[0]?.id;
    if (!snagId) {
      log.warn('FieldReportImport: failed to insert snag', { rowIndex: i });
      continue;
    }
    snagCount++;

    await detectRepeats(
      {
        id: snagId,
        project_id: projectId,
        category: row.category,
        pole_references: null,
        report_id: reportId,
      },
      sqlFn
    );

    if (photo) {
      await sqlFn`
        INSERT INTO snag_photos (
          snag_id, phase, photo_url, source,
          latitude, longitude
        ) VALUES (
          ${snagId}, 'before', ${photo.url}, 'field_report',
          ${row.latitude}, ${row.longitude}
        )
      `;
      photoCount++;
    } else {
      log.warn('FieldReportImport: no photo for snag', { snagId, rowIndex: i });
    }
  }

  log.info('FieldReportImport: complete', { reportId, snagCount, photoCount });
  return { reportId, reportNumber, snagCount, photoCount };
}

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

    let projectId = Array.isArray(fields.project_id)
      ? fields.project_id[0]
      : fields.project_id;

    const uploadedFile = Array.isArray(files.file) ? files.file[0] : files.file;
    if (!uploadedFile) {
      return apiResponse.badRequest(res, 'No PDF file uploaded (field name: file)');
    }

    // ── 2. Validate or auto-detect project ──────────────────
    if (projectId) {
      const projectRows = await sql`
        SELECT id, project_name FROM projects WHERE id = ${projectId}
      ` as Array<{ id: string; project_name: string }>;

      if (projectRows.length === 0) {
        return apiResponse.notFound(res, 'Project', projectId);
      }
    } else {
      // Auto-detect: extract text first, then search by address/siteName
      const autoTextPath = path.join(tempDir, 'auto-detect.txt');
      execSync(`/usr/bin/pdftotext -layout "${uploadedFile.filepath}" "${autoTextPath}"`, {
        timeout: 30_000,
      });
      const autoText = fs.readFileSync(autoTextPath, 'utf-8');
      const { metadata: autoMeta } = parseTqrText(autoText);

      const searchTerms = [
        autoMeta.address,
        autoMeta.siteName ? autoMeta.siteName.split('.')[0] : null,
      ].filter((t): t is string => Boolean(t));

      for (const term of searchTerms) {
        const matches = await sql`
          SELECT id, project_name FROM projects WHERE project_name ILIKE ${'%' + term + '%'}
        ` as Array<{ id: string; project_name: string }>;

        if (matches.length === 1 && matches[0]) {
          projectId = matches[0].id;
          log.info('TqrPdfImport: auto-detected project', { term, projectId, name: matches[0].project_name });
          break;
        }
      }

      if (!projectId) {
        return apiResponse.error(
          res,
          ErrorCode.BAD_REQUEST,
          'Could not auto-detect project. Please provide project_id.'
        );
      }
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

    // ── Format detection + routing ────────────────────────
    const format = detectPdfFormat(pdfText);

    if (format === 'unknown') {
      return apiResponse.error(
        res,
        ErrorCode.BAD_REQUEST,
        'Unrecognised PDF format. Supported: TQR Audit Report, Field Snag Report.'
      );
    }

    if (format === 'field_report') {
      const originalFilename = uploadedFile.originalFilename ?? 'field-report.pdf';
      try {
        const result = await importFieldReport({
          pdfText,
          pdfPath,
          originalFilename,
          projectId: projectId!,
          userId: user?.id ?? null,
          sql,
          tempDir,
        });
        return apiResponse.success(res, { ...result, format: 'field_report' });
      } catch (fieldErr) {
        const msg = fieldErr instanceof Error ? fieldErr.message : 'Field report import failed';
        log.error('FieldReportImport: failed', { error: fieldErr });
        return apiResponse.badRequest(res, msg);
      }
    }

    // ── TQR path continues below (unchanged) ─────────────

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

    // ── 5. Check for duplicate report (scoped to project) ────
    // Same report number can exist across different projects — scope by project_id
    const existing = await sql`
      SELECT id FROM snag_reports
      WHERE report_number = ${metadata.reportNumber}
        AND project_id = ${projectId}
    ` as Array<{ id: string }>;

    if (existing.length > 0) {
      return apiResponse.error(
        res,
        ErrorCode.CONFLICT,
        `Report ${metadata.reportNumber} has already been imported for this project (id: ${existing[0]?.id ?? 'unknown'})`
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

    // ── 9. Create one snag per photo/pole instance ─────────────
    // Each photo in the TQR grid is a unique issue at a specific pole.
    // Finding #1 with 14 photos at different poles → 14 individual snags.
    const { snags: createdSnags, photos: photoRecords } = await createSnagsPerPhoto(
      report.id,
      projectId,
      findings,
      gridMapping.slots,
      uploadedPhotos,
      user?.id ?? null
    );

    // Update total_findings to reflect actual snag count
    await sql`
      UPDATE snag_reports
      SET total_findings = ${createdSnags.length}, updated_at = NOW()
      WHERE id = ${report.id}
    `;

    log.info('TqrPdfImport: complete', {
      reportId: report.id,
      reportNumber: report.report_number,
      findingTypes: findings.length,
      snags: createdSnags.length,
      photos: photoRecords.length,
    });

    return apiResponse.created(res, {
      report,
      snags: createdSnags,
      photoCount: photoRecords.length,
      findingTypes: findings.length,
    }, `Imported ${createdSnags.length} snags (${findings.length} finding types) with ${photoRecords.length} photos`);

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

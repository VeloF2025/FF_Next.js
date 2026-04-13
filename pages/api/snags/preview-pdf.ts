/**
 * TQR PDF Preview API
 *
 * POST /api/snags/preview-pdf
 *
 * Accepts a multipart upload of a TQR PDF. Parses metadata, findings, and
 * photo count WITHOUT writing to the database. Also attempts project
 * auto-detection. Returns a preview payload so the frontend can show a
 * confirmation summary before the user commits.
 *
 * Status: WORKING
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
import { withAuth } from '@/lib/auth';
import {
  parseTqrText,
  type TqrFinding,
} from '@/modules/construction-qa/services/tqr-pdf-parser';
import {
  listPdfImages,
  filterSnagPhotos,
} from '@/modules/construction-qa/services/tqr-image-extractor';

// ============================================================
// Config
// ============================================================

export const config = {
  api: {
    bodyParser: false,
    responseLimit: '50mb',
  },
};

const sql = neon(process.env.DATABASE_URL!);

// ============================================================
// Types
// ============================================================

interface ProjectCandidate {
  id: string;
  name: string;
}

export interface PdfPreviewResult {
  metadata: {
    reportNumber: string;
    auditDate: string;
    siteName: string | null;
    address: string | null;
    category: string;
    auditor: string | null;
    client: string | null;
    contractor: string | null;
  };
  project: ProjectCandidate | null;
  projectCandidates: ProjectCandidate[];
  findings: Array<{ number: number; description: string; category: string }>;
  photoCount: number;
  auditScores: {
    qualityAssurance: number;
    qualityNc: number;
    healthAssurance: number;
    healthNc: number;
    safetyAssurance: number;
    safetyNc: number;
    environmentAssurance: number;
    environmentNc: number;
    trafficAssurance: number;
    trafficNc: number;
  };
  isDuplicate: boolean;
  duplicateReportId: string | null;
}

// ============================================================
// Project auto-detection
// ============================================================

async function detectProject(
  address: string | null,
  siteName: string | null
): Promise<{ project: ProjectCandidate | null; candidates: ProjectCandidate[] }> {
  const searchTerms = [
    address,
    siteName ? siteName.split('.')[0] : null,
  ].filter((t): t is string => Boolean(t));

  for (const term of searchTerms) {
    const rows = await sql`
      SELECT id, project_name FROM projects WHERE project_name ILIKE ${'%' + term + '%'}
    ` as Array<{ id: string; project_name: string }>;

    const candidates = rows.map((r) => ({ id: r.id, name: r.project_name }));

    if (candidates.length === 1 && candidates[0]) {
      return { project: candidates[0], candidates: [] };
    }
    if (candidates.length > 1) {
      return { project: null, candidates };
    }
  }

  // No match via address/site — return all projects so user can pick manually
  const allRows = await sql`
    SELECT id, project_name FROM projects ORDER BY project_name ASC
  ` as Array<{ id: string; project_name: string }>;

  return { project: null, candidates: allRows.map((r) => ({ id: r.id, name: r.project_name })) };
}

// ============================================================
// Handler
// ============================================================

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'Unknown', ['POST']);
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tqr-preview-'));

  try {
    // ── 1. Parse multipart form ─────────────────────────────
    const form = formidable({ maxFileSize: 100 * 1024 * 1024, keepExtensions: true });
    const [, files] = await form.parse(req);

    const uploadedFile = Array.isArray(files.file) ? files.file[0] : files.file;
    if (!uploadedFile) {
      return apiResponse.badRequest(res, 'No PDF file uploaded (field name: file)');
    }

    const pdfPath  = uploadedFile.filepath;
    const textPath = path.join(tempDir, 'report.txt');

    log.info('TqrPdfPreview: starting preview parse', {
      originalName: uploadedFile.originalFilename,
    });

    // ── 2. Extract text ─────────────────────────────────────
    execSync(`/usr/bin/pdftotext -layout "${pdfPath}" "${textPath}"`, {
      timeout: 60_000,
    });
    const pdfText = fs.readFileSync(textPath, 'utf-8');

    // ── 3. Parse text ────────────────────────────────────────
    const { metadata, findings, auditScores } = parseTqrText(pdfText);

    if (!metadata.reportNumber) {
      return apiResponse.error(
        res,
        ErrorCode.BAD_REQUEST,
        'Could not extract report number. Ensure this is a TQR PDF.'
      );
    }
    if (!metadata.auditDate) {
      return apiResponse.error(
        res,
        ErrorCode.BAD_REQUEST,
        'Could not extract audit date from PDF.'
      );
    }

    // ── 4. Count snag photos (no extraction) ─────────────────
    const imageList   = listPdfImages(pdfPath);
    const snagEntries = filterSnagPhotos(imageList);
    const photoCount  = snagEntries.length;

    // ── 5. Check for duplicate ───────────────────────────────
    const existing = await sql`
      SELECT id FROM snag_reports WHERE report_number = ${metadata.reportNumber}
    ` as Array<{ id: string }>;

    const isDuplicate       = existing.length > 0;
    const duplicateReportId = existing[0]?.id ?? null;

    // ── 6. Auto-detect project ───────────────────────────────
    const { project, candidates } = await detectProject(
      metadata.address,
      metadata.siteName
    );

    // ── 7. Determine dominant category ──────────────────────
    const categoryCounts: Record<string, number> = {};
    for (const f of findings) {
      categoryCounts[f.category] = (categoryCounts[f.category] ?? 0) + 1;
    }
    const dominantCategory =
      Object.entries(categoryCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'quality';

    const previewFindings = findings.map((f: TqrFinding) => ({
      number: f.snagNumber,
      description: f.description,
      category: f.category,
    }));

    const result: PdfPreviewResult = {
      metadata: {
        reportNumber: metadata.reportNumber,
        auditDate: metadata.auditDate,
        siteName: metadata.siteName,
        address: metadata.address,
        category: dominantCategory,
        auditor: metadata.auditor,
        client: metadata.client,
        contractor: metadata.contractor,
      },
      project,
      projectCandidates: candidates,
      findings: previewFindings,
      photoCount,
      auditScores,
      isDuplicate,
      duplicateReportId,
    };

    log.info('TqrPdfPreview: complete', {
      reportNumber: metadata.reportNumber,
      findingCount: findings.length,
      photoCount,
      projectDetected: Boolean(project),
      isDuplicate,
    });

    return apiResponse.success(res, result);

  } catch (error) {
    log.error('TqrPdfPreview: failed', { error });
    return apiResponse.internalError(res, error, 'PDF preview failed');
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (cleanupErr) {
      log.warn('TqrPdfPreview: temp cleanup failed', { tempDir, error: cleanupErr });
    }
  }
}

export default withAuth(handler);

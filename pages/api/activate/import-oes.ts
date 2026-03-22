/**
 * API Route: /api/activate/import-oes
 *
 * Purpose: Import Nokia OES activation reports
 * Method: POST (multipart/form-data)
 *
 * Actions:
 * - preview: Parse Excel and return preview data
 * - import: Parse Excel, insert into oes_activations, update drops.oes_confirmed
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { IncomingForm, type Fields, type Files } from 'formidable';
import fs from 'fs';
import { createLogger } from '@/lib/logger';
import { withAuth, withRole, type AuthenticatedNextApiRequest } from '@/lib/auth';

import { parseOESExcel } from '@/modules/activate/services/oes/oesExcelParser';
import { createImportBatch, upsertActivations, importPPData } from '@/modules/activate/services/oes/oesImportService';
import { loadExistingUnifiedSet, processUnifiedRecords } from '@/modules/activate/services/oes/oesUnifiedRecordsService';
import {
  triggerQFieldSync,
  triggerSharePointSync,
  triggerOltAutoDetect,
  triggerSerialVerificationRecompute,
  triggerVlmLearning,
  triggerPpActivationCheck,
  triggerOntSwapConfirmation,
} from '@/modules/activate/services/oes/oesPostImportService';

const logger = createLogger('api/activate/import-oes');

// Disable body parser for file uploads + extend timeout for large files
export const config = {
  api: {
    bodyParser: false,
  },
  maxDuration: 120, // 2 minutes for large OES imports (7000+ rows)
};

// ============================================================================
// FORM PARSING
// ============================================================================

function parseForm(req: NextApiRequest): Promise<{ fields: Fields; files: Files }> {
  return new Promise((resolve, reject) => {
    const form = new IncomingForm({
      keepExtensions: true,
      maxFileSize: 50 * 1024 * 1024, // 50MB limit
    });
    form.parse(req, (err, fields, files) => {
      if (err) reject(err);
      else resolve({ fields, files });
    });
  });
}

// ============================================================================
// HANDLER
// ============================================================================

async function handler(
  req: AuthenticatedNextApiRequest,
  res: NextApiResponse
): Promise<void> {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { fields, files } = await parseForm(req);

    const fileField = files.file;
    const uploadedFile = Array.isArray(fileField) ? fileField[0] : fileField;

    if (!uploadedFile) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const filePath = uploadedFile.filepath;
    const action = Array.isArray(fields.action) ? fields.action[0] : fields.action;

    logger.info(`Parsing file: ${uploadedFile.originalFilename}`);
    const { rows: oesRows, warnings, headerMismatch, ppRows } = parseOESExcel(filePath);

    if (warnings.length > 0) {
      logger.warn('Format validation warnings detected', { warnings, headerMismatch });
    }

    // Temp file is no longer needed after parsing
    fs.unlinkSync(filePath);

    // -------------------------------------------------------------------------
    // PREVIEW
    // -------------------------------------------------------------------------
    if (action === 'preview') {
      return res.status(200).json({
        success: true,
        preview: oesRows,
        totalRows: oesRows.length,
        warnings: warnings.length > 0 ? warnings : undefined,
        headerMismatch,
      });
    }

    // -------------------------------------------------------------------------
    // IMPORT
    // -------------------------------------------------------------------------
    if (action === 'import') {
      const reportDate = Array.isArray(fields.reportDate) ? fields.reportDate[0] : fields.reportDate;
      logger.info(`Importing ${oesRows.length} rows (batch mode)`, { reportDate, warningCount: warnings.length });

      const dropNumbers = oesRows.map(r => r.drop_number);

      // Step 1 — Create batch + load drops map
      const { batchId, dropsMap, existingCount } = await createImportBatch(
        uploadedFile.originalFilename ?? null,
        reportDate ?? null,
        oesRows.length,
        dropNumbers
      );

      // Step 2 — Upsert activations + update drops.oes_confirmed
      const { inserted, updated, matched, unmatched, errors } = await upsertActivations(
        oesRows, batchId, dropsMap, existingCount
      );

      // Step 3 — Create / update unified review records
      const existingUnifiedSet = await loadExistingUnifiedSet(dropNumbers);
      const { oesOnlyCreated, serialSwapsDetected, oesOnlyDRs } = await processUnifiedRecords(
        oesRows, existingUnifiedSet
      );

      logger.info('Import complete', {
        inserted, updated, matched, unmatched,
        oesOnly: oesOnlyDRs.length, serialSwapsDetected, errors: errors.length,
      });

      // -----------------------------------------------------------------------
      // Fire-and-forget side effects
      // -----------------------------------------------------------------------
      const affectedDRs = [...new Set(dropNumbers)];

      const qfieldSyncTriggered = triggerQFieldSync({
        batchId,
        totalRows: oesRows.length,
        imported: inserted + updated,
        matched,
        timestamp: new Date().toISOString(),
        reportDate: reportDate ?? (new Date().toISOString().split('T')[0] as string),
      });

      const matchedDropNumbers = oesRows
        .filter(row => dropsMap.has(row.drop_number))
        .map(row => row.drop_number);
      triggerSharePointSync(matchedDropNumbers);

      const oltAutoDetectTriggered = await triggerOltAutoDetect(batchId);

      triggerSerialVerificationRecompute(affectedDRs);
      triggerVlmLearning(affectedDRs);
      triggerPpActivationCheck();
      triggerOntSwapConfirmation();

      if (ppRows && ppRows.length > 0) {
        importPPData(ppRows, uploadedFile.originalFilename ?? 'unknown').catch(err => {
          logger.error('PP DATA import failed', { error: err instanceof Error ? err.message : String(err) });
        });
      }

      return res.status(200).json({
        success: true,
        totalRows: oesRows.length,
        inserted,
        updated,
        matched,
        unmatched,
        oesOnlyCreated,
        serialSwapsDetected,
        errors,
        batchId,
        dbSyncConfirmed: true,
        qfieldSyncStatus: {
          success: qfieldSyncTriggered,
          message: qfieldSyncTriggered
            ? 'QField sync triggered (running in background - check Data Sync page for status)'
            : 'QField sync not triggered',
        },
        oltAutoDetectTriggered,
        ppDataImport: ppRows && ppRows.length > 0
          ? { total: ppRows.length, message: 'Importing in background...' }
          : null,
      });
    }

    return res.status(400).json({ error: 'Invalid action. Use "preview" or "import".' });
  } catch (error) {
    logger.error('Import failed', { error: error instanceof Error ? error.message : String(error) });
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Import failed',
    });
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default withAuth(withRole('manager')(handler as any));

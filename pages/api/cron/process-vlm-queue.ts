/**
 * Cron Job: Process VLM Queue
 *
 * POST /api/cron/process-vlm-queue
 *
 * Purpose: Run VLM categorization and extraction for DRs with photos but no VLM data
 *
 * This cron job handles DRs where:
 * - Photos exist (photo_count > 0)
 * - But VLM extraction hasn't run (vlm_power_meter_dbm IS NULL, etc.)
 *
 * Run schedule: Every 10 minutes (via vercel.json)
 * Limit: Processes up to 5 DRs per run to stay within timeout
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { Pool } from 'pg';
import { log } from '@/lib/logger';
import {
  categorizePhotos,
  PhotoInput,
} from '@/modules/activate/services/categorizationVlmService';
import {
  runFullExtraction,
} from '@/modules/activate/services/vlmExtractionService';
import {
  validatePowerMeter,
  validateSerialCrossReference,
  type DrValidationData,
} from '@/modules/activate/services/qaAutoFailService';

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    'postgresql://neondb_owner:npg_MIUZXrg1tEY0@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require',
});

const ONEMAP_HOST = process.env.ONEMAP_HOST || 'http://100.96.203.105:8003';

interface ProcessResult {
  dropNumber: string;
  success: boolean;
  categorized: boolean;
  extracted: boolean;
  powerMeter: number | null;
  ontSerial: string | null;
  drNumber: string | null;
  error?: string;
}

interface ProcessResponse {
  success: boolean;
  processed: number;
  succeeded: number;
  failed: number;
  results: ProcessResult[];
  timestamp: string;
}

/**
 * Process a single DR through VLM pipeline
 */
async function processVlmForDr(dropNumber: string): Promise<ProcessResult> {
  const result: ProcessResult = {
    dropNumber,
    success: false,
    categorized: false,
    extracted: false,
    powerMeter: null,
    ontSerial: null,
    drNumber: null,
  };

  try {
    // Get DR data (all from unified table after migration 127)
    const drResult = await pool.query(
      `SELECT
         drop_number,
         photos_metadata::text as photos,
         vlm_categorization_status,
         vlm_categorization_results::text as categorization,
         ont_serial_scanned as onemap_ont_serial,
         ups_serial_scanned as onemap_ups_serial,
         vlm_power_meter_dbm,
         vlm_ont_serial_step6,
         vlm_ont_serial_step9,
         vlm_dr_number_step9
       FROM dr_photo_unified_reviews
       WHERE drop_number = $1`,
      [dropNumber]
    );

    if (drResult.rows.length === 0) {
      result.error = 'DR not found';
      return result;
    }

    const dr = drResult.rows[0];
    let photos: Array<{ filename: string; url: string; step?: number }> = [];

    try {
      photos = dr.photos ? JSON.parse(dr.photos) : [];
    } catch {
      result.error = 'Failed to parse photos';
      return result;
    }

    if (photos.length === 0) {
      result.error = 'No photos available';
      return result;
    }

    // Step 1: Categorize if not done
    let categorization = dr.categorization ? JSON.parse(dr.categorization) : [];

    if (dr.vlm_categorization_status !== 'categorized' && dr.vlm_categorization_status !== 'approved') {
      log.info('ProcessVlmQueue', `Categorizing photos for ${dropNumber}`);

      // Prepare photos for categorization
      const photoInputs: PhotoInput[] = [];
      for (const photo of photos) {
        try {
          // Fetch photo from OneMap
          const photoUrl = `${ONEMAP_HOST}/api/photo/${dropNumber}/${photo.filename}`;
          const photoResponse = await fetch(photoUrl, {
            signal: AbortSignal.timeout(10000),
          });

          if (photoResponse.ok) {
            const buffer = await photoResponse.arrayBuffer();
            const base64 = Buffer.from(buffer).toString('base64');
            const contentType = photoResponse.headers.get('content-type') || 'image/jpeg';

            photoInputs.push({
              filename: photo.filename,
              base64,
              mimeType: contentType,
            });
          }
        } catch (e) {
          log.warn('ProcessVlmQueue', `Failed to fetch photo ${photo.filename}: ${e}`);
        }
      }

      if (photoInputs.length > 0) {
        // Run VLM categorization
        const catResult = await categorizePhotos(dropNumber, photoInputs);
        categorization = catResult.map((r) => ({
          photo_filename: r.filename,
          vlm_predicted_step: r.predictedStep,
          vlm_confidence: r.confidence,
        }));

        // Save categorization results
        await pool.query(
          `UPDATE dr_photo_unified_reviews
           SET vlm_categorization_status = 'categorized',
               vlm_categorization_results = $1,
               updated_at = NOW()
           WHERE drop_number = $2`,
          [JSON.stringify(categorization), dropNumber]
        );

        result.categorized = true;
        log.info('ProcessVlmQueue', `Categorized ${photoInputs.length} photos for ${dropNumber}`);
      }
    } else {
      result.categorized = true;
    }

    // Step 2: Extract data from Step 6, 7, 9 photos
    // Find photos for each step
    const photosWithSteps = photos.map((p) => {
      const cat = categorization.find(
        (c: { photo_filename: string; vlm_predicted_step?: number; human_override_step?: number }) =>
          c.photo_filename === p.filename
      );
      return {
        ...p,
        step: cat?.human_override_step ?? cat?.vlm_predicted_step ?? p.step ?? null,
      };
    });

    // Get ALL photos for each step - VLM will try each to find best result
    const step6Photos = photosWithSteps.filter((p) => p.step === 6);
    const step7Photos = photosWithSteps.filter((p) => p.step === 7);
    const step9Photos = photosWithSteps.filter((p) => p.step === 9);

    // Only run extraction if we have at least one of these photos
    if (step6Photos.length > 0 || step7Photos.length > 0 || step9Photos.length > 0) {
      log.info('ProcessVlmQueue', `Extracting data for ${dropNumber}`, {
        step6Count: step6Photos.length,
        step7Count: step7Photos.length,
        step9Count: step9Photos.length,
      });

      const extraction = await runFullExtraction(dropNumber, {
        step6Urls: step6Photos.length > 0 ? step6Photos.map(p => `${ONEMAP_HOST}/api/photo/${dropNumber}/${p.filename}`) : undefined,
        step7Urls: step7Photos.length > 0 ? step7Photos.map(p => `${ONEMAP_HOST}/api/photo/${dropNumber}/${p.filename}`) : undefined,
        step9Urls: step9Photos.length > 0 ? step9Photos.map(p => `${ONEMAP_HOST}/api/photo/${dropNumber}/${p.filename}`) : undefined,
      });

      // Build validation data
      const validationData: DrValidationData = {
        drNumber: dropNumber,
        photoCount: photos.length,
        photos: photosWithSteps.map((p) => ({ filename: p.filename, step: p.step ?? null })),
        ontSerial: dr.onemap_ont_serial,
        upsSerial: dr.onemap_ups_serial,
        powerMeterDbm: extraction.powerMeter?.value ?? null,
        vlmOntSerialStep6: extraction.ontSerialStep6?.serial ?? null,
        vlmOntSerialStep9: extraction.step9?.ontSerial.serial ?? null,
        vlmDrNumberStep9: extraction.step9?.drNumber.drNumber ?? null,
      };

      const powerMeterResult = validatePowerMeter(validationData.powerMeterDbm);
      const serialResult = validateSerialCrossReference(validationData);

      const serialValidationDetails = JSON.stringify({
        onemapSerial: serialResult.onemapSerial,
        step6Serial: serialResult.step6Serial,
        step9Serial: serialResult.step9Serial,
        step9DrNumber: serialResult.step9DrNumber,
        ontMatch: serialResult.ontMatch,
        drMatch: serialResult.drMatch,
      });

      // Save extraction results directly to unified table (migration 127)
      await pool.query(
        `UPDATE dr_photo_unified_reviews SET
           vlm_power_meter_dbm = $1,
           vlm_power_meter_status = $2,
           vlm_ont_serial_step6 = $3,
           vlm_ont_serial_step9 = $4,
           vlm_dr_number_step9 = $5,
           serial_validation_status = $6,
           serial_validation_details = $7,
           serial_extraction_method_step6 = $8,
           serial_extraction_method_step9 = $9,
           data_validation_completed = true,
           data_validation_completed_at = NOW(),
           qa_phase = 'final_decision',
           onemap_ont_serial = COALESCE($10, onemap_ont_serial),
           onemap_ups_serial = COALESCE($11, onemap_ups_serial),
           overall_status = 'PASS',
           updated_at = NOW()
         WHERE drop_number = $12`,
        [
          extraction.powerMeter?.value ?? null,
          powerMeterResult.status,
          extraction.ontSerialStep6?.serial ?? null,
          extraction.step9?.ontSerial.serial ?? null,
          extraction.step9?.drNumber.drNumber ?? null,
          serialResult.status,
          serialValidationDetails,
          extraction.ontSerialStep6?.extractionMethod ?? 'vlm',
          extraction.step9?.ontSerial.extractionMethod ?? 'vlm',
          dr.onemap_ont_serial ?? null,
          dr.onemap_ups_serial ?? null,
          dropNumber,
        ]
      );

      result.extracted = true;
      result.powerMeter = extraction.powerMeter?.value ?? null;
      result.ontSerial = extraction.ontSerialStep6?.serial ?? extraction.step9?.ontSerial.serial ?? null;
      result.drNumber = extraction.step9?.drNumber.drNumber ?? null;

      log.info('ProcessVlmQueue', `Extraction complete for ${dropNumber}`, {
        powerMeter: result.powerMeter,
        ontSerial: result.ontSerial,
        drNumber: result.drNumber,
      });
    }

    result.success = true;
    return result;
  } catch (error) {
    result.error = error instanceof Error ? error.message : 'Unknown error';
    log.error('ProcessVlmQueue', `Error processing ${dropNumber}`, { error: result.error });
    return result;
  }
}

/**
 * Main handler
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ProcessResponse | { error: string }>
): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verify cron secret in production
  const authHeader = req.headers.authorization;
  const cronSecret = process.env.CRON_SECRET;

  if (process.env.NODE_ENV === 'production' && cronSecret) {
    if (authHeader !== `Bearer ${cronSecret}`) {
      log.error('ProcessVlmQueue', 'Unauthorized request');
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const limit = Number(req.query.limit) || Number(req.body?.limit) || 10;

  log.info('ProcessVlmQueue', `Starting VLM queue processing (limit: ${limit})`);

  try {
    // Find DRs that need VLM processing:
    // - Have photos (photo_count > 0)
    // - Don't have VLM extraction data yet (all from unified table after migration 127)
    const pendingResult = await pool.query(
      `SELECT drop_number
       FROM dr_photo_unified_reviews
       WHERE photo_count > 0
         AND vlm_power_meter_dbm IS NULL
         AND vlm_ont_serial_step6 IS NULL
         AND vlm_ont_serial_step9 IS NULL
       ORDER BY created_at DESC
       LIMIT $1`,
      [limit]
    );

    const pendingDRs = pendingResult.rows;

    if (pendingDRs.length === 0) {
      log.info('ProcessVlmQueue', 'No DRs need VLM processing');
      return res.status(200).json({
        success: true,
        processed: 0,
        succeeded: 0,
        failed: 0,
        results: [],
        timestamp: new Date().toISOString(),
      });
    }

    log.info('ProcessVlmQueue', `Found ${pendingDRs.length} DRs to process`);

    const results: ProcessResult[] = [];
    let succeeded = 0;
    let failed = 0;

    for (const row of pendingDRs) {
      const result = await processVlmForDr(row.drop_number);
      results.push(result);

      if (result.success) {
        succeeded++;
      } else {
        failed++;
      }

      // Delay between DRs to avoid overwhelming VLM
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    log.info('ProcessVlmQueue', `Completed: ${succeeded}/${pendingDRs.length} succeeded`, {
      failed,
    });

    return res.status(200).json({
      success: true,
      processed: pendingDRs.length,
      succeeded,
      failed,
      results,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    log.error('ProcessVlmQueue', `Fatal error: ${errorMessage}`, { stack: errorStack });
    return res.status(500).json({
      error: errorMessage || 'Failed to process VLM queue',
    });
  }
}

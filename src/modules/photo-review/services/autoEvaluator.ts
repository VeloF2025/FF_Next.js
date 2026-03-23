/**
 * Auto-Evaluator Service
 * Automatically evaluates new drops from WA Monitor (human approval required for feedback)
 *
 * Flow:
 * 1. Detect new drops in qa_photo_reviews (not yet evaluated)
 * 2. Fetch photos from BOSS VPS API
 * 3. Run VLM evaluation (smart batch processing)
 * 4. Save results to foto_ai_reviews
 * 5. Human agent reviews and manually sends feedback (NOT automatic)
 */

import { fetchDrPhotos, executeVlmEvaluation } from './fotoVlmService';
import { saveEvaluation, getEvaluationByDR } from './fotoDbService';
import { QA_STEPS } from './fotoVlmService';
import { log } from '@/lib/logger';

// ==================== TYPES ====================

export interface AutoEvaluationResult {
  dr_number: string;
  success: boolean;
  evaluation_id?: string;
  feedback_sent?: boolean;
  error?: string;
  photos_count?: number;
  processing_time_ms?: number;
}

export interface AutoProcessorStats {
  total_processed: number;
  successful: number;
  failed: number;
  skipped: number;
  errors: string[];
}

// ==================== CONFIGURATION ====================

const CONFIG = {
  // Retry configuration
  MAX_RETRIES: 3,
  RETRY_DELAY_MS: 60000, // 1 minute

  // Rate limiting (prevent API overload)
  MAX_CONCURRENT_EVALUATIONS: 3,
  BATCH_SIZE: 10, // Process max 10 drops per run

  // Photo availability
  MIN_PHOTOS_REQUIRED: 3, // Skip if less than 3 photos

  // Dry run mode (test without actually sending feedback)
  DRY_RUN: process.env.AUTO_EVALUATOR_DRY_RUN === 'true',

  // Auto-send feedback DISABLED - feedback must always be sent by a human operator
  // See fix/human-qa-feedback-guard: env var no longer honored
  AUTO_SEND_FEEDBACK: false,
};

// ==================== HELPER FUNCTIONS ====================

/**
 * Sleep utility for retry delays
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Check if DR was already evaluated
 */
async function isAlreadyEvaluated(drNumber: string): Promise<boolean> {
  try {
    const existing = await getEvaluationByDR(drNumber);
    return existing !== null;
  } catch (error) {
    log.error('autoEvaluator', { message: `Error checking if ${drNumber} is evaluated`, error });
    return false; // Assume not evaluated on error (will be caught later)
  }
}

// sendAutoFeedback REMOVED — feedback must always be sent by a human operator
// See fix/human-qa-feedback-guard for context

// ==================== CORE AUTO-EVALUATION ====================

/**
 * Auto-evaluate a single drop
 *
 * @param drNumber - Drop record number
 * @param project - Project name (for WhatsApp routing)
 * @returns Evaluation result with success status
 */
export async function autoEvaluateDrop(
  drNumber: string,
  project?: string
): Promise<AutoEvaluationResult> {
  const startTime = Date.now();

  log.debug('autoEvaluator', { message: `[AUTO] Starting evaluation for ${drNumber}`, project: project || 'Unknown' });

  try {
    // 1. Check if already evaluated (prevent duplicates)
    const alreadyEvaluated = await isAlreadyEvaluated(drNumber);
    if (alreadyEvaluated) {
      log.debug('autoEvaluator', { message: `[AUTO] Skipping ${drNumber} - already evaluated` });
      return {
        dr_number: drNumber,
        success: false,
        error: 'Already evaluated',
      };
    }

    // 2. Fetch photos from BOSS VPS API
    log.debug('autoEvaluator', { message: `[AUTO] Fetching photos for ${drNumber}...` });
    const photos = await fetchDrPhotos(drNumber);

    if (!photos || photos.length === 0) {
      log.debug('autoEvaluator', { message: `[AUTO] No photos found for ${drNumber}, skipping` });
      return {
        dr_number: drNumber,
        success: false,
        error: 'No photos available',
        photos_count: 0,
      };
    }

    if (photos.length < CONFIG.MIN_PHOTOS_REQUIRED) {
      log.debug('autoEvaluator', {
        message: `[AUTO] Only ${photos.length} photos for ${drNumber}, skipping`,
        photos_count: photos.length,
        min_required: CONFIG.MIN_PHOTOS_REQUIRED
      });
      return {
        dr_number: drNumber,
        success: false,
        error: `Insufficient photos (${photos.length} < ${CONFIG.MIN_PHOTOS_REQUIRED})`,
        photos_count: photos.length,
      };
    }

    log.debug('autoEvaluator', { message: `[AUTO] Found ${photos.length} photos for ${drNumber}`, photos_count: photos.length });

    // 3. Run VLM evaluation (smart batch processing)
    log.debug('autoEvaluator', { message: `[AUTO] Running VLM evaluation for ${drNumber}...` });
    const evaluation = await executeVlmEvaluation(drNumber, photos, QA_STEPS);

    // 4. Save to database
    log.debug('autoEvaluator', { message: `[AUTO] Saving evaluation for ${drNumber}...` });
    const saved = await saveEvaluation(evaluation);

    // 5. Feedback is NEVER sent automatically — requires human HITL approval
    const feedbackSent = false;
    log.debug('autoEvaluator', { message: `[AUTO] Feedback NOT sent for ${drNumber} - requires human approval` });

    const processingTime = Date.now() - startTime;

    log.debug('autoEvaluator', {
      message: `[AUTO] Completed ${drNumber}`,
      processing_time_ms: processingTime,
      passed_steps: evaluation.passed_steps,
      total_steps: evaluation.total_steps
    });

    return {
      dr_number: drNumber,
      success: true,
      evaluation_id: saved.dr_number,
      feedback_sent: feedbackSent,
      photos_count: photos.length,
      processing_time_ms: processingTime,
    };
  } catch (error) {
    const processingTime = Date.now() - startTime;
    log.error('autoEvaluator', {
      message: `[AUTO] Failed to evaluate ${drNumber}`,
      error,
      processing_time_ms: processingTime
    });

    return {
      dr_number: drNumber,
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      processing_time_ms: processingTime,
    };
  }
}

/**
 * Auto-evaluate drop with retry logic
 *
 * @param drNumber - Drop record number
 * @param project - Project name
 * @param retryCount - Current retry attempt
 * @returns Evaluation result
 */
export async function autoEvaluateDropWithRetry(
  drNumber: string,
  project?: string,
  retryCount: number = 0
): Promise<AutoEvaluationResult> {
  try {
    return await autoEvaluateDrop(drNumber, project);
  } catch (error) {
    if (retryCount < CONFIG.MAX_RETRIES) {
      log.error('autoEvaluator', {
        message: `[AUTO] Retry ${retryCount + 1}/${CONFIG.MAX_RETRIES} for ${drNumber}`,
        error,
        retry_count: retryCount + 1,
        max_retries: CONFIG.MAX_RETRIES
      });
      await sleep(CONFIG.RETRY_DELAY_MS);
      return autoEvaluateDropWithRetry(drNumber, project, retryCount + 1);
    }

    // Max retries exceeded
    log.error('autoEvaluator', {
      message: `[AUTO] Failed ${drNumber} after ${CONFIG.MAX_RETRIES} retries`,
      error,
      max_retries: CONFIG.MAX_RETRIES
    });

    return {
      dr_number: drNumber,
      success: false,
      error: `Failed after ${CONFIG.MAX_RETRIES} retries: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`,
    };
  }
}

/**
 * Process multiple drops in batch
 * Uses controlled concurrency to prevent API overload
 *
 * @param drops - Array of drops to process
 * @returns Processing statistics
 */
export async function autoProcessDropsBatch(
  drops: Array<{ drop_number: string; project?: string }>
): Promise<AutoProcessorStats> {
  log.debug('autoEvaluator', { message: `[AUTO] Processing batch of ${drops.length} drops...`, batch_size: drops.length });

  const stats: AutoProcessorStats = {
    total_processed: 0,
    successful: 0,
    failed: 0,
    skipped: 0,
    errors: [],
  };

  // Process in controlled batches (prevent API overload)
  for (let i = 0; i < drops.length; i += CONFIG.MAX_CONCURRENT_EVALUATIONS) {
    const batch = drops.slice(i, i + CONFIG.MAX_CONCURRENT_EVALUATIONS);

    log.debug('autoEvaluator', {
      message: `[AUTO] Processing batch ${Math.floor(i / CONFIG.MAX_CONCURRENT_EVALUATIONS) + 1}/${Math.ceil(drops.length / CONFIG.MAX_CONCURRENT_EVALUATIONS)}`,
      batch_size: batch.length
    });

    // Process batch concurrently
    const results = await Promise.all(
      batch.map(drop =>
        autoEvaluateDropWithRetry(drop.drop_number, drop.project)
      )
    );

    // Update stats
    for (const result of results) {
      stats.total_processed++;

      if (result.success) {
        stats.successful++;
      } else if (result.error?.includes('Already evaluated')) {
        stats.skipped++;
      } else {
        stats.failed++;
        if (result.error) {
          stats.errors.push(`${result.dr_number}: ${result.error}`);
        }
      }
    }

    // Rate limiting delay between batches
    if (i + CONFIG.MAX_CONCURRENT_EVALUATIONS < drops.length) {
      log.debug('autoEvaluator', { message: '[AUTO] Waiting 5 seconds before next batch...' });
      await sleep(5000);
    }
  }

  log.debug('autoEvaluator', { message: '[AUTO] Batch processing complete', stats });
  return stats;
}

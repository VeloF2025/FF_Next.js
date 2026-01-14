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

  // Auto-send feedback (false = human approval required)
  AUTO_SEND_FEEDBACK: process.env.AUTO_EVALUATOR_SEND_FEEDBACK === 'true', // Default: false
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
    console.error(`Error checking if ${drNumber} is evaluated:`, error);
    return false; // Assume not evaluated on error (will be caught later)
  }
}

/**
 * Send WhatsApp feedback for evaluation
 * Calls existing /api/foto/feedback endpoint
 */
async function sendAutoFeedback(
  drNumber: string,
  project?: string
): Promise<boolean> {
  try {
    if (CONFIG.DRY_RUN) {
      console.log(`[DRY RUN] Would send feedback for ${drNumber} to project: ${project}`);
      return true;
    }

    // Call internal API (same server)
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3005';
    const response = await fetch(`${baseUrl}/api/foto/feedback`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        dr_number: drNumber,
        project: project,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        errorData.message || `Feedback API returned ${response.status}`
      );
    }

    const result = await response.json();
    console.log(`[AUTO] Feedback sent for ${drNumber}:`, result.message);
    return true;
  } catch (error) {
    console.error(`[AUTO] Failed to send feedback for ${drNumber}:`, error);
    return false;
  }
}

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

  console.log(`[AUTO] Starting evaluation for ${drNumber} (project: ${project || 'Unknown'})`);

  try {
    // 1. Check if already evaluated (prevent duplicates)
    const alreadyEvaluated = await isAlreadyEvaluated(drNumber);
    if (alreadyEvaluated) {
      console.log(`[AUTO] Skipping ${drNumber} - already evaluated`);
      return {
        dr_number: drNumber,
        success: false,
        error: 'Already evaluated',
      };
    }

    // 2. Fetch photos from BOSS VPS API
    console.log(`[AUTO] Fetching photos for ${drNumber}...`);
    const photos = await fetchDrPhotos(drNumber);

    if (!photos || photos.length === 0) {
      console.log(`[AUTO] No photos found for ${drNumber}, skipping`);
      return {
        dr_number: drNumber,
        success: false,
        error: 'No photos available',
        photos_count: 0,
      };
    }

    if (photos.length < CONFIG.MIN_PHOTOS_REQUIRED) {
      console.log(
        `[AUTO] Only ${photos.length} photos for ${drNumber}, skipping (min: ${CONFIG.MIN_PHOTOS_REQUIRED})`
      );
      return {
        dr_number: drNumber,
        success: false,
        error: `Insufficient photos (${photos.length} < ${CONFIG.MIN_PHOTOS_REQUIRED})`,
        photos_count: photos.length,
      };
    }

    console.log(`[AUTO] Found ${photos.length} photos for ${drNumber}`);

    // 3. Run VLM evaluation (smart batch processing)
    console.log(`[AUTO] Running VLM evaluation for ${drNumber}...`);
    const evaluation = await executeVlmEvaluation(drNumber, photos, QA_STEPS);

    // 4. Save to database
    console.log(`[AUTO] Saving evaluation for ${drNumber}...`);
    const saved = await saveEvaluation(evaluation);

    // 5. Send WhatsApp feedback (only if AUTO_SEND_FEEDBACK is enabled)
    let feedbackSent = false;
    if (CONFIG.AUTO_SEND_FEEDBACK) {
      console.log(`[AUTO] Sending feedback for ${drNumber}...`);
      feedbackSent = await sendAutoFeedback(drNumber, project);
    } else {
      console.log(`[AUTO] Feedback NOT sent for ${drNumber} - requires human approval`);
      // Human agent will review and send feedback manually via UI
    }

    const processingTime = Date.now() - startTime;

    console.log(
      `[AUTO] ✅ Completed ${drNumber} in ${processingTime}ms (${evaluation.passed_steps}/${evaluation.total_steps} passed)`
    );

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
    console.error(`[AUTO] ❌ Failed to evaluate ${drNumber}:`, error);

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
      console.error(
        `[AUTO] Retry ${retryCount + 1}/${CONFIG.MAX_RETRIES} for ${drNumber} after error:`,
        error
      );
      await sleep(CONFIG.RETRY_DELAY_MS);
      return autoEvaluateDropWithRetry(drNumber, project, retryCount + 1);
    }

    // Max retries exceeded
    console.error(
      `[AUTO] ❌ Failed ${drNumber} after ${CONFIG.MAX_RETRIES} retries:`,
      error
    );

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
  console.log(`[AUTO] Processing batch of ${drops.length} drops...`);

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

    console.log(
      `[AUTO] Processing batch ${Math.floor(i / CONFIG.MAX_CONCURRENT_EVALUATIONS) + 1}/${Math.ceil(drops.length / CONFIG.MAX_CONCURRENT_EVALUATIONS)} (${batch.length} drops)...`
    );

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
      console.log('[AUTO] Waiting 5 seconds before next batch...');
      await sleep(5000);
    }
  }

  console.log(`[AUTO] Batch processing complete:`, stats);
  return stats;
}

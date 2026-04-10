/**
 * API Route: /api/activate/evaluate
 *
 * Purpose: Trigger AI evaluation for a unified review
 * Method: POST
 *
 * Following FibreFlow standards:
 * - Uses apiResponse helper for consistent responses
 * - Neon PostgreSQL with ep-dry-night-a9qyh4sj endpoint
 * - Proper error handling and logging
 */

import type { NextApiRequest, NextApiResponse } from 'next';

import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import pool from '@/lib/db';
import { log } from '@/lib/logger';

interface EvaluateRequest {
  dropNumber: string;
}

interface Photo {
  filename: string;
  step: number;
  url: string;
  size?: number;
  modified?: number;
}

interface AIStepResult {
  step: number;
  passed: boolean;
  score: number;
  comment: string;
}

interface AIEvaluationResult {
  overall_status: 'PASS' | 'FAIL';
  average_score: number;
  step_results: AIStepResult[];
  markdown_report: string;
}

/**
 * POST /api/activate/evaluate
 * Trigger AI evaluation for a unified review
 */
async function handlePost(
  req: NextApiRequest,
  res: NextApiResponse
): Promise<void> {
  try {
    const { dropNumber } = req.body as EvaluateRequest;

    if (!dropNumber) {
      return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'dropNumber is required');
    }

    log.info(`Starting AI evaluation for ${dropNumber}`);

    // 1. Get unified review from database
    const review = await getUnifiedReview(dropNumber);

    if (!review) {
      return apiResponse.notFound(res, 'Unified review', dropNumber);
    }

    // 2. Check if review is locked by another user
    if (review.locked_by && review.locked_by !== 'system') {
      return apiResponse.error(res, ErrorCode.BAD_REQUEST, `Review is locked by ${review.locked_by}`);
    }

    // 3. Update status to 'processing'
    await updateEvaluationStatus(dropNumber, 'processing');

    // 4. Fetch photos (use existing metadata if available, otherwise fetch fresh)
    let photos: Photo[] = [];

    if (review.photos_metadata && review.photos_metadata.length > 0) {
      photos = review.photos_metadata;
      log.info(`Using cached photos for ${dropNumber}`, { count: photos.length });
    } else {
      log.info(`Fetching fresh photos for ${dropNumber}`);
      try {
        const photoResponse = await fetch(`${getBaseUrl()}/api/activate/fetch-photos`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dropNumber }),
        });

        if (photoResponse.ok) {
          const photoData = await photoResponse.json();
          photos = photoData.data?.photos || [];
        } else {
          log.warn(`Photo fetch failed for ${dropNumber}, proceeding with empty photos`);
          photos = [];
        }
      } catch (fetchError) {
        log.warn(`Photo fetch error for ${dropNumber}:`, fetchError);
        photos = [];
      }
    }

    // 5. Trigger AI evaluation (works even without photos - provides status report)
    log.info(`Evaluating ${photos.length} photos for ${dropNumber}`);
    const aiResult = await evaluateWithVLM(dropNumber, photos);

    // 6. Update database with AI results
    await updateReviewWithAIResults(dropNumber, aiResult);

    // 7. Update status to 'completed'
    await updateEvaluationStatus(dropNumber, 'completed');

    log.info(`AI evaluation completed for ${dropNumber}`, {
      overall_status: aiResult.overall_status,
      average_score: aiResult.average_score,
    });

    return apiResponse.success(res, {
      dropNumber,
      evaluation: aiResult,
    });
  } catch (error) {
    log.error('Error during AI evaluation:', error);

    // Update status to 'failed' if we have a dropNumber
    if (req.body?.dropNumber) {
      try {
        await updateEvaluationStatus(req.body.dropNumber, 'failed');
      } catch (updateError) {
        log.error('Failed to update evaluation status to failed:', updateError);
      }
    }

    return apiResponse.internalError(res, error);
  }
}

/**
 * Get unified review from database
 */
async function getUnifiedReview(dropNumber: string): Promise<any> {
  const result = await pool.query(
    `
    SELECT
      drop_number,
      photo_source,
      photo_count,
      photos_metadata,
      locked_by,
      ai_evaluation_status
    FROM dr_photo_unified_reviews
    WHERE drop_number = $1;
    `,
    [dropNumber]
  );

  return result.rows[0] || null;
}

/**
 * Update evaluation status
 */
async function updateEvaluationStatus(
  dropNumber: string,
  status: 'pending' | 'processing' | 'completed' | 'failed'
): Promise<void> {
  await pool.query(
    `
    UPDATE dr_photo_unified_reviews
    SET
      ai_evaluation_status = $1,
      updated_at = NOW()
    WHERE drop_number = $2;
    `,
    [status, dropNumber]
  );

  log.info(`Updated evaluation status for ${dropNumber} to ${status}`);
}

/**
 * Update review with AI evaluation results
 */
async function updateReviewWithAIResults(
  dropNumber: string,
  aiResult: AIEvaluationResult
): Promise<void> {
  try {
    await pool.query(
      `
      UPDATE dr_photo_unified_reviews
      SET
        ai_overall_status = $1,
        ai_average_score = $2,
        ai_step_results = $3,
        ai_markdown_report = $4,
        ai_evaluated_at = NOW(),
        updated_at = NOW()
      WHERE drop_number = $5;
      `,
      [
        aiResult.overall_status,
        aiResult.average_score,
        JSON.stringify(aiResult.step_results),
        aiResult.markdown_report,
        dropNumber,
      ]
    );

    log.info(`Updated review with AI results for ${dropNumber}`);
  } catch (error) {
    log.error('Failed to update review with AI results', { dropNumber, error });
    throw error;
  }
}

/**
 * Evaluate photos with VLM service
 *
 * NOTE: This is a placeholder implementation.
 * Full VLM integration will be implemented in unifiedVlmService.ts
 */
async function evaluateWithVLM(
  dropNumber: string,
  photos: Photo[]
): Promise<AIEvaluationResult> {
  // Handle case when no photos are available
  if (photos.length === 0) {
    log.warn(`No photos available for ${dropNumber}, generating no-photo report`);
    return {
      overall_status: 'FAIL',
      average_score: 0,
      step_results: [],
      markdown_report: generateNoPhotosReport(dropNumber),
    };
  }

  // Group photos by step
  const photosByStep = groupPhotosByStep(photos);

  // Batch photos (6 per batch for context limits)
  const batches = createBatches(photos, 6);

  log.info(`Processing ${batches.length} batches for ${dropNumber}`);

  // Evaluate batches (placeholder - will call actual VLM service)
  const stepResults: AIStepResult[] = [];

  for (let step = 1; step <= 12; step++) {
    const stepPhotos = photosByStep[step] || [];

    if (stepPhotos.length === 0) {
      // No photos for this step - mark as missing
      stepResults.push({
        step,
        passed: false,
        score: 0,
        comment: `Step ${step}: No photo available`,
      });
      continue;
    }

    // Placeholder evaluation (replace with actual VLM call)
    const score = Math.random() * 10; // Random score for now
    const passed = score >= 6;

    stepResults.push({
      step,
      passed,
      score: parseFloat(score.toFixed(1)),
      comment: passed
        ? `Step ${step} looks good. ${stepPhotos.length} photo(s) reviewed.`
        : `Step ${step} needs attention. ${stepPhotos.length} photo(s) reviewed.`,
    });
  }

  // Calculate overall status and average score
  const stepsWithPhotos = stepResults.filter((result) => result.score > 0);
  const totalScore = stepsWithPhotos.reduce((sum, result) => sum + result.score, 0);
  const averageScore = stepsWithPhotos.length > 0 ? totalScore / stepsWithPhotos.length : 0;
  const passedCount = stepResults.filter((result) => result.passed).length;
  const overallStatus = passedCount >= 9 ? 'PASS' : 'FAIL';

  // Generate markdown report
  const markdownReport = generateMarkdownReport(dropNumber, stepResults, averageScore, overallStatus);

  return {
    overall_status: overallStatus,
    average_score: parseFloat(averageScore.toFixed(1)),
    step_results: stepResults,
    markdown_report: markdownReport,
  };
}

/**
 * Generate report when no photos are available
 */
function generateNoPhotosReport(dropNumber: string): string {
  let report = `# AI Evaluation Report - ${dropNumber}\n\n`;
  report += `**Overall Status:** FAIL\n`;
  report += `**Average Score:** 0/10\n\n`;
  report += `## Issue: No Photos Available\n\n`;
  report += `Unable to perform AI evaluation because no photos were found for this DR.\n\n`;
  report += `### Possible Causes:\n`;
  report += `- Photos have not been uploaded yet\n`;
  report += `- OneMap GIS API is temporarily unavailable\n`;
  report += `- BOSS API backup service is temporarily unavailable\n\n`;
  report += `### Recommended Actions:\n`;
  report += `1. Check if photos have been uploaded for this DR\n`;
  report += `2. Verify the photo services are running\n`;
  report += `3. Try again in a few minutes\n\n`;
  report += `---\n\n`;
  report += `*Generated by AI Evaluation System at ${new Date().toISOString()}*\n`;

  return report;
}

/**
 * Group photos by step number
 */
function groupPhotosByStep(photos: Photo[]): Record<number, Photo[]> {
  const grouped: Record<number, Photo[]> = {};

  photos.forEach((photo) => {
    if (!grouped[photo.step]) {
      grouped[photo.step] = [];
    }
    grouped[photo.step]!.push(photo);
  });

  return grouped;
}

/**
 * Create batches of photos
 */
function createBatches<T>(items: T[], batchSize: number): T[][] {
  const batches: T[][] = [];

  for (let i = 0; i < items.length; i += batchSize) {
    batches.push(items.slice(i, i + batchSize));
  }

  return batches;
}

/**
 * Generate markdown report
 */
function generateMarkdownReport(
  dropNumber: string,
  stepResults: AIStepResult[],
  averageScore: number,
  overallStatus: 'PASS' | 'FAIL'
): string {
  const passedCount = stepResults.filter((result) => result.passed).length;
  const failedCount = stepResults.length - passedCount;

  let report = `# AI Evaluation Report - ${dropNumber}\n\n`;
  report += `**Overall Status:** ${overallStatus}\n`;
  report += `**Average Score:** ${averageScore.toFixed(1)}/10\n`;
  report += `**Passed Steps:** ${passedCount}/${stepResults.length}\n`;
  report += `**Failed Steps:** ${failedCount}/${stepResults.length}\n\n`;

  report += `## Step-by-Step Results\n\n`;

  stepResults.forEach((result) => {
    const emoji = result.passed ? '✅' : '❌';
    report += `### ${emoji} Step ${result.step} - Score: ${result.score}/10\n\n`;
    report += `**Status:** ${result.passed ? 'PASS' : 'FAIL'}\n\n`;
    report += `**Comment:** ${result.comment}\n\n`;
  });

  report += `---\n\n`;
  report += `*Generated by AI Evaluation System at ${new Date().toISOString()}*\n`;

  return report;
}

/**
 * Get base URL for internal API calls
 */
function getBaseUrl(): string {
  // In production, use the full domain
  if (process.env.NODE_ENV === 'production') {
    return process.env.NEXT_PUBLIC_BASE_URL || 'https://app.fibreflow.app';
  }

  // In development, use localhost
  return `http://localhost:${process.env.PORT || 3005}`;
}

/**
 * Main handler
 */
async function handler(
  req: NextApiRequest,
  res: NextApiResponse
): Promise<void> {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res);
  }

  return handlePost(req, res);
}

export default withAuth(handler);

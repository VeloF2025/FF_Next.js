/**
 * Auto-Approval Service
 *
 * Purpose: Determine which VLM categorizations can be auto-approved
 * based on confidence scores and per-step historical accuracy.
 *
 * Tiers:
 * - auto_approved: High confidence + historically accurate step → skip human review
 * - review_recommended: Medium confidence → show for quick review, pre-approved
 * - human_required: Low confidence or historically problematic step → must review
 */

import { log } from '@/lib/logger';
import db from '@/lib/db';
import type { VlmCategorizationResult } from '../types/unified.types';

// ============================================================================
// TYPES
// ============================================================================

export type AutoApprovalTier = 'auto_approved' | 'review_recommended' | 'human_required';

export interface AutoApprovalResult {
  photo_filename: string;
  tier: AutoApprovalTier;
  reason: string;
}

export interface StepAccuracy {
  step: number;
  totalPredictions: number;
  correctPredictions: number;
  correctionCount: number;
  accuracyRate: number;
}

export interface AutoApprovalSummary {
  autoApproved: number;
  reviewRecommended: number;
  humanRequired: number;
  totalPhotos: number;
  overallAccuracy: number | null;
}

// ============================================================================
// CONFIGURATION
// ============================================================================

/** Minimum confidence for auto-approval (high confidence) */
const AUTO_APPROVE_CONFIDENCE = 0.92;

/** Minimum confidence for review-recommended tier */
const REVIEW_CONFIDENCE = 0.70;

/** Minimum historical accuracy rate for a step to allow auto-approval */
const MIN_STEP_ACCURACY_FOR_AUTO = 0.85;

/** Minimum number of past predictions for a step before trusting accuracy stats */
const MIN_PREDICTIONS_FOR_STATS = 10;

// ============================================================================
// PER-STEP ACCURACY
// ============================================================================

/**
 * Get per-step accuracy from correction history.
 *
 * Calculates how accurate VLM has been for each step by comparing
 * total categorizations vs corrections (overrides).
 */
export async function getStepAccuracy(): Promise<Map<number, StepAccuracy>> {
  const accuracyMap = new Map<number, StepAccuracy>();

  try {
    // Get correction counts per VLM-predicted step
    const correctionResult = await db.query<{
      vlm_predicted_step: number;
      correction_count: string;
    }>(
      `SELECT vlm_predicted_step, COUNT(*) as correction_count
       FROM qa_correction_examples
       WHERE workflow_type = 'dr_photo'
       GROUP BY vlm_predicted_step`
    );

    // Get total categorization counts per step from recent reviews
    // We approximate total predictions from approved reviews
    const totalResult = await db.query<{
      step: number;
      total: string;
    }>(
      `SELECT
         elem->>'vlm_predicted_step' AS step,
         COUNT(*) as total
       FROM dr_photo_unified_reviews,
            jsonb_array_elements(vlm_categorization_results::jsonb) AS elem
       WHERE vlm_categorization_status IN ('categorized', 'approved')
         AND vlm_categorization_results IS NOT NULL
       GROUP BY elem->>'vlm_predicted_step'`
    );

    // Build accuracy map from totals
    for (const row of totalResult.rows) {
      const step = parseInt(String(row.step), 10);
      if (isNaN(step) || step < 1 || step > 12) continue;

      accuracyMap.set(step, {
        step,
        totalPredictions: parseInt(row.total, 10),
        correctPredictions: parseInt(row.total, 10), // Start with all correct
        correctionCount: 0,
        accuracyRate: 1.0,
      });
    }

    // Subtract corrections to get actual accuracy
    for (const row of correctionResult.rows) {
      const step = row.vlm_predicted_step;
      const corrections = parseInt(row.correction_count, 10);
      const existing = accuracyMap.get(step);

      if (existing) {
        existing.correctionCount = corrections;
        existing.correctPredictions = Math.max(0, existing.totalPredictions - corrections);
        existing.accuracyRate = existing.totalPredictions > 0
          ? existing.correctPredictions / existing.totalPredictions
          : 0;
      } else {
        // Step only has corrections, no total data — assume low accuracy
        accuracyMap.set(step, {
          step,
          totalPredictions: corrections,
          correctPredictions: 0,
          correctionCount: corrections,
          accuracyRate: 0,
        });
      }
    }

    log.debug('AutoApproval', {
      action: 'getStepAccuracy',
      steps: Array.from(accuracyMap.values()).map(s => ({
        step: s.step,
        accuracy: Math.round(s.accuracyRate * 100),
        total: s.totalPredictions,
      })),
    });

    return accuracyMap;
  } catch (error) {
    log.warn('AutoApproval', {
      action: 'getStepAccuracy',
      error: error instanceof Error ? error.message : String(error),
    });
    // Return empty map — fall back to confidence-only tiers
    return accuracyMap;
  }
}

// ============================================================================
// TIER ASSIGNMENT
// ============================================================================

/**
 * Assign auto-approval tiers to categorization results.
 *
 * Rules:
 * - auto_approved: confidence >= 0.92 AND step accuracy >= 85% (with enough data)
 * - review_recommended: confidence >= 0.70
 * - human_required: confidence < 0.70 OR step has historically low accuracy
 */
export function assignTiers(
  results: VlmCategorizationResult[],
  stepAccuracy: Map<number, StepAccuracy>
): AutoApprovalResult[] {
  return results.map((result) => {
    const step = result.vlm_predicted_step;
    const confidence = result.vlm_confidence;
    const accuracy = stepAccuracy.get(step);

    // Error results always need human review
    if (step === 0 || result.vlm_predicted_category === 'Error') {
      return {
        photo_filename: result.photo_filename,
        tier: 'human_required' as AutoApprovalTier,
        reason: 'Categorization error',
      };
    }

    // Low confidence always needs human review
    if (confidence < REVIEW_CONFIDENCE) {
      return {
        photo_filename: result.photo_filename,
        tier: 'human_required' as AutoApprovalTier,
        reason: `Low confidence (${Math.round(confidence * 100)}%)`,
      };
    }

    // High confidence — check if step is historically accurate
    if (confidence >= AUTO_APPROVE_CONFIDENCE) {
      const hasEnoughData = accuracy && accuracy.totalPredictions >= MIN_PREDICTIONS_FOR_STATS;
      const stepIsReliable = !hasEnoughData || accuracy.accuracyRate >= MIN_STEP_ACCURACY_FOR_AUTO;

      if (stepIsReliable) {
        return {
          photo_filename: result.photo_filename,
          tier: 'auto_approved' as AutoApprovalTier,
          reason: hasEnoughData
            ? `High confidence (${Math.round(confidence * 100)}%) + step accuracy ${Math.round(accuracy.accuracyRate * 100)}%`
            : `High confidence (${Math.round(confidence * 100)}%) — insufficient history, trusting confidence`,
        };
      }

      // High confidence BUT step has bad track record
      return {
        photo_filename: result.photo_filename,
        tier: 'review_recommended' as AutoApprovalTier,
        reason: `High confidence but step ${step} accuracy is only ${Math.round((accuracy?.accuracyRate || 0) * 100)}%`,
      };
    }

    // Medium confidence → review recommended
    return {
      photo_filename: result.photo_filename,
      tier: 'review_recommended' as AutoApprovalTier,
      reason: `Medium confidence (${Math.round(confidence * 100)}%)`,
    };
  });
}

// ============================================================================
// SUMMARY
// ============================================================================

/**
 * Build summary of auto-approval tiers for UI display
 */
export function buildSummary(
  tiers: AutoApprovalResult[],
  stepAccuracy: Map<number, StepAccuracy>
): AutoApprovalSummary {
  const autoApproved = tiers.filter(t => t.tier === 'auto_approved').length;
  const reviewRecommended = tiers.filter(t => t.tier === 'review_recommended').length;
  const humanRequired = tiers.filter(t => t.tier === 'human_required').length;

  // Calculate overall accuracy from step accuracy data
  let totalPredictions = 0;
  let totalCorrect = 0;
  for (const acc of stepAccuracy.values()) {
    totalPredictions += acc.totalPredictions;
    totalCorrect += acc.correctPredictions;
  }
  const overallAccuracy = totalPredictions > 0 ? totalCorrect / totalPredictions : null;

  return {
    autoApproved,
    reviewRecommended,
    humanRequired,
    totalPhotos: tiers.length,
    overallAccuracy,
  };
}

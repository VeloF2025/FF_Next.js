/**
 * Harness Trigger Service - 2-Stage Pipeline
 *
 * Stage 1: POC Loop (quick validation, 1-5 hours)
 * Stage 2: Full Harness (production-ready, 4-24 hours)
 */

import { log } from '@/lib/logger';
import type { WishlistWorkType } from '../types/wishlist';

export type PipelineStage = 'poc' | 'harness';

interface TriggerBuildRequest {
  item_id: string;
  work_type: WishlistWorkType;
  stage: PipelineStage;
  github_issue_number: number;
  github_issue_url: string;
  spec: {
    title: string;
    description?: string;
    problem_statement?: string;
    acceptance_criteria?: string;
    target_module?: string;
    test_scenarios?: string;
    effort_estimate?: string;
    priority?: string;
  };
}

interface TriggerBuildResponse {
  success: boolean;
  run_id?: string;
  stage?: string;
  message?: string;
  error?: string;
}

const HARNESS_TRIGGER_URL = process.env.HARNESS_TRIGGER_URL || 'http://100.96.203.105:8096';
const HARNESS_TRIGGER_SECRET = process.env.HARNESS_TRIGGER_SECRET;

/**
 * Trigger POC validation (Stage 1)
 */
export async function triggerPocValidation(
  request: Omit<TriggerBuildRequest, 'stage'>
): Promise<TriggerBuildResponse> {
  return triggerBuild({ ...request, stage: 'poc' });
}

/**
 * Trigger full harness build (Stage 2)
 */
export async function triggerHarnessBuild(
  request: Omit<TriggerBuildRequest, 'stage'>
): Promise<TriggerBuildResponse> {
  return triggerBuild({ ...request, stage: 'harness' });
}

/**
 * Trigger build for a wishlist item (POC or Harness)
 */
async function triggerBuild(
  request: TriggerBuildRequest
): Promise<TriggerBuildResponse> {
  if (!HARNESS_TRIGGER_SECRET) {
    log.warn('HARNESS_TRIGGER_SECRET not configured', 'HarnessTrigger');
    return { success: false, error: 'Harness trigger not configured' };
  }

  const stageLabel = request.stage === 'poc' ? 'POC validation' : 'harness build';

  try {
    log.info(
      `Triggering ${stageLabel} for item ${request.item_id} (${request.work_type})`,
      'HarnessTrigger'
    );

    const response = await fetch(`${HARNESS_TRIGGER_URL}/trigger`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-secret': HARNESS_TRIGGER_SECRET,
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const errorText = await response.text();
      log.error(
        `${stageLabel} trigger failed: ${response.status} - ${errorText}`,
        null,
        'HarnessTrigger'
      );
      return {
        success: false,
        error: `${stageLabel} trigger failed: ${response.status}`,
      };
    }

    const result: TriggerBuildResponse = await response.json();

    log.info(
      `${stageLabel} triggered: ${result.run_id || 'no run ID'}`,
      'HarnessTrigger'
    );

    return result;
  } catch (error: any) {
    log.error(`Failed to trigger ${stageLabel}:`, error, 'HarnessTrigger');
    return {
      success: false,
      error: error?.message || 'Unknown error',
    };
  }
}

/**
 * Check status of a build (POC or Harness)
 */
export async function checkBuildStatus(
  itemId: string,
  stage: PipelineStage = 'poc'
): Promise<{
  status: string;
  progress: number;
  run_id?: string;
  stage?: string;
  error?: string;
} | null> {
  try {
    const response = await fetch(
      `${HARNESS_TRIGGER_URL}/status/${itemId}?stage=${stage}`,
      {
        headers: {
          'x-webhook-secret': HARNESS_TRIGGER_SECRET || '',
        },
      }
    );

    if (!response.ok) {
      return null;
    }

    return await response.json();
  } catch (error) {
    return null;
  }
}

/**
 * Get work type description for display
 */
export function getWorkTypeLabel(workType: WishlistWorkType): string {
  const labels: Record<WishlistWorkType, string> = {
    feature: '✨ New Feature',
    fix: '🐛 Bug Fix',
    amendment: '📝 Amendment',
    refactor: '🔧 Refactor',
  };
  return labels[workType] || workType;
}

/**
 * Get estimated complexity based on work type and stage
 */
export function getWorkTypeComplexity(
  workType: WishlistWorkType,
  stage: PipelineStage = 'harness'
): {
  minFeatures: number;
  maxFeatures: number;
  estimatedHours: string;
} {
  // POC is always quick validation
  if (stage === 'poc') {
    return { minFeatures: 5, maxFeatures: 20, estimatedHours: '1-5' };
  }

  // Full harness depends on work type
  const complexity: Record<
    WishlistWorkType,
    { minFeatures: number; maxFeatures: number; estimatedHours: string }
  > = {
    feature: { minFeatures: 50, maxFeatures: 100, estimatedHours: '8-24' },
    fix: { minFeatures: 5, maxFeatures: 15, estimatedHours: '1-4' },
    amendment: { minFeatures: 10, maxFeatures: 30, estimatedHours: '2-8' },
    refactor: { minFeatures: 20, maxFeatures: 40, estimatedHours: '4-12' },
  };
  return complexity[workType] || complexity.feature;
}

/**
 * Get pipeline stage info
 */
export function getPipelineStageInfo(stage: PipelineStage): {
  label: string;
  description: string;
  icon: string;
} {
  const stages: Record<PipelineStage, { label: string; description: string; icon: string }> = {
    poc: {
      label: 'POC Validation',
      description: 'Quick validation to ensure the approach works',
      icon: '🧪',
    },
    harness: {
      label: 'Full Harness Build',
      description: 'Production-ready implementation with 100% test coverage',
      icon: '🏗️',
    },
  };
  return stages[stage];
}

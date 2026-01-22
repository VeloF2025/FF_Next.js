/**
 * Harness Trigger Service
 *
 * Triggers the agent harness on VF Server to build features, fixes, amendments.
 */

import { log } from '@/lib/logger';
import type { WishlistWorkType } from '../types/wishlist';

interface TriggerBuildRequest {
  item_id: string;
  work_type: WishlistWorkType;
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
  harness_run_id?: string;
  message?: string;
  error?: string;
}

const HARNESS_TRIGGER_URL = process.env.HARNESS_TRIGGER_URL || 'http://100.96.203.105:8096';
const HARNESS_TRIGGER_SECRET = process.env.HARNESS_TRIGGER_SECRET;

/**
 * Trigger harness build for a wishlist item
 */
export async function triggerHarnessBuild(
  request: TriggerBuildRequest
): Promise<TriggerBuildResponse> {
  if (!HARNESS_TRIGGER_SECRET) {
    log.warn('HARNESS_TRIGGER_SECRET not configured', 'HarnessTrigger');
    return { success: false, error: 'Harness trigger not configured' };
  }

  try {
    log.info(
      `Triggering harness build for item ${request.item_id} (${request.work_type})`,
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
        `Harness trigger failed: ${response.status} - ${errorText}`,
        null,
        'HarnessTrigger'
      );
      return {
        success: false,
        error: `Harness trigger failed: ${response.status}`,
      };
    }

    const result: TriggerBuildResponse = await response.json();

    log.info(
      `Harness build triggered: ${result.harness_run_id || 'no run ID'}`,
      'HarnessTrigger'
    );

    return result;
  } catch (error: any) {
    log.error('Failed to trigger harness build:', error, 'HarnessTrigger');
    return {
      success: false,
      error: error?.message || 'Unknown error',
    };
  }
}

/**
 * Check status of a harness build
 */
export async function checkBuildStatus(itemId: string): Promise<{
  status: string;
  progress: number;
  error?: string;
} | null> {
  try {
    const response = await fetch(`${HARNESS_TRIGGER_URL}/status/${itemId}`, {
      headers: {
        'x-webhook-secret': HARNESS_TRIGGER_SECRET || '',
      },
    });

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
 * Get estimated complexity based on work type
 */
export function getWorkTypeComplexity(workType: WishlistWorkType): {
  minFeatures: number;
  maxFeatures: number;
  estimatedHours: string;
} {
  const complexity: Record<WishlistWorkType, { minFeatures: number; maxFeatures: number; estimatedHours: string }> = {
    feature: { minFeatures: 50, maxFeatures: 100, estimatedHours: '8-24' },
    fix: { minFeatures: 5, maxFeatures: 15, estimatedHours: '1-4' },
    amendment: { minFeatures: 10, maxFeatures: 30, estimatedHours: '2-8' },
    refactor: { minFeatures: 20, maxFeatures: 40, estimatedHours: '4-12' },
  };
  return complexity[workType] || complexity.feature;
}

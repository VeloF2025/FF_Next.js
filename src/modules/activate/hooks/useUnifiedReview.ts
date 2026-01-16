/**
 * useUnifiedReview Hook
 *
 * React hook for managing unified review data fetching and updates
 *
 * Features:
 * - Fetch review data from API
 * - Update manual QA steps
 * - Mark incorrect steps with comments
 * - Trigger AI evaluation
 * - Generate and send WhatsApp feedback
 * - Lock/unlock for concurrent editing
 * - Auto-refresh on updates
 */

import { useState, useEffect, useCallback } from 'react';
import type { UnifiedReview, UpdateUnifiedReviewPayload } from '../types/unified.types';
import { log } from '@/lib/logger';

export interface UseUnifiedReviewOptions {
  dropNumber: string;
  autoRefresh?: boolean;
  refreshInterval?: number; // milliseconds
}

export interface UseUnifiedReviewReturn {
  review: UnifiedReview | null;
  isLoading: boolean;
  error: Error | null;
  updateStep: (step: number, value: boolean) => Promise<void>;
  markIncorrect: (steps: number[], comments: Record<number, string>) => Promise<void>;
  triggerAiEvaluation: () => Promise<void>;
  generateFeedback: () => Promise<string>;
  sendFeedback: (message: string) => Promise<void>;
  lock: () => Promise<void>;
  unlock: () => Promise<void>;
  refresh: () => Promise<void>;
}

/**
 * Hook for managing unified review data
 */
export function useUnifiedReview({
  dropNumber,
  autoRefresh = false,
  refreshInterval = 30000, // 30 seconds default
}: UseUnifiedReviewOptions): UseUnifiedReviewReturn {
  const [review, setReview] = useState<UnifiedReview | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  /**
   * Fetch unified review from API
   */
  const fetchReview = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      const response = await fetch(`/api/activate/${dropNumber}`);

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `Failed to fetch review: ${response.status}`);
      }

      const data = await response.json();
      setReview(data.data);

      log.info(`Fetched unified review for ${dropNumber}`);
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error');
      setError(error);
      log.error(`Error fetching unified review for ${dropNumber}:`, error);
    } finally {
      setIsLoading(false);
    }
  }, [dropNumber]);

  /**
   * Update a single QA step
   */
  const updateStep = useCallback(
    async (step: number, value: boolean) => {
      if (!review) {
        throw new Error('Review not loaded');
      }

      try {
        const stepField = `step_${step.toString().padStart(2, '0')}_${getStepFieldSuffix(step)}`;
        const payload: UpdateUnifiedReviewPayload = {
          [stepField]: value,
        };

        const response = await fetch(`/api/activate/${dropNumber}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          throw new Error(`Failed to update step ${step}`);
        }

        const data = await response.json();
        setReview(data.data);

        log.info(`Updated step ${step} for ${dropNumber} to ${value}`);
      } catch (err) {
        const error = err instanceof Error ? err : new Error('Unknown error');
        log.error(`Error updating step ${step}:`, error);
        throw error;
      }
    },
    [dropNumber, review]
  );

  /**
   * Mark steps as incorrect with comments
   */
  const markIncorrect = useCallback(
    async (steps: number[], comments: Record<number, string>) => {
      if (!review) {
        throw new Error('Review not loaded');
      }

      try {
        const payload: UpdateUnifiedReviewPayload = {
          incorrect_steps: steps.map(String),
          incorrect_comments: comments,
        };

        const response = await fetch(`/api/activate/${dropNumber}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          throw new Error('Failed to mark incorrect steps');
        }

        const data = await response.json();
        setReview(data.data);

        log.info(`Marked steps ${steps.join(', ')} as incorrect for ${dropNumber}`);
      } catch (err) {
        const error = err instanceof Error ? err : new Error('Unknown error');
        log.error('Error marking incorrect steps:', error);
        throw error;
      }
    },
    [dropNumber, review]
  );

  /**
   * Trigger AI evaluation (Phase 4 endpoint - placeholder)
   */
  const triggerAiEvaluation = useCallback(async () => {
    if (!review) {
      throw new Error('Review not loaded');
    }

    try {
      log.info(`Triggering AI evaluation for ${dropNumber}`);

      const response = await fetch(`/api/activate/evaluate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dropNumber }),
      });

      if (!response.ok) {
        throw new Error('Failed to trigger AI evaluation');
      }

      // Refresh review to get AI results
      await fetchReview();

      log.info(`AI evaluation triggered for ${dropNumber}`);
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error');
      log.error('Error triggering AI evaluation:', error);
      throw error;
    }
  }, [dropNumber, review, fetchReview]);

  /**
   * Generate auto-feedback based on review results
   */
  const generateFeedback = useCallback((): string => {
    if (!review) {
      return 'Review not loaded';
    }

    const incorrectCount = review.incorrect_steps.length;
    const aiPassed = review.ai_overall_status === 'PASS';
    const aiScore = review.ai_average_score || 0;

    if (incorrectCount === 0 && aiPassed) {
      return `✅ All steps completed correctly!\n\nAI Evaluation: PASS (${aiScore.toFixed(1)}/10)\n\nGreat work! No issues found.`;
    }

    if (incorrectCount === 0 && !aiPassed) {
      return `⚠️ Manual review passed, but AI flagged some concerns.\n\nAI Evaluation: FAIL (${aiScore.toFixed(1)}/10)\n\nPlease review the AI feedback and address any issues.`;
    }

    if (incorrectCount > 0) {
      const incorrectSteps = review.incorrect_steps.map(step => {
        const stepNum = parseInt(step);
        const comment = review.incorrect_comments[step] || 'No comment';
        return `- Step ${stepNum}: ${comment}`;
      }).join('\n');

      return `❌ ${incorrectCount} step${incorrectCount > 1 ? 's' : ''} marked incorrect:\n\n${incorrectSteps}\n\nPlease address these issues and resubmit photos.`;
    }

    return 'Unable to generate feedback';
  }, [review]);

  /**
   * Send feedback to WhatsApp (Phase 4 endpoint - placeholder)
   */
  const sendFeedback = useCallback(
    async (message: string) => {
      if (!review) {
        throw new Error('Review not loaded');
      }

      try {
        log.info(`Sending feedback for ${dropNumber}`);

        const response = await fetch(`/api/activate/send-feedback`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dropNumber, message }),
        });

        if (!response.ok) {
          throw new Error('Failed to send feedback');
        }

        // Refresh review to update feedback_sent status
        await fetchReview();

        log.info(`Feedback sent for ${dropNumber}`);
      } catch (err) {
        const error = err instanceof Error ? err : new Error('Unknown error');
        log.error('Error sending feedback:', error);
        throw error;
      }
    },
    [dropNumber, review, fetchReview]
  );

  /**
   * Lock review for editing
   */
  const lock = useCallback(async () => {
    if (!review) {
      throw new Error('Review not loaded');
    }

    try {
      const payload: UpdateUnifiedReviewPayload = {
        // locked_by will be set server-side based on auth
      };

      const response = await fetch(`/api/activate/${dropNumber}/lock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error('Failed to lock review');
      }

      await fetchReview();

      log.info(`Locked review for ${dropNumber}`);
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error');
      log.error('Error locking review:', error);
      throw error;
    }
  }, [dropNumber, review, fetchReview]);

  /**
   * Unlock review
   */
  const unlock = useCallback(async () => {
    if (!review) {
      throw new Error('Review not loaded');
    }

    try {
      const response = await fetch(`/api/activate/${dropNumber}/unlock`, {
        method: 'POST',
      });

      if (!response.ok) {
        throw new Error('Failed to unlock review');
      }

      await fetchReview();

      log.info(`Unlocked review for ${dropNumber}`);
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error');
      log.error('Error unlocking review:', error);
      throw error;
    }
  }, [dropNumber, review, fetchReview]);

  /**
   * Refresh review data
   */
  const refresh = useCallback(() => {
    fetchReview();
  }, [fetchReview]);

  // Initial fetch on mount
  useEffect(() => {
    fetchReview();
  }, [fetchReview]);

  // Auto-refresh if enabled
  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      fetchReview();
    }, refreshInterval);

    return () => clearInterval(interval);
  }, [autoRefresh, refreshInterval, fetchReview]);

  return {
    review,
    isLoading,
    error,
    updateStep,
    markIncorrect,
    triggerAiEvaluation,
    generateFeedback,
    sendFeedback,
    lock,
    unlock,
    refresh,
  };
}

/**
 * Helper: Get step field suffix based on step number (10 steps)
 * Maps step numbers to their database column name suffixes
 *
 * NOTE: ONT Barcode and UPS Serial are NOT photo steps - they are scanned
 * barcodes stored directly in ont_serial_scanned and ups_serial_scanned fields.
 */
function getStepFieldSuffix(step: number): string {
  const suffixes: Record<number, string> = {
    1: 'house_photo',
    2: 'cable_from_pole',
    3: 'entry_outside',
    4: 'entry_inside',
    5: 'wall',
    6: 'ont_back',
    7: 'power_meter',
    8: 'final_installation',
    9: 'green_lights',
    10: 'signature',
  };

  return suffixes[step] || '';
}

/**
 * Foto Evaluation Hook
 * Custom hook for managing AI evaluation state
 */

import { useState, useCallback } from 'react';
import type { EvaluationResult } from '../types';
import * as api from '../services/fotoEvaluationService';

export interface UseFotoEvaluationReturn {
  /** Current evaluation result */
  evaluation: EvaluationResult | null;
  /** Whether an evaluation is in progress */
  isEvaluating: boolean;
  /** Error message if evaluation failed */
  error: string | null;
  /** Trigger AI evaluation for a DR */
  evaluate: (dr_number: string) => Promise<void>;
  /** Fetch existing evaluation */
  fetchEvaluation: (dr_number: string) => Promise<void>;
  /** Send WhatsApp feedback */
  sendFeedback: (dr_number: string, message?: string, project?: string) => Promise<void>;
  /** Whether feedback is being sent */
  isSendingFeedback: boolean;
  /** Feedback error message */
  feedbackError: string | null;
  /** Clear evaluation state */
  clear: () => void;
}

/**
 * Hook for managing DR photo evaluation
 * Handles evaluation state, loading states, and error handling
 */
export function useFotoEvaluation(): UseFotoEvaluationReturn {
  const [evaluation, setEvaluation] = useState<EvaluationResult | null>(null);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSendingFeedback, setIsSendingFeedback] = useState(false);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);

  /**
   * Trigger AI evaluation
   */
  const evaluate = useCallback(async (dr_number: string) => {
    setIsEvaluating(true);
    setError(null);

    try {
      const result = await api.evaluateDR(dr_number);
      setEvaluation(result);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to evaluate DR';
      setError(errorMessage);
      setEvaluation(null);
    } finally {
      setIsEvaluating(false);
    }
  }, []);

  /**
   * Fetch existing evaluation
   */
  const fetchEvaluation = useCallback(async (dr_number: string) => {
    setIsEvaluating(true);
    setError(null);

    try {
      const result = await api.getEvaluation(dr_number);
      setEvaluation(result);

      if (!result) {
        setError('No evaluation found for this DR');
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch evaluation';
      setError(errorMessage);
      setEvaluation(null);
    } finally {
      setIsEvaluating(false);
    }
  }, []);

  /**
   * Send WhatsApp feedback
   * @param dr_number - The DR number to send feedback for
   * @param message - Optional custom message (if not provided, uses evaluation from DB)
   * @param project - Optional project name for routing to correct WhatsApp group
   */
  const sendFeedback = useCallback(async (dr_number: string, message?: string, project?: string) => {
    setIsSendingFeedback(true);
    setFeedbackError(null);

    try {
      await api.sendFeedback(dr_number, message, project);

      // Update evaluation to mark feedback as sent (only if no custom message)
      if (!message && evaluation && evaluation.dr_number === dr_number) {
        setEvaluation({
          ...evaluation,
          feedback_sent: true,
          feedback_sent_at: new Date(),
        });
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to send feedback';
      setFeedbackError(errorMessage);
      throw err; // Re-throw so caller can handle
    } finally {
      setIsSendingFeedback(false);
    }
  }, [evaluation]);

  /**
   * Clear evaluation state
   */
  const clear = useCallback(() => {
    setEvaluation(null);
    setError(null);
    setFeedbackError(null);
  }, []);

  return {
    evaluation,
    isEvaluating,
    error,
    evaluate,
    fetchEvaluation,
    sendFeedback,
    isSendingFeedback,
    feedbackError,
    clear,
  };
}

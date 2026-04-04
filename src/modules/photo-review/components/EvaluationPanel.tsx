/**
 * Evaluation Panel Component
 * Shows AI evaluation results and allows human review/feedback
 * Similar to WA Monitor QA review cards
 */

'use client';

import { useState, useEffect } from 'react';
import { Send, Sparkles, CheckCircle, XCircle, AlertTriangle } from 'lucide-react';
import { notificationService } from '@/services/core/NotificationService';
import type { DropRecord, EvaluationResult } from '../types';
import { InlineSpinner } from '@/components/ui/LoadingSpinner';
import { log } from '@/lib/logger';

interface EvaluationPanelProps {
  drop: DropRecord;
  evaluation?: EvaluationResult | null;
  isEvaluating?: boolean;
  onEvaluate: (drNumber: string) => Promise<void>;
  onSendFeedback: (drNumber: string, message: string) => Promise<void>;
}

export function EvaluationPanel({ drop, evaluation = null, isEvaluating = false, onEvaluate, onSendFeedback }: EvaluationPanelProps) {
  const [feedbackMessage, setFeedbackMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Run AI evaluation
  const handleEvaluate = async () => {
    try {
      setError(null);
      await onEvaluate(drop.dr_number);
      // Evaluation will come through props after parent updates
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Evaluation failed';
      setError(errorMessage);
      log.error('Evaluation error', { error: err }, 'EvaluationPanel');
    }
  };

  // Auto-generate feedback message when evaluation changes
  useEffect(() => {
    if (evaluation) {
      generateFeedbackMessage(evaluation);
    }
  }, [evaluation]);

  // Generate feedback message from evaluation results (similar to WA Monitor format)
  const generateFeedbackMessage = (result: EvaluationResult) => {
    // Handle both old format (results.results) and new format (step_results)
    const stepResults = result.step_results || result.results?.results || [];
    const passed = stepResults.filter((r: any) => r.passed === true || r.status === 'PASS');
    const failed = stepResults.filter((r: any) => r.passed === false || r.status === 'FAIL');

    let message = `${drop.dr_number}\n`;

    // If all steps pass - simple approval message
    if (failed.length === 0) {
      message += `All items complete! ✅`;
    } else {
      // Focus on what needs correction (similar to WA Monitor)
      message += `NEEDS CORRECTION\n\n`;

      // Show failed items with issues
      message += `Incorrect items:\n`;
      failed.forEach((item: any) => {
        const stepName = item.step_label || item.step || `Step ${item.step_number}`;
        const issue = item.comment || item.issues || 'Failed quality check';
        // Format similar to WA Monitor: "• Step Name - Issue description"
        message += `• ${stepName} - ${issue}\n`;
      });

      // Optional: Add any missing steps if needed
      const missingSteps = stepResults.filter((r: any) =>
        r.score === 0 || r.comment?.toLowerCase().includes('missing') || r.comment?.toLowerCase().includes('not found')
      );

      if (missingSteps.length > 0 && missingSteps.length !== failed.length) {
        message += `\nMissing items:\n`;
        missingSteps.forEach((item: any) => {
          const stepName = item.step_label || item.step || `Step ${item.step_number}`;
          message += `• ${stepName}\n`;
        });
      }
    }

    setFeedbackMessage(message);
  };

  // Send feedback to WhatsApp
  const handleSendFeedback = async () => {
    if (!feedbackMessage.trim()) {
      return;
    }

    try {
      setSending(true);
      setError(null);
      await onSendFeedback(drop.dr_number, feedbackMessage);
      notificationService.success('Feedback sent successfully');
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to send feedback';
      setError(errorMessage);
      log.error('Send feedback error', { error: err }, 'EvaluationPanel');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow-md p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Sparkles className="w-6 h-6 text-purple-400" />
          <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">
            AI Evaluation & Feedback
          </h3>
        </div>

        <button
          onClick={handleEvaluate}
          disabled={isEvaluating}
          className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-[var(--ff-bg-tertiary)] text-white rounded-lg font-medium transition-colors"
        >
          {isEvaluating ? (
            <>
              <InlineSpinner size="sm" />
              Evaluating...
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4" />
              {evaluation ? 'Re-evaluate' : 'Run AI Evaluation'}
            </>
          )}
        </button>
      </div>

      {/* Error Message */}
      {error && (
        <div className="bg-red-500/20 border border-red-500/30 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-red-400">Error</p>
              <p className="text-sm text-red-300 mt-1">{error}</p>
            </div>
          </div>
        </div>
      )}

      {/* Evaluation Results */}
      {evaluation && (
        <div className="space-y-4">
          {/* Overall Status */}
          <div className="flex items-center justify-between p-4 rounded-lg bg-[var(--ff-bg-tertiary)]">
            <div className="flex items-center gap-3">
              {evaluation.overall_status === 'PASS' ? (
                <CheckCircle className="w-8 h-8 text-green-400" />
              ) : (
                <XCircle className="w-8 h-8 text-red-400" />
              )}
              <div>
                <p className="text-2xl font-bold text-[var(--ff-text-primary)]">
                  {evaluation.overall_score}%
                </p>
                <p className="text-sm text-[var(--ff-text-secondary)]">
                  {evaluation.passed_steps} of {evaluation.total_steps} steps passed
                </p>
              </div>
            </div>
            <div className={`px-4 py-2 rounded-full font-semibold text-sm ${
              evaluation.overall_status === 'PASS'
                ? 'bg-green-500/20 text-green-400'
                : 'bg-red-500/20 text-red-400'
            }`}>
              {evaluation.overall_status}
            </div>
          </div>

          {/* Step Results */}
          {evaluation.step_results && evaluation.step_results.length > 0 && (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              <p className="text-sm font-medium text-[var(--ff-text-secondary)] mb-2">
                Step-by-step Results:
              </p>
              {evaluation.step_results.map((step: any, index: number) => {
                const isPassed = step.passed === true || step.status === 'PASS';
                const stepName = step.step_label || step.step || `Step ${step.step_number}`;
                const comment = step.comment || step.issues || '';

                return (
                  <div
                    key={index}
                    className={`p-3 rounded-lg border ${
                      isPassed
                        ? 'border-green-500/30 bg-green-500/20'
                        : 'border-red-500/30 bg-red-500/20'
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      {isPassed ? (
                        <CheckCircle className="w-4 h-4 text-green-400 flex-shrink-0 mt-0.5" />
                      ) : (
                        <XCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-medium ${
                          isPassed
                            ? 'text-green-400'
                            : 'text-red-400'
                        }`}>
                          {stepName}
                        </p>
                        {comment && (
                          <p className="text-xs text-[var(--ff-text-tertiary)] mt-1">
                            {comment}
                          </p>
                        )}
                      </div>
                      <span className={`text-xs font-semibold ${
                        isPassed
                          ? 'text-green-400'
                          : 'text-red-400'
                      }`}>
                        {step.score ? `${Math.round(step.score * 10)}%` : ''}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Feedback Message Editor */}
      {evaluation && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-[var(--ff-text-secondary)]">
              WhatsApp Feedback Message
            </label>
            <button
              onClick={() => generateFeedbackMessage(evaluation)}
              className="text-xs text-purple-400 hover:underline"
            >
              Regenerate
            </button>
          </div>

          <textarea
            value={feedbackMessage}
            onChange={(e) => setFeedbackMessage(e.target.value)}
            rows={8}
            className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] focus:ring-2 focus:ring-purple-500 focus:border-transparent font-mono text-sm"
            placeholder="Edit feedback message before sending..."
          />

          <button
            onClick={handleSendFeedback}
            disabled={sending || !feedbackMessage.trim()}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-[var(--ff-bg-tertiary)] text-white rounded-lg font-medium transition-colors"
          >
            {sending ? (
              <>
                <InlineSpinner size="sm" />
                Sending...
              </>
            ) : (
              <>
                <Send className="w-4 h-4" />
                Send Feedback to WhatsApp
              </>
            )}
          </button>
        </div>
      )}

      {/* Instructions (shown when no evaluation yet) */}
      {!evaluation && !isEvaluating && (
        <div className="text-center py-8 text-[var(--ff-text-secondary)]">
          <Sparkles className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p className="text-sm">
            Click "Run AI Evaluation" to analyze this DR's photos
          </p>
          <p className="text-xs mt-1">
            AI will check all 12 installation steps and generate feedback
          </p>
        </div>
      )}
    </div>
  );
}

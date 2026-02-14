/**
 * AI Evaluation Card Component
 * Displays AI evaluation results summary
 * Shows overall status, score, and step counts
 *
 * Updated to use FibreFlow premium components (VelocityButton, GlassCard)
 */

'use client';

import { CheckCircle, XCircle, Sparkles, Download } from 'lucide-react';
import { GlassCard } from '@/components/ui/GlassCard';
import { VelocityButton } from '@/components/ui/VelocityButton';
import type { AIEvaluationCardProps } from '../types';
import { FeedbackButton } from './FeedbackButton';

export function AIEvaluationCard({ dr_number, evaluation, isEvaluating, onEvaluate, onSendFeedback, isSendingFeedback }: AIEvaluationCardProps) {
  const handleDownloadReport = () => {
    if (!dr_number) return;

    // Trigger download from API endpoint
    const downloadUrl = `/api/foto/download-report?dr_number=${encodeURIComponent(dr_number)}`;
    window.open(downloadUrl, '_blank');
  };

  const getStatusColor = (status: 'PASS' | 'FAIL') => {
    return status === 'PASS' ? 'text-green-400 bg-green-500/20' : 'text-red-400 bg-red-500/20';
  };

  const getScoreColor = (score: number) => {
    if (score >= 8) return 'text-green-400';
    if (score >= 6) return 'text-yellow-400';
    return 'text-red-400';
  };

  const getStatusIcon = (status: 'PASS' | 'FAIL') => {
    return status === 'PASS' ? (
      <CheckCircle className="w-8 h-8 text-green-400" />
    ) : (
      <XCircle className="w-8 h-8 text-red-400" />
    );
  };

  return (
    <GlassCard variant="strong" elevation={3} rounded="lg" padding="lg" className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 id="evaluation-heading" className="text-lg font-semibold text-white">AI Evaluation</h3>
        {evaluation && (
          <div role="img" aria-label={`Overall status: ${evaluation.overall_status}`}>
            {getStatusIcon(evaluation.overall_status)}
          </div>
        )}
      </div>

      {/* Evaluation Results */}
      {evaluation ? (
        <div className="space-y-4">
          {/* Overall Status */}
          <div className="flex items-center justify-between p-4 rounded-lg border-2 border-white/20 bg-card/5" role="region" aria-label="Evaluation summary">
            <div>
              <p className="text-sm text-[var(--ff-text-tertiary)]" id="status-label">Overall Status</p>
              <div className="flex items-center gap-2 mt-1">
                <span
                  className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold ${getStatusColor(
                    evaluation.overall_status
                  )}`}
                  role="status"
                  aria-labelledby="status-label"
                >
                  {evaluation.overall_status}
                </span>
              </div>
            </div>

            {/* Score */}
            <div className="text-right">
              <p className="text-sm text-[var(--ff-text-tertiary)]" id="score-label">Score</p>
              <p className={`text-3xl font-bold ${getScoreColor(evaluation.average_score)}`} aria-labelledby="score-label">
                {evaluation.average_score.toFixed(1)}/10
              </p>
            </div>
          </div>

          {/* Step Counts */}
          <div className="grid grid-cols-2 gap-4" role="region" aria-label="Step results">
            <div className="bg-card/5 rounded-lg p-4 border border-white/10">
              <p className="text-sm text-[var(--ff-text-tertiary)]" id="steps-passed-label">Steps Passed</p>
              <p className="text-2xl font-bold text-green-400" aria-labelledby="steps-passed-label">{evaluation.passed_steps}</p>
            </div>
            <div className="bg-card/5 rounded-lg p-4 border border-white/10">
              <p className="text-sm text-[var(--ff-text-tertiary)]" id="steps-failed-label">Steps Failed</p>
              <p className="text-2xl font-bold text-red-400" aria-labelledby="steps-failed-label">
                {evaluation.total_steps - evaluation.passed_steps}
              </p>
            </div>
          </div>

          {/* Progress Bar */}
          <div className="space-y-2" role="region" aria-label="Evaluation progress">
            <div className="flex justify-between text-sm text-[var(--ff-text-tertiary)]">
              <span id="progress-label">Progress</span>
              <span aria-labelledby="progress-label">
                {evaluation.passed_steps}/{evaluation.total_steps} steps
              </span>
            </div>
            <div
              className="w-full bg-card/10 rounded-full h-3 border border-white/20"
              role="progressbar"
              aria-valuenow={(evaluation.passed_steps / evaluation.total_steps) * 100}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`Evaluation progress: ${evaluation.passed_steps} of ${evaluation.total_steps} steps completed`}
            >
              <div
                className={`h-3 rounded-full transition-all ${
                  evaluation.overall_status === 'PASS' ? 'bg-green-500' : 'bg-red-500'
                }`}
                style={{ width: `${(evaluation.passed_steps / evaluation.total_steps) * 100}%` }}
              />
            </div>
          </div>

          {/* Action Buttons */}
          <div className="pt-4 border-t border-white/20 space-y-3">
            {/* Re-evaluate Button */}
            <VelocityButton
              onClick={onEvaluate}
              disabled={isEvaluating}
              variant="glass"
              size="lg"
              className="w-full"
              loading={isEvaluating}
            >
              <Sparkles className="w-4 h-4 mr-2" />
              {isEvaluating ? 'Re-evaluating...' : 'Re-evaluate'}
            </VelocityButton>

            {/* Feedback Button */}
            {dr_number && onSendFeedback && (
              <FeedbackButton
                dr_number={dr_number}
                evaluation={evaluation}
                onSendFeedback={onSendFeedback}
                isSending={isSendingFeedback}
              />
            )}

            {/* Download Report Button */}
            <VelocityButton
              onClick={handleDownloadReport}
              variant="glass"
              size="lg"
              className="w-full"
              aria-label="Download comprehensive markdown report"
            >
              <Download className="w-4 h-4 mr-2" />
              Download Report
            </VelocityButton>
          </div>
        </div>
      ) : (
        /* No Evaluation Yet */
        <div className="space-y-4">
          <div className="text-center py-8" role="status">
            <Sparkles className="w-12 h-12 text-blue-400 mx-auto mb-3" aria-hidden="true" />
            <p className="text-[var(--ff-text-primary)] mb-2">No evaluation yet</p>
            <p className="text-sm text-[var(--ff-text-tertiary)]">Run AI evaluation to see results</p>
          </div>

          <VelocityButton
            onClick={onEvaluate}
            disabled={isEvaluating}
            variant="glass-primary"
            size="lg"
            className="w-full"
            loading={isEvaluating}
            aria-label={isEvaluating ? 'Evaluating photos with AI' : 'Evaluate photos with AI'}
          >
            <Sparkles className="w-5 h-5 mr-2" aria-hidden="true" />
            {isEvaluating ? 'Evaluating...' : 'Evaluate with AI'}
          </VelocityButton>
        </div>
      )}
    </GlassCard>
  );
}

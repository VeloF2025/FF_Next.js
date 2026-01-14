/**
 * Evaluation Results Component
 * Displays detailed step-by-step evaluation breakdown
 * Shows individual scores and AI comments for each step
 */

'use client';

import { CheckCircle, XCircle, Download } from 'lucide-react';
import type { EvaluationResultsProps } from '../types';

export function EvaluationResults({ evaluation }: EvaluationResultsProps) {
  if (!evaluation) {
    return (
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow-md p-6">
        <p className="text-[var(--ff-text-secondary)] text-center">No evaluation results to display</p>
      </div>
    );
  }

  const handleDownloadReport = () => {
    // Trigger download from API endpoint
    const downloadUrl = `/api/foto/download-report?dr_number=${encodeURIComponent(evaluation.dr_number)}`;
    window.open(downloadUrl, '_blank');
  };

  const getScoreColor = (score: number) => {
    if (score >= 8) return 'text-green-400 bg-green-500/20';
    if (score >= 6) return 'text-yellow-400 bg-yellow-500/20';
    return 'text-red-400 bg-red-500/20';
  };

  const getScoreTextColor = (score: number) => {
    if (score >= 8) return 'text-green-400';
    if (score >= 6) return 'text-yellow-400';
    return 'text-red-400';
  };

  return (
    <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow-md">
      {/* Header */}
      <div className="p-6 border-b border-[var(--ff-border-light)]">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">Detailed Step Results</h3>
            <p className="text-sm text-[var(--ff-text-secondary)] mt-1">AI evaluation for each installation step</p>
          </div>
          <button
            onClick={handleDownloadReport}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors text-sm font-medium"
            aria-label="Download comprehensive markdown report"
          >
            <Download className="w-4 h-4" />
            Download Report
          </button>
        </div>
      </div>

      {/* Step Results */}
      <div className="divide-y divide-[var(--ff-border-light)]">
        {evaluation.step_results.map((step) => (
          <div key={step.step_number} className="p-6 hover:bg-[var(--ff-bg-hover)] transition-colors">
            {/* Step Header */}
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-3 flex-1">
                {/* Status Icon */}
                {step.passed ? (
                  <CheckCircle className="w-6 h-6 text-green-400 flex-shrink-0" />
                ) : (
                  <XCircle className="w-6 h-6 text-red-400 flex-shrink-0" />
                )}

                {/* Step Info */}
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-[var(--ff-text-tertiary)]">Step {step.step_number}</span>
                    <span className={`text-xs font-semibold ${step.passed ? 'text-green-400' : 'text-red-400'}`}>
                      {step.passed ? 'PASS' : 'FAIL'}
                    </span>
                  </div>
                  <h4 className="font-medium text-[var(--ff-text-primary)] mt-1">{step.step_label}</h4>
                </div>
              </div>

              {/* Score Badge */}
              <div className={`ml-4 flex-shrink-0 px-3 py-1 rounded-full ${getScoreColor(step.score)}`}>
                <span className={`text-sm font-bold ${getScoreTextColor(step.score)}`}>
                  {step.score.toFixed(1)}/10
                </span>
              </div>
            </div>

            {/* AI Comment */}
            <div className="ml-9 mt-2">
              <p className="text-sm text-[var(--ff-text-secondary)] leading-relaxed">{step.comment}</p>
            </div>

            {/* Score Bar */}
            <div className="ml-9 mt-3">
              <div className="w-full bg-[var(--ff-bg-tertiary)] rounded-full h-2">
                <div
                  className={`h-2 rounded-full transition-all ${
                    step.passed ? 'bg-green-500' : 'bg-red-500'
                  }`}
                  style={{ width: `${(step.score / 10) * 100}%` }}
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Markdown Report (if available) */}
      {evaluation.markdown_report && (
        <div className="p-6 border-t border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)]">
          <details className="cursor-pointer">
            <summary className="font-medium text-[var(--ff-text-primary)] hover:text-blue-400 transition-colors">
              View Full Markdown Report
            </summary>
            <div className="mt-4 bg-[var(--ff-bg-secondary)] rounded-lg p-4 border border-[var(--ff-border-light)]">
              <pre className="text-xs text-[var(--ff-text-secondary)] whitespace-pre-wrap font-mono">
                {evaluation.markdown_report}
              </pre>
            </div>
          </details>
        </div>
      )}
    </div>
  );
}

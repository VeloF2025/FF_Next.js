/**
 * Contractor Onboarding Progress Component
 * Displays overall onboarding progress with visual progress bar
 */

'use client';

import React from 'react';

export interface OnboardingProgress {
  totalStages: number;
  completedStages: number;
  inProgressStages: number;
  pendingStages: number;
  overallProgress: number;
  isComplete: boolean;
}

interface ContractorOnboardingProgressProps {
  progress: OnboardingProgress;
  showDetails?: boolean;
}

export function ContractorOnboardingProgress({
  progress,
  showDetails = true,
}: ContractorOnboardingProgressProps) {
  const getProgressColor = () => {
    if (progress.overallProgress === 100) return 'bg-green-500';
    if (progress.overallProgress >= 50) return 'bg-blue-500';
    return 'bg-amber-500';
  };

  const getStatusBadge = () => {
    if (progress.isComplete) {
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-500/20 text-green-400">
          Complete
        </span>
      );
    }
    if (progress.inProgressStages > 0) {
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-500/20 text-blue-400">
          In Progress
        </span>
      );
    }
    return (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-500/20 text-amber-400">
        Not Started
      </span>
    );
  };

  return (
    <div className="bg-[var(--ff-bg-card)] rounded-lg border border-[var(--ff-border-light)] p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">Onboarding Progress</h3>
        {getStatusBadge()}
      </div>

      {/* Progress Bar */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-1">
          <span className="text-sm font-medium text-[var(--ff-text-secondary)]">
            {progress.completedStages} of {progress.totalStages} stages completed
          </span>
          <span className="text-sm font-medium text-[var(--ff-text-primary)]">
            {progress.overallProgress}%
          </span>
        </div>
        <div className="w-full bg-[var(--ff-bg-tertiary)] rounded-full h-3">
          <div
            className={`h-3 rounded-full transition-all duration-300 ${getProgressColor()}`}
            style={{ width: `${progress.overallProgress}%` }}
          />
        </div>
      </div>

      {/* Stage Breakdown */}
      {showDetails && (
        <div className="grid grid-cols-3 gap-4 pt-3 border-t border-[var(--ff-border-light)]">
          <div className="text-center">
            <div className="text-2xl font-bold text-green-400">
              {progress.completedStages}
            </div>
            <div className="text-xs text-[var(--ff-text-tertiary)]">Completed</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-blue-400">
              {progress.inProgressStages}
            </div>
            <div className="text-xs text-[var(--ff-text-tertiary)]">In Progress</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-amber-400">
              {progress.pendingStages}
            </div>
            <div className="text-xs text-[var(--ff-text-tertiary)]">Pending</div>
          </div>
        </div>
      )}

      {/* Complete Badge */}
      {progress.isComplete && (
        <div className="mt-4 p-3 bg-green-500/10 border border-green-500/30 rounded-md">
          <p className="text-sm text-green-400 font-medium">
            ✓ All onboarding stages completed
          </p>
        </div>
      )}
    </div>
  );
}

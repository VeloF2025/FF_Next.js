/**
 * Contractor Onboarding Stages Component
 * Displays and manages all onboarding stages for a contractor
 */

'use client';

import { useState, useEffect } from 'react';
import { notificationService } from '@/services/core/NotificationService';
import { ContractorOnboardingProgress, OnboardingProgress } from './ContractorOnboardingProgress';
import { OnboardingStageCardEnhanced, OnboardingStage } from './OnboardingStageCardEnhanced';
import { log } from '@/lib/logger';

interface ContractorOnboardingStagesProps {
  contractorId: string;
}

export function ContractorOnboardingStages({ contractorId }: ContractorOnboardingStagesProps) {
  const [stages, setStages] = useState<OnboardingStage[]>([]);
  const [progress, setProgress] = useState<OnboardingProgress | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isCompleting, setIsCompleting] = useState(false);

  // Fetch onboarding stages
  useEffect(() => {
    fetchStages();
  }, [contractorId]);

  const fetchStages = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/contractors-onboarding-stages?contractorId=${contractorId}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch onboarding stages: ${response.status}`);
      }

      const data = await response.json();
      const stagesData = data.data || data;
      setStages(stagesData);
      calculateProgress(stagesData);
    } catch (err: any) {
      setError(err.message);
      log.error('Failed to fetch onboarding stages', { error: err, contractorId }, 'ContractorOnboardingStages');
    } finally {
      setIsLoading(false);
    }
  };

  const calculateProgress = (stagesData: OnboardingStage[]) => {
    const totalStages = stagesData.length;
    const completedStages = stagesData.filter(s => s.status === 'completed').length;
    const inProgressStages = stagesData.filter(s => s.status === 'in_progress').length;
    const pendingStages = stagesData.filter(s => s.status === 'pending').length;
    const overallProgress = totalStages > 0
      ? Math.round((completedStages / totalStages) * 100)
      : 0;

    setProgress({
      totalStages,
      completedStages,
      inProgressStages,
      pendingStages,
      overallProgress,
      isComplete: completedStages === totalStages && totalStages > 0,
    });
  };

  const handleUpdateStage = async (
    stageId: number,
    updates: {
      status?: 'pending' | 'in_progress' | 'completed' | 'skipped';
      completionPercentage?: number;
      notes?: string;
    }
  ) => {
    try {
      const response = await fetch(
        `/api/contractors-onboarding-stages-update?contractorId=${contractorId}&stageId=${stageId}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updates),
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to update stage: ${response.status}`);
      }

      // Refresh stages
      await fetchStages();
      notificationService.success('Stage updated');
    } catch (err: unknown) {
      log.error('Failed to update onboarding stage', { error: err, stageId, contractorId }, 'ContractorOnboardingStages');
      const message = err instanceof Error ? err.message : 'Unknown error';
      notificationService.error(`Failed to update stage: ${message}`);
    }
  };

  const handleCompleteOnboarding = async () => {
    if (!progress?.isComplete) {
      notificationService.warning('Cannot complete onboarding. Not all stages are completed.');
      return;
    }

    if (!confirm('Mark contractor onboarding as complete?')) {
      return;
    }

    setIsCompleting(true);

    try {
      const response = await fetch(
        `/api/contractors-onboarding-complete?contractorId=${contractorId}`,
        { method: 'POST' }
      );

      if (!response.ok) {
        throw new Error(`Failed to complete onboarding: ${response.status}`);
      }

      notificationService.success('Onboarding completed successfully');
      await fetchStages();
    } catch (err: unknown) {
      log.error('Failed to complete onboarding', { error: err, contractorId }, 'ContractorOnboardingStages');
      const message = err instanceof Error ? err.message : 'Unknown error';
      notificationService.error(`Failed to complete onboarding: ${message}`);
    } finally {
      setIsCompleting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="p-8 text-center">
        <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-400"></div>
        <p className="mt-2 text-[var(--ff-text-tertiary)]">Loading onboarding stages...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 bg-red-500/10 border border-red-500/30 rounded-lg">
        <p className="text-red-400 font-medium">Error loading onboarding stages</p>
        <p className="text-red-400/80 text-sm mt-1">{error}</p>
        <button
          onClick={fetchStages}
          className="mt-3 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Progress Summary */}
      {progress && <ContractorOnboardingProgress progress={progress} />}

      {/* Complete Onboarding Button */}
      {progress?.isComplete && (
        <div className="flex justify-end">
          <button
            onClick={handleCompleteOnboarding}
            disabled={isCompleting}
            className="px-6 py-2.5 bg-green-600 text-white font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isCompleting ? 'Completing...' : 'Complete Onboarding'}
          </button>
        </div>
      )}

      {/* Stages List */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">Onboarding Stages</h3>
        {stages.length === 0 ? (
          <p className="text-[var(--ff-text-tertiary)]">No onboarding stages found.</p>
        ) : (
          stages.map((stage) => (
            <OnboardingStageCardEnhanced
              key={stage.id}
              stage={stage}
              onUpdateStage={handleUpdateStage}
            />
          ))
        )}
      </div>
    </div>
  );
}

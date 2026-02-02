/**
 * Project Progress Card Component
 */

import { Loader2 } from 'lucide-react';
import { Project } from '@/types/project.types';
import { useProjectFinanceSummary } from '@/hooks/useProjectOverview';

interface ProjectProgressCardProps {
  project: Project;
}

export function ProjectProgressCard({ project }: ProjectProgressCardProps) {
  const { data: financeSummary, isLoading } = useProjectFinanceSummary(project.id);

  // Use activation progress from finance dashboard
  const progress = Math.round(financeSummary?.activationProgress || project.actualProgress || 0);
  const dropsActivated = financeSummary?.totalDropsActivated || 0;
  const dropsContracted = financeSummary?.totalDropsContracted || 0;
  const dropsRemaining = dropsContracted - dropsActivated;

  return (
    <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow-sm border border-[var(--ff-border-light)] p-6">
      <h2 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-4">Progress</h2>

      <div className="space-y-4">
        <div>
          <div className="flex items-center justify-between text-sm text-[var(--ff-text-secondary)] mb-2">
            <span>Overall Progress</span>
            {isLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <span>{progress}%</span>
            )}
          </div>
          <div className="w-full bg-[var(--ff-bg-tertiary)] rounded-full h-3">
            <div
              className="bg-blue-600 h-3 rounded-full transition-all duration-300"
              style={{ width: `${progress}%` }}
            ></div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 text-center">
          <div className="bg-[var(--ff-bg-tertiary)] rounded-lg p-3">
            <div className="text-2xl font-semibold text-green-500">
              {isLoading ? '-' : dropsActivated.toLocaleString()}
            </div>
            <div className="text-sm text-[var(--ff-text-secondary)]">Drops Activated</div>
          </div>
          <div className="bg-[var(--ff-bg-tertiary)] rounded-lg p-3">
            <div className="text-2xl font-semibold text-[var(--ff-text-primary)]">
              {isLoading ? '-' : dropsRemaining.toLocaleString()}
            </div>
            <div className="text-sm text-[var(--ff-text-secondary)]">Drops Remaining</div>
          </div>
        </div>
      </div>
    </div>
  );
}
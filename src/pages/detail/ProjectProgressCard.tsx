/**
 * Project Progress Card Component
 */

import { Project } from '@/types/project.types';

interface ProjectProgressCardProps {
  project: Project;
}

export function ProjectProgressCard({ project }: ProjectProgressCardProps) {
  return (
    <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow-sm border border-[var(--ff-border-light)] p-6">
      <h2 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-4">Progress</h2>

      <div className="space-y-4">
        <div>
          <div className="flex items-center justify-between text-sm text-[var(--ff-text-secondary)] mb-2">
            <span>Overall Progress</span>
            <span>{Math.round(project.actualProgress || 0)}%</span>
          </div>
          <div className="w-full bg-[var(--ff-bg-tertiary)] rounded-full h-3">
            <div
              className="bg-blue-600 h-3 rounded-full transition-all duration-300"
              style={{ width: `${project.actualProgress || 0}%` }}
            ></div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 text-center">
          <div className="bg-[var(--ff-bg-tertiary)] rounded-lg p-3">
            <div className="text-2xl font-semibold text-[var(--ff-text-primary)]">{0}</div>
            <div className="text-sm text-[var(--ff-text-secondary)]">Tasks Completed</div>
          </div>
          <div className="bg-[var(--ff-bg-tertiary)] rounded-lg p-3">
            <div className="text-2xl font-semibold text-[var(--ff-text-primary)]">{0}</div>
            <div className="text-sm text-[var(--ff-text-secondary)]">Tasks Remaining</div>
          </div>
        </div>
      </div>
    </div>
  );
}
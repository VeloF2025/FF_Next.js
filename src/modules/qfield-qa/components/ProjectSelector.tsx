/**
 * Project Selector Component
 * Dropdown to select QField project, shows photo counts per project
 */

'use client';

import { ChevronDown, FolderOpen } from 'lucide-react';
import type { QAProject } from '../types';

interface ProjectSelectorProps {
  projects: QAProject[];
  selectedProjectId: string | undefined;
  onSelect: (projectId: string) => void;
  loading?: boolean;
}

export function ProjectSelector({
  projects,
  selectedProjectId,
  onSelect,
  loading,
}: ProjectSelectorProps) {
  const selectedProject = projects.find(p => p.id === selectedProjectId);

  return (
    <div className="p-3 border-b border-[var(--ff-border-light)]">
      <label className="block text-xs font-medium text-[var(--ff-text-tertiary)] uppercase tracking-wider mb-2">
        Project
      </label>
      <div className="relative">
        <select
          value={selectedProjectId || ''}
          onChange={(e) => {
            if (e.target.value) onSelect(e.target.value);
          }}
          disabled={loading}
          className="w-full appearance-none pl-9 pr-8 py-2.5 text-sm font-medium bg-[var(--ff-bg-primary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 cursor-pointer disabled:opacity-50"
        >
          <option value="">Select a project...</option>
          {projects.map(p => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.validation_count})
            </option>
          ))}
        </select>
        <FolderOpen className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--ff-text-tertiary)] pointer-events-none" />
        <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--ff-text-tertiary)] pointer-events-none" />
      </div>
      {selectedProject && (
        <div className="flex gap-3 mt-2 text-xs text-[var(--ff-text-tertiary)]">
          <span>{selectedProject.validation_count} photos</span>
          {Number(selectedProject.pending_count) > 0 && (
            <span className="text-yellow-400">{selectedProject.pending_count} pending</span>
          )}
        </div>
      )}
    </div>
  );
}

export default ProjectSelector;

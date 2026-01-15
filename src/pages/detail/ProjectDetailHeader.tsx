/**
 * Project Detail Header Component
 * Header with navigation and action buttons
 */

import { ArrowLeft, Edit, Trash2 } from 'lucide-react';
import { Project } from '@/types/project.types';

interface ProjectDetailHeaderProps {
  project: Project;
  onNavigateBack: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

export function ProjectDetailHeader({
  project,
  onNavigateBack,
  onEdit,
  onDelete
}: ProjectDetailHeaderProps) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-4">
        <button
          onClick={onNavigateBack}
          className="p-2 text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-tertiary)] rounded-full transition-colors"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div>
          <h1 className="text-2xl font-semibold text-[var(--ff-text-primary)]">{project.name}</h1>
          <p className="text-[var(--ff-text-secondary)] mt-1">{project.code}</p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={onEdit}
          className="inline-flex items-center px-4 py-2 text-[var(--ff-text-secondary)] border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-tertiary)] hover:text-[var(--ff-text-primary)] transition-colors"
        >
          <Edit className="h-4 w-4 mr-2" />
          Edit
        </button>
        <button
          onClick={onDelete}
          className="inline-flex items-center px-4 py-2 text-red-500 border border-red-500/50 rounded-lg hover:bg-red-500/10 transition-colors"
        >
          <Trash2 className="h-4 w-4 mr-2" />
          Delete
        </button>
      </div>
    </div>
  );
}
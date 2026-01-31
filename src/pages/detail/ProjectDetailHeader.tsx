/**
 * Project Detail Header Component
 * Header with navigation and action buttons
 */

import { useState, useRef, useEffect } from 'react';
import { ArrowLeft, Edit, MoreVertical, Trash2 } from 'lucide-react';
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
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    if (menuOpen) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [menuOpen]);

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
          {project.code && (
            <p className="text-sm text-[var(--ff-text-secondary)] mt-0.5">{project.code}</p>
          )}
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

        {/* More menu with destructive actions */}
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="p-2 text-[var(--ff-text-secondary)] border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-tertiary)] hover:text-[var(--ff-text-primary)] transition-colors"
          >
            <MoreVertical className="h-4 w-4" />
          </button>

          {menuOpen && (
            <div className="absolute right-0 mt-1 w-48 rounded-lg border border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)] shadow-lg z-50">
              <button
                onClick={() => { setMenuOpen(false); onDelete(); }}
                className="flex items-center gap-2 w-full px-4 py-2.5 text-sm text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
              >
                <Trash2 className="h-4 w-4" />
                Delete Project
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
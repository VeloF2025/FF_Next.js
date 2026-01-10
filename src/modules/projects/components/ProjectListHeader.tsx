'use client';

import { Plus, Download, Upload } from 'lucide-react';
import { useRouter } from 'next/router';

interface ProjectListHeaderProps {
  onImport?: () => void;
  onExport?: () => void;
  projectCount?: number;
}

export function ProjectListHeader({ onImport, onExport, projectCount = 0 }: ProjectListHeaderProps) {
  const router = useRouter();

  return (
    <div className="bg-[var(--ff-bg-secondary)] p-6 rounded-lg border border-[var(--ff-border-light)]">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">Projects</h1>
          <p className="text-[var(--ff-text-secondary)] mt-1">
            Manage your fibre installation projects
          </p>
        </div>

        <div className="flex items-center gap-3">
          {onImport && (
            <button
              onClick={onImport}
              className="flex items-center gap-2 px-4 py-2 text-[var(--ff-text-primary)] bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-hover)] transition-colors"
            >
              <Upload className="h-4 w-4" />
              Import
            </button>
          )}

          {onExport && projectCount > 0 && (
            <button
              onClick={onExport}
              className="flex items-center gap-2 px-4 py-2 text-[var(--ff-text-primary)] bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-hover)] transition-colors"
            >
              <Download className="h-4 w-4" />
              Export
            </button>
          )}

          <button
            onClick={() => router.push('/projects/new')}
            className="flex items-center gap-2 px-4 py-2 text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus className="h-4 w-4" />
            Add Project
          </button>
        </div>
      </div>
    </div>
  );
}
'use client';

import { Upload, FileText } from 'lucide-react';
import { useRouter } from 'next/router';

export function SOWHeader() {
  const router = useRouter();
  const { projectId } = router.query;
  const projectIdStr = typeof projectId === 'string' ? projectId : '';

  const handleImportClick = () => {
    const importUrl = projectIdStr 
      ? `/sow/import?projectId=${projectIdStr}`
      : '/sow/import';
    router.push(importUrl);
  };

  return (
    <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow-sm border border-[var(--ff-border-light)] p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--ff-text-primary)]">SOW Management</h1>
          <p className="text-[var(--ff-text-secondary)] mt-1">Manage Statements of Work and project contracts</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={handleImportClick}
            className="px-4 py-2 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] text-[var(--ff-text-primary)] rounded-lg hover:bg-[var(--ff-bg-hover)] flex items-center gap-2"
          >
            <Upload className="h-4 w-4" />
            Import SOW
          </button>
          <button className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 flex items-center gap-2">
            <FileText className="h-4 w-4" />
            New SOW
          </button>
        </div>
      </div>
    </div>
  );
}
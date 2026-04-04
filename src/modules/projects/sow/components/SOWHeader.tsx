'use client';

import { Upload, FileText } from 'lucide-react';
import { useRouter } from 'next/router';
import { Button } from '@/components/ui/button';

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
          <Button
            variant="secondary"
            onClick={handleImportClick}
            className="flex items-center gap-2"
          >
            <Upload className="h-4 w-4" />
            Import SOW
          </Button>
          <Button variant="primary" className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            New SOW
          </Button>
        </div>
      </div>
    </div>
  );
}
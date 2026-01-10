/**
 * Import Actions Component for Staff Import
 */

import { Download, FileSpreadsheet } from 'lucide-react';
import { ImportActionsProps } from './StaffImportTypes';

export function ImportActions({ onDownloadTemplate, onExportAll }: ImportActionsProps) {
  return (
    <div className="flex gap-2">
      <button
        onClick={onDownloadTemplate}
        className="inline-flex items-center px-4 py-2 text-sm font-medium text-[var(--ff-text-secondary)] bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-hover)]"
      >
        <Download className="h-4 w-4 mr-2" />
        Download Template
      </button>
      <button
        onClick={onExportAll}
        className="inline-flex items-center px-4 py-2 text-sm font-medium text-[var(--ff-text-secondary)] bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-hover)]"
      >
        <FileSpreadsheet className="h-4 w-4 mr-2" />
        Export All Staff
      </button>
    </div>
  );
}
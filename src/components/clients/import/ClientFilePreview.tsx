/**
 * File Preview Component for Client Import
 */

import { FileSpreadsheet, Upload, X } from 'lucide-react';
import { ClientFilePreviewProps } from './ClientImportTypes';

export function ClientFilePreview({ file, isImporting, onImport, onCancel }: ClientFilePreviewProps) {
  return (
    <div className="border border-[var(--ff-border-light)] rounded-lg p-4 bg-[var(--ff-bg-secondary)]">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <FileSpreadsheet className="h-8 w-8 text-green-600" />
          <div>
            <p className="font-medium text-[var(--ff-text-primary)]">{file.name}</p>
            <p className="text-sm text-[var(--ff-text-tertiary)]">
              {(file.size / 1024).toFixed(2)} KB
            </p>
          </div>
        </div>
        <button
          onClick={onCancel}
          className="p-1 text-[var(--ff-text-tertiary)] hover:text-[var(--ff-text-secondary)]"
        >
          <X className="h-5 w-5" />
        </button>
      </div>
      
      <div className="flex gap-3">
        <button
          onClick={onImport}
          disabled={isImporting}
          className="flex-1 inline-flex items-center justify-center px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isImporting ? (
            <>
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
              Importing...
            </>
          ) : (
            <>
              <Upload className="h-4 w-4 mr-2" />
              Import Clients
            </>
          )}
        </button>
        <button
          onClick={onCancel}
          className="px-4 py-2 text-sm font-medium text-[var(--ff-text-secondary)] bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-hover)]"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
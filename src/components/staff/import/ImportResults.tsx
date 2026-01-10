/**
 * Import Results Component for Staff Import
 */

import { AlertCircle, CheckCircle } from 'lucide-react';
import { ImportResultsProps } from './StaffImportTypes';

export function ImportResults({ result, onReset }: ImportResultsProps) {
  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className={`p-4 rounded-lg ${
        result.success ? 'bg-green-500/20 border border-green-500/30' : 'bg-yellow-500/20 border border-yellow-500/30'
      }`}>
        <div className="flex items-start gap-3">
          {result.success ? (
            <CheckCircle className="h-5 w-5 text-green-400 mt-0.5" />
          ) : (
            <AlertCircle className="h-5 w-5 text-yellow-400 mt-0.5" />
          )}
          <div className="flex-1">
            <h3 className={`font-medium ${
              result.success ? 'text-green-400' : 'text-yellow-400'
            }`}>
              Import {result.success ? 'Successful' : 'Completed with Errors'}
            </h3>
            <div className="mt-2 text-sm text-[var(--ff-text-secondary)]">
              <p>✓ {result.imported} staff members imported successfully</p>
              {result.failed > 0 && (
                <p>✗ {result.failed} rows failed to import</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Errors */}
      {result.errors.length > 0 && (
        <div className="border border-red-500/30 rounded-lg p-4 bg-red-500/20">
          <h4 className="font-medium text-red-400 mb-3">Import Errors</h4>
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {result.errors.map((error, index) => (
              <div key={index} className="text-sm text-red-400 p-2 bg-[var(--ff-bg-secondary)] rounded border border-red-500/30">
                <span className="font-medium">Row {error.row}:</span> {error.message}
                {error.field && error.field !== 'general' && (
                  <span className="text-red-300"> (Field: {error.field})</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Imported Staff */}
      {result.staffMembers.length > 0 && (
        <div className="border border-[var(--ff-border-light)] rounded-lg p-4">
          <h4 className="font-medium text-[var(--ff-text-primary)] mb-3">Imported Staff Members</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-60 overflow-y-auto">
            {result.staffMembers.map((staff) => (
              <div key={staff.id} className="flex items-center gap-3 p-2 bg-[var(--ff-bg-tertiary)] rounded">
                <div className="h-8 w-8 bg-blue-500/20 rounded-full flex items-center justify-center">
                  <span className="text-sm font-medium text-blue-400">
                    {staff.name.charAt(0).toUpperCase()}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[var(--ff-text-primary)] truncate">{staff.name}</p>
                  <p className="text-xs text-[var(--ff-text-secondary)] truncate">{staff.email}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3">
        <button
          onClick={onReset}
          className="flex-1 inline-flex items-center justify-center px-4 py-2 text-sm font-medium text-[var(--ff-text-secondary)] bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-hover)]"
        >
          Import More Staff
        </button>
        {result.imported > 0 && (
          <button
            onClick={() => window.location.href = '/staff'}
            className="flex-1 inline-flex items-center justify-center px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
          >
            View Staff List
          </button>
        )}
      </div>
    </div>
  );
}
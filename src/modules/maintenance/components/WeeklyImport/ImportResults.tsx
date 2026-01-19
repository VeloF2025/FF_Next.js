/**
 * ImportResults Component - Display import completion statistics
 *
 * 🟢 WORKING: Production-ready import results component
 *
 * Features:
 * - Display success/failure indicator
 * - Show import statistics (imported, skipped, errors)
 * - List import errors if any
 * - Show import duration
 * - Success/failure visual states
 */

'use client';

import React from 'react';
import { CheckCircle2, XCircle, AlertTriangle, Clock, FileCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ImportProcessResult, ImportError } from '../../types/weeklyReport';

interface ImportResultsProps {
  /** Import process result */
  result: ImportProcessResult;
}

/**
 * 🟢 WORKING: Display import completion results
 */
export function ImportResults({ result }: ImportResultsProps) {
  const isSuccess = result.status === 'completed';
  const hasErrors = result.error_count > 0;

  return (
    <div className="space-y-6">
      {/* Success/Failure Header */}
      <div
        className={cn(
          'p-6 border rounded-lg',
          isSuccess
            ? 'bg-green-500/10 border-green-500/20'
            : 'bg-red-500/10 border-red-500/20'
        )}
      >
        <div className="flex items-start gap-4">
          {isSuccess ? (
            <div className="w-12 h-12 rounded-full bg-green-500/20 flex items-center justify-center flex-shrink-0">
              <CheckCircle2 className="w-6 h-6 text-green-400" />
            </div>
          ) : (
            <div className="w-12 h-12 rounded-full bg-red-500/20 flex items-center justify-center flex-shrink-0">
              <XCircle className="w-6 h-6 text-red-400" />
            </div>
          )}
          <div>
            <h3 className={cn('text-lg font-semibold', isSuccess ? 'text-green-200' : 'text-red-200')}>
              {isSuccess ? 'Import Complete!' : 'Import Failed'}
            </h3>
            <p className={cn('text-sm mt-1', isSuccess ? 'text-green-300/80' : 'text-red-300/80')}>
              {isSuccess
                ? `Successfully imported ${result.imported_count} of ${result.total_rows} tickets`
                : `Failed to import tickets. Please check the errors below.`}
            </p>
          </div>
        </div>
      </div>

      {/* Statistics Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          label="Total Rows"
          value={result.total_rows}
          icon={<FileCheck className="w-5 h-5" />}
          color="blue"
        />
        <StatCard
          label="Imported"
          value={result.imported_count}
          icon={<CheckCircle2 className="w-5 h-5" />}
          color="green"
        />
        <StatCard
          label="Skipped"
          value={result.skipped_count}
          icon={<AlertTriangle className="w-5 h-5" />}
          color="yellow"
        />
        <StatCard
          label="Errors"
          value={result.error_count}
          icon={<XCircle className="w-5 h-5" />}
          color="red"
        />
      </div>

      {/* Duration */}
      {result.duration_seconds > 0 && (
        <div className="flex items-center gap-2 text-sm text-[var(--ff-text-secondary)]">
          <Clock className="w-4 h-4" />
          <span>
            Completed in {formatDuration(result.duration_seconds)}
          </span>
        </div>
      )}

      {/* Import Errors */}
      {hasErrors && result.errors && result.errors.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-red-400" />
            <h3 className="text-base font-medium text-[var(--ff-text-primary)]">
              Import Errors ({result.errors.length})
            </h3>
          </div>

          <div className="space-y-2 max-h-96 overflow-y-auto">
            {result.errors.slice(0, 20).map((error, index) => (
              <ImportErrorItem key={index} error={error} />
            ))}
            {result.errors.length > 20 && (
              <div className="p-3 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-center">
                <p className="text-sm text-[var(--ff-text-secondary)]">
                  ... and {result.errors.length - 20} more errors
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Success Message for Perfect Import */}
      {isSuccess && !hasErrors && (
        <div className="p-4 bg-green-500/10 border border-green-500/20 rounded-lg">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="w-5 h-5 text-green-400" />
            <p className="text-sm text-green-200">
              All tickets were imported successfully without any errors!
            </p>
          </div>
        </div>
      )}

      {/* Partial Success Message */}
      {isSuccess && hasErrors && (
        <div className="p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-yellow-200">
                Partial Import Completed
              </p>
              <p className="text-xs text-yellow-300/80 mt-1">
                {result.imported_count} tickets imported successfully, but {result.error_count} rows had errors.
                Review the errors above to understand what went wrong.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * 🟢 WORKING: Statistic card component
 */
function StatCard({
  label,
  value,
  icon,
  color,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  color: 'blue' | 'green' | 'yellow' | 'red';
}) {
  const colorClasses = {
    blue: 'bg-blue-500/10 border-blue-500/20 text-blue-400',
    green: 'bg-green-500/10 border-green-500/20 text-green-400',
    yellow: 'bg-yellow-500/10 border-yellow-500/20 text-yellow-400',
    red: 'bg-red-500/10 border-red-500/20 text-red-400',
  };

  return (
    <div className={cn('p-4 border rounded-lg', colorClasses[color])}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-[var(--ff-text-secondary)]">{label}</p>
          <p className="text-2xl font-semibold mt-1">{value}</p>
        </div>
        <div className="opacity-50">{icon}</div>
      </div>
    </div>
  );
}

/**
 * 🟢 WORKING: Import error item component
 */
function ImportErrorItem({ error }: { error: ImportError }) {
  return (
    <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
      <div className="flex items-start gap-3">
        <XCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-medium text-red-300">
              Row {error.row_number}
            </span>
            <span className="text-xs px-2 py-0.5 bg-red-500/20 rounded text-red-300">
              {error.error_type}
            </span>
            {error.field_name && (
              <span className="text-xs text-[var(--ff-text-tertiary)]">
                • {error.field_name}
              </span>
            )}
          </div>
          <p className="text-sm text-red-200 mt-1">{error.error_message}</p>
        </div>
      </div>
    </div>
  );
}

/**
 * 🟢 WORKING: Format duration in seconds to human-readable string
 */
function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${seconds} seconds`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  if (remainingSeconds === 0) {
    return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
  }

  return `${minutes} minute${minutes !== 1 ? 's' : ''} ${remainingSeconds} second${remainingSeconds !== 1 ? 's' : ''}`;
}

/**
 * BOQ Upload Progress Component
 */

import { CheckCircle, AlertCircle, X, Loader2 } from 'lucide-react';
import { ImportJob } from '@/services/procurement/boqImportService';

interface BOQUploadProgressProps {
  job: ImportJob | null;
  progress: number;
  stage: string;
  message: string;
  onCancel?: () => void;
}

export function BOQUploadProgress({
  job,
  progress,
  stage,
  message,
  onCancel
}: BOQUploadProgressProps) {
  const getProgressColor = () => {
    if (job?.status === 'failed') return 'bg-red-500';
    if (job?.status === 'completed') return 'bg-green-500';
    return 'bg-blue-500';
  };

  const getStatusIcon = () => {
    if (!job) return <Loader2 className="h-5 w-5 text-blue-500 animate-spin" />;

    switch (job.status) {
      case 'completed':
        return <CheckCircle className="h-5 w-5 text-green-500" />;
      case 'failed':
        return <AlertCircle className="h-5 w-5 text-red-500" />;
      case 'cancelled':
        return <X className="h-5 w-5 text-[var(--ff-text-secondary)]" />;
      default:
        return <Loader2 className="h-5 w-5 text-blue-500 animate-spin" />;
    }
  };

  return (
    <div className="border border-[var(--ff-border-light)] rounded-lg p-4 bg-[var(--ff-bg-tertiary)]">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center space-x-2">
          {getStatusIcon()}
          <span className="font-medium text-[var(--ff-text-primary)]">Import Progress</span>
        </div>
        {(!job || job.status === 'parsing' || job.status === 'mapping' || job.status === 'validating' || job.status === 'processing') && onCancel && (
          <button
            onClick={onCancel}
            className="text-sm text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]"
          >
            Cancel
          </button>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-[var(--ff-text-secondary)]">{stage}</span>
          <span className="font-medium text-[var(--ff-text-primary)]">{Math.round(progress)}%</span>
        </div>
        <div className="w-full bg-[var(--ff-bg-secondary)] rounded-full h-2">
          <div
            className={`h-2 rounded-full transition-all duration-300 ${getProgressColor()}`}
            style={{ width: `${progress}%` }}
          ></div>
        </div>
        {message && (
          <p className="text-xs text-[var(--ff-text-secondary)]">{message}</p>
        )}
      </div>

      {job?.metadata && (
        <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
          <div>
            <span className="text-[var(--ff-text-secondary)]">Processed:</span>
            <span className="ml-1 font-medium text-[var(--ff-text-primary)]">{job.metadata.processedRows}</span>
          </div>
          <div>
            <span className="text-[var(--ff-text-secondary)]">Valid:</span>
            <span className="ml-1 font-medium text-green-500">{job.metadata.validRows}</span>
          </div>
          <div>
            <span className="text-[var(--ff-text-secondary)]">Errors:</span>
            <span className="ml-1 font-medium text-orange-500">{job.metadata.errorRows}</span>
          </div>
        </div>
      )}

      {job?.status === 'failed' && job.error && (
        <div className="mt-3 p-2 bg-red-500/10 rounded-md">
          <p className="text-sm text-red-400">{job.error}</p>
        </div>
      )}

      {job?.status === 'completed' && (
        <div className="mt-3 p-2 bg-green-500/10 rounded-md">
          <p className="text-sm text-green-400">
            Import completed successfully! {job.metadata?.processedRows || 0} items processed.
          </p>
        </div>
      )}
    </div>
  );
}

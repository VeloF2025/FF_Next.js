/**
 * Sync Job Card Component
 * Displays current sync job progress and status
 */

import React from 'react';
import { X, CheckCircle, AlertCircle } from 'lucide-react';
import { SyncJob } from '../types/qfield-sync.types';
import { InlineSpinner } from '@/components/ui/LoadingSpinner';

interface SyncJobCardProps {
  job: SyncJob;
  onCancel?: () => void;
}

export function SyncJobCard({ job, onCancel }: SyncJobCardProps) {
  const getStatusColor = () => {
    switch (job.status) {
      case 'syncing':
        return 'text-blue-400 bg-blue-500/20';
      case 'completed':
        return 'text-green-400 bg-green-500/20';
      case 'error':
        return 'text-red-400 bg-red-500/20';
      default:
        return 'text-[var(--ff-text-secondary)] bg-[var(--ff-bg-tertiary)]';
    }
  };

  const getStatusIcon = () => {
    switch (job.status) {
      case 'syncing':
        return <InlineSpinner size="sm" />;
      case 'completed':
        return <CheckCircle className="h-5 w-5" />;
      case 'error':
        return <AlertCircle className="h-5 w-5" />;
      default:
        return null;
    }
  };

  const totalRecords = job.recordsProcessed + job.recordsFailed;
  const progressPercentage = totalRecords > 0 ? (job.recordsProcessed / totalRecords) * 100 : 0;

  return (
    <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow p-6">
      <div className="flex justify-between items-start mb-4">
        <div>
          <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">Current Sync Job</h3>
          <p className="text-sm text-[var(--ff-text-secondary)] mt-1">
            Type: {job.type ? job.type.replace('_', ' ').toUpperCase() : 'Unknown'} | Direction: {job.direction || 'Unknown'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm font-medium ${getStatusColor()}`}>
            {getStatusIcon()}
            {job.status === 'syncing' ? 'Syncing' : job.status === 'completed' ? 'Completed' : 'Failed'}
          </span>
          {job.status === 'syncing' && onCancel && (
            <button
              onClick={onCancel}
              className="p-1 text-[var(--ff-text-tertiary)] hover:text-red-600 transition-colors"
              title="Cancel sync"
            >
              <X className="h-5 w-5" />
            </button>
          )}
        </div>
      </div>

      {/* Progress Bar */}
      {job.status === 'syncing' && (
        <div className="mb-4">
          <div className="flex justify-between text-sm text-[var(--ff-text-secondary)] mb-1">
            <span>Progress</span>
            <span>{Math.round(progressPercentage)}%</span>
          </div>
          <div className="w-full bg-[var(--ff-border-light)] rounded-full h-2">
            <div
              className="bg-blue-600 h-2 rounded-full transition-all duration-300"
              style={{ width: `${progressPercentage}%` }}
            />
          </div>
        </div>
      )}

      {/* Statistics */}
      <div className="grid grid-cols-4 gap-4 mb-4">
        <div>
          <p className="text-sm text-[var(--ff-text-secondary)]">Processed</p>
          <p className="text-xl font-semibold text-[var(--ff-text-primary)]">{job.recordsProcessed}</p>
        </div>
        <div>
          <p className="text-sm text-[var(--ff-text-secondary)]">Created</p>
          <p className="text-xl font-semibold text-green-600">{job.recordsCreated}</p>
        </div>
        <div>
          <p className="text-sm text-[var(--ff-text-secondary)]">Updated</p>
          <p className="text-xl font-semibold text-blue-600">{job.recordsUpdated}</p>
        </div>
        <div>
          <p className="text-sm text-[var(--ff-text-secondary)]">Failed</p>
          <p className="text-xl font-semibold text-red-600">{job.recordsFailed}</p>
        </div>
      </div>

      {/* Timing */}
      <div className="flex justify-between text-sm text-[var(--ff-text-tertiary)]">
        <span>Started: {new Date(job.startedAt).toLocaleTimeString()}</span>
        {job.completedAt && (
          <span>Duration: {Math.round((job.duration || 0) / 1000)}s</span>
        )}
      </div>

      {/* Errors */}
      {job.errors && job.errors.length > 0 && (
        <div className="mt-4 p-3 bg-red-500/20 rounded-md">
          <p className="text-sm font-medium text-red-400 mb-2">Errors ({job.errors.length})</p>
          <div className="space-y-1 max-h-32 overflow-y-auto">
            {job.errors.slice(0, 5).map((error, index) => (
              <p key={index} className="text-xs text-red-400">
                {error.recordId}: {error.message}
              </p>
            ))}
            {job.errors.length > 5 && (
              <p className="text-xs text-red-400 italic">
                ...and {job.errors.length - 5} more errors
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
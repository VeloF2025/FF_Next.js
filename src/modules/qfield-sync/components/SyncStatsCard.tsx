/**
 * Sync Stats Card Component
 * Displays synchronization statistics
 */

import { Activity, Clock, CheckCircle, AlertCircle } from 'lucide-react';
import { SyncStats } from '../types/qfield-sync.types';

interface SyncStatsCardProps {
  stats: SyncStats;
}

export function SyncStatsCard({ stats }: SyncStatsCardProps) {
  const successRate = stats.totalSyncs > 0
    ? Math.round((stats.successfulSyncs / stats.totalSyncs) * 100)
    : 0;

  return (
    <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow p-6">
      <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-4">Sync Statistics</h3>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="text-center">
          <div className="flex justify-center mb-2">
            <div className="p-3 bg-blue-500/20 rounded-full">
              <Activity className="h-6 w-6 text-blue-600" />
            </div>
          </div>
          <p className="text-2xl font-semibold text-[var(--ff-text-primary)]">{stats.totalSyncs}</p>
          <p className="text-sm text-[var(--ff-text-secondary)]">Total Syncs</p>
        </div>

        <div className="text-center">
          <div className="flex justify-center mb-2">
            <div className="p-3 bg-green-500/20 rounded-full">
              <CheckCircle className="h-6 w-6 text-green-600" />
            </div>
          </div>
          <p className="text-2xl font-semibold text-[var(--ff-text-primary)]">{successRate}%</p>
          <p className="text-sm text-[var(--ff-text-secondary)]">Success Rate</p>
        </div>

        <div className="text-center">
          <div className="flex justify-center mb-2">
            <div className="p-3 bg-purple-500/20 rounded-full">
              <Clock className="h-6 w-6 text-purple-600" />
            </div>
          </div>
          <p className="text-2xl font-semibold text-[var(--ff-text-primary)]">
            {stats.averageSyncDuration > 0 ? `${Math.round(stats.averageSyncDuration / 1000)}s` : '-'}
          </p>
          <p className="text-sm text-[var(--ff-text-secondary)]">Avg Duration</p>
        </div>

        <div className="text-center">
          <div className="flex justify-center mb-2">
            <div className="p-3 bg-indigo-500/20 rounded-full">
              <Activity className="h-6 w-6 text-indigo-600" />
            </div>
          </div>
          <p className="text-2xl font-semibold text-[var(--ff-text-primary)]">
            {stats.totalRecordsSynced.toLocaleString()}
          </p>
          <p className="text-sm text-[var(--ff-text-secondary)]">Records Synced</p>
        </div>
      </div>

      {stats.lastSync && (
        <div className="mt-4 pt-4 border-t border-[var(--ff-border-light)]">
          <div className="flex justify-between items-center">
            <p className="text-sm text-[var(--ff-text-secondary)]">Last Sync:</p>
            <p className="text-sm font-medium text-[var(--ff-text-primary)]">
              {new Date(stats.lastSync).toLocaleString()}
            </p>
          </div>
          {stats.nextScheduledSync && (
            <div className="flex justify-between items-center mt-2">
              <p className="text-sm text-[var(--ff-text-secondary)]">Next Scheduled:</p>
              <p className="text-sm font-medium text-[var(--ff-text-primary)]">
                {new Date(stats.nextScheduledSync).toLocaleString()}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
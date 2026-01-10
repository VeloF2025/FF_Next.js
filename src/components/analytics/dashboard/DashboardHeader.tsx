/**
 * Analytics Dashboard Header Component
 */

import { Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/src/shared/components/ui/Button';
import { DashboardHeaderProps } from './AnalyticsDashboardTypes';

export function DashboardHeader({ lastSyncTime, onSync, syncing }: DashboardHeaderProps) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <h1 className="text-3xl font-bold">Analytics Dashboard</h1>
        <p className="text-[var(--ff-text-secondary)]">Insights from Neon analytical database</p>
      </div>
      <div className="flex items-center space-x-4">
        {lastSyncTime && (
          <span className="text-sm text-[var(--ff-text-tertiary)]">
            Last sync: {lastSyncTime.toLocaleTimeString()}
          </span>
        )}
        <Button onClick={onSync} disabled={syncing}>
          {syncing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
          Sync Data
        </Button>
      </div>
    </div>
  );
}
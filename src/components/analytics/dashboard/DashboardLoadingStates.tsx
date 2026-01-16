/**
 * Analytics Dashboard Loading and Empty States
 */

import { Loader2, Database, RefreshCw } from 'lucide-react';
import { Button } from '@/shared/components/ui/Button';

interface DashboardLoadingStateProps {
  loading: boolean;
}

interface DashboardEmptyStateProps {
  onSync: () => void;
  syncing: boolean;
}

export function DashboardLoadingState({ loading }: DashboardLoadingStateProps) {
  if (!loading) return null;
  
  return (
    <div className="flex items-center justify-center min-h-96">
      <Loader2 className="h-8 w-8 animate-spin" />
      <span className="ml-2">Loading analytics...</span>
    </div>
  );
}

export function DashboardEmptyState({ onSync, syncing }: DashboardEmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center min-h-96">
      <Database className="h-16 w-16 text-[var(--ff-text-tertiary)] mb-4" />
      <p className="text-[var(--ff-text-secondary)] mb-4">No analytics data available</p>
      <Button onClick={onSync} disabled={syncing}>
        {syncing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
        Sync from Firebase
      </Button>
    </div>
  );
}
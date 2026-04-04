/**
 * OverrideHistoryPanel — Lists all movement reversals/overrides with filters
 */

import { useState, useCallback, useEffect } from 'react';
import { RotateCcw, Filter } from 'lucide-react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { log } from '@/lib/logger';
import type { AuditLogListItem } from '@/types/procurement/audit.types';

function formatDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleString('en-ZA', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export function OverrideHistoryPanel() {
  const [overrides, setOverrides] = useState<AuditLogListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchOverrides = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        entity_type: 'stock_movement',
        action: 'reverse',
        limit: '100',
      });

      const response = await fetch(`/api/procurement/audit-logs/?${params.toString()}`);
      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error?.message || 'Failed to fetch overrides');
      }

      setOverrides(result.data?.items ?? result.data ?? []);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch overrides';
      setError(message);
      log.error('Failed to fetch override history', { data: err }, 'OverrideHistoryPanel');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchOverrides();
  }, [fetchOverrides]);

  if (loading) {
    return <LoadingSpinner className="h-32" size="sm" label="" />;
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200">
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
          Movement Reversals
        </h3>
        <span className="text-xs text-gray-400">{overrides.length} total</span>
      </div>

      {overrides.length === 0 ? (
        <p className="py-4 text-center text-sm text-gray-400 dark:text-gray-500">
          No reversals recorded yet
        </p>
      ) : (
        <div className="divide-y divide-gray-200 rounded-lg border border-gray-200 dark:divide-gray-700 dark:border-gray-700">
          {overrides.map((entry) => (
            <div key={entry.id} className="flex items-start gap-3 p-3">
              <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30">
                <RotateCcw className="h-4 w-4 text-red-600 dark:text-red-400" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-gray-800 dark:text-gray-200">
                  Movement Reversed
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  by {entry.performedByName ?? 'System'} &middot; {formatDate(entry.performedAt)}
                </p>
                <code className="mt-1 block truncate text-xs text-gray-400 dark:text-gray-500">
                  {entry.entityId}
                </code>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

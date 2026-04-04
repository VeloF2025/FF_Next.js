/**
 * AuditActivitySummary — Dashboard widget showing recent audit activity stats
 */

import { useState, useEffect, useCallback } from 'react';
import { Activity, Clock, Users } from 'lucide-react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { log } from '@/lib/logger';
import type { AuditLogListItem } from '@/types/procurement/audit.types';

interface ActivityStats {
  last24h: number;
  byAction: Record<string, number>;
  topUsers: Array<{ name: string; count: number }>;
}

export function AuditActivitySummary() {
  const [stats, setStats] = useState<ActivityStats | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchStats = useCallback(async () => {
    try {
      // Fetch last 200 entries and compute stats client-side
      const response = await fetch('/api/procurement/audit-logs/?limit=200');
      const result = await response.json();

      if (!result.success) return;

      const items: AuditLogListItem[] = result.data?.items ?? result.data ?? [];
      const now = new Date();
      const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      const last24h = items.filter(
        (i) => new Date(i.performedAt) >= oneDayAgo,
      ).length;

      const byAction: Record<string, number> = {};
      const userCounts: Record<string, number> = {};

      for (const item of items) {
        byAction[item.action] = (byAction[item.action] || 0) + 1;
        const name = item.performedByName ?? 'System';
        userCounts[name] = (userCounts[name] || 0) + 1;
      }

      const topUsers = Object.entries(userCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([name, count]) => ({ name, count }));

      setStats({ last24h, byAction, topUsers });
    } catch (err) {
      log.error('Failed to fetch audit activity', { data: err }, 'AuditActivitySummary');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  if (loading) {
    return <LoadingSpinner className="h-32" size="sm" label="" />;
  }

  if (!stats) return null;

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {/* Last 24h */}
      <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
        <div className="flex items-center gap-2 text-sm font-medium text-gray-500 dark:text-gray-400">
          <Clock className="h-4 w-4" />
          Last 24 Hours
        </div>
        <p className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">
          {stats.last24h}
        </p>
        <p className="text-xs text-gray-400">audit actions</p>
      </div>

      {/* By Action */}
      <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
        <div className="flex items-center gap-2 text-sm font-medium text-gray-500 dark:text-gray-400">
          <Activity className="h-4 w-4" />
          By Action
        </div>
        <div className="mt-2 space-y-1">
          {Object.entries(stats.byAction).slice(0, 4).map(([action, count]) => (
            <div key={action} className="flex justify-between text-sm">
              <span className="capitalize text-gray-600 dark:text-gray-300">{action}</span>
              <span className="font-medium text-gray-800 dark:text-gray-200">{count}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Top Users */}
      <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
        <div className="flex items-center gap-2 text-sm font-medium text-gray-500 dark:text-gray-400">
          <Users className="h-4 w-4" />
          Most Active
        </div>
        <div className="mt-2 space-y-1">
          {stats.topUsers.map((user) => (
            <div key={user.name} className="flex justify-between text-sm">
              <span className="truncate text-gray-600 dark:text-gray-300">{user.name}</span>
              <span className="font-medium text-gray-800 dark:text-gray-200">{user.count}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

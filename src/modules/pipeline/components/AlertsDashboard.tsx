/**
 * Pipeline Alerts Dashboard
 * Shows expiring approvals and due follow-ups
 */

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  Clock,
  Calendar,
  RefreshCw,
  ChevronRight,
  XCircle,
  Bell,
  CheckCircle,
} from 'lucide-react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import type { ExpiringApproval, DueFollowup, ExpiryUrgency, FollowupStatus } from '../types';

interface AlertsDashboardProps {
  className?: string;
  compact?: boolean;
}

const URGENCY_CONFIG: Record<
  ExpiryUrgency,
  { label: string; color: string; bgColor: string; icon: React.ReactNode }
> = {
  expired: {
    label: 'Expired',
    color: 'text-red-600',
    bgColor: 'bg-red-100 dark:bg-red-900/30',
    icon: <XCircle className="w-4 h-4" />,
  },
  critical: {
    label: 'Critical (< 7 days)',
    color: 'text-orange-600',
    bgColor: 'bg-orange-100 dark:bg-orange-900/30',
    icon: <AlertTriangle className="w-4 h-4" />,
  },
  warning: {
    label: 'Warning (< 30 days)',
    color: 'text-amber-600',
    bgColor: 'bg-amber-100 dark:bg-amber-900/30',
    icon: <Clock className="w-4 h-4" />,
  },
  upcoming: {
    label: 'Upcoming (< 90 days)',
    color: 'text-blue-600',
    bgColor: 'bg-blue-100 dark:bg-blue-900/30',
    icon: <Calendar className="w-4 h-4" />,
  },
  ok: {
    label: 'OK',
    color: 'text-green-600',
    bgColor: 'bg-green-100 dark:bg-green-900/30',
    icon: <CheckCircle className="w-4 h-4" />,
  },
};

const FOLLOWUP_CONFIG: Record<
  FollowupStatus,
  { label: string; color: string; bgColor: string }
> = {
  overdue: {
    label: 'Overdue',
    color: 'text-red-600',
    bgColor: 'bg-red-100 dark:bg-red-900/30',
  },
  today: {
    label: 'Today',
    color: 'text-orange-600',
    bgColor: 'bg-orange-100 dark:bg-orange-900/30',
  },
  upcoming: {
    label: 'This Week',
    color: 'text-amber-600',
    bgColor: 'bg-amber-100 dark:bg-amber-900/30',
  },
  scheduled: {
    label: 'Scheduled',
    color: 'text-blue-600',
    bgColor: 'bg-blue-100 dark:bg-blue-900/30',
  },
};

function formatDate(date: string | null | undefined): string {
  if (!date) return '-';
  // Standard YYYY-MM-DD format
  return new Date(date).toISOString().split('T')[0];
}

export function AlertsDashboard({ className = '', compact = false }: AlertsDashboardProps) {
  const [expiring, setExpiring] = useState<{
    total: number;
    by_urgency: {
      expired: ExpiringApproval[];
      critical: ExpiringApproval[];
      warning: ExpiringApproval[];
      upcoming: ExpiringApproval[];
    };
  } | null>(null);
  const [followups, setFollowups] = useState<{
    total: number;
    by_status: {
      overdue: DueFollowup[];
      today: DueFollowup[];
      upcoming: DueFollowup[];
      scheduled: DueFollowup[];
    };
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [expiringRes, followupsRes] = await Promise.all([
        fetch('/api/pipeline/expiring?days=90'),
        fetch('/api/pipeline/followups'),
      ]);

      if (!expiringRes.ok || !followupsRes.ok) {
        throw new Error('Failed to fetch alerts');
      }

      const expiringData = await expiringRes.json();
      const followupsData = await followupsRes.json();

      setExpiring(expiringData.data);
      setFollowups(followupsData.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load alerts');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const criticalCount =
    (expiring?.by_urgency.expired.length || 0) +
    (expiring?.by_urgency.critical.length || 0) +
    (followups?.by_status.overdue.length || 0) +
    (followups?.by_status.today.length || 0);

  if (loading) {
    return (
      <div className={`flex items-center justify-center py-12 ${className}`}>
        <LoadingSpinner size="md" label="" />
      </div>
    );
  }

  if (error) {
    return (
      <div className={`bg-red-50 border border-red-200 rounded-lg p-4 ${className}`}>
        <p className="text-sm text-red-600">{error}</p>
        <button
          onClick={fetchData}
          className="mt-2 text-sm text-red-600 hover:text-red-800 flex items-center gap-1"
        >
          <RefreshCw className="w-4 h-4" /> Retry
        </button>
      </div>
    );
  }

  if (compact) {
    return (
      <div className={`space-y-4 ${className}`}>
        {/* Summary Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="bg-red-50 dark:bg-red-900/30 rounded-lg p-4">
            <p className="text-2xl font-bold text-red-600">
              {(expiring?.by_urgency.expired.length || 0) +
                (followups?.by_status.overdue.length || 0)}
            </p>
            <p className="text-xs text-red-600">Critical/Overdue</p>
          </div>
          <div className="bg-orange-50 dark:bg-orange-900/30 rounded-lg p-4">
            <p className="text-2xl font-bold text-orange-600">
              {(expiring?.by_urgency.critical.length || 0) +
                (followups?.by_status.today.length || 0)}
            </p>
            <p className="text-xs text-orange-600">Urgent Today</p>
          </div>
          <div className="bg-amber-50 dark:bg-amber-900/30 rounded-lg p-4">
            <p className="text-2xl font-bold text-amber-600">
              {expiring?.by_urgency.warning.length || 0}
            </p>
            <p className="text-xs text-amber-600">Expiring Soon</p>
          </div>
          <div className="bg-blue-50 dark:bg-blue-900/30 rounded-lg p-4">
            <p className="text-2xl font-bold text-blue-600">
              {followups?.by_status.upcoming.length || 0}
            </p>
            <p className="text-xs text-blue-600">Follow-ups Due</p>
          </div>
        </div>

        {/* Critical Items Preview */}
        {criticalCount > 0 && (
          <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-4 border border-[var(--ff-border-light)]">
            <h4 className="text-sm font-medium text-[var(--ff-text-primary)] mb-3 flex items-center gap-2">
              <Bell className="w-4 h-4 text-red-500" />
              Requires Immediate Attention
            </h4>
            <div className="space-y-2">
              {[
                ...(expiring?.by_urgency.expired || []).slice(0, 2),
                ...(expiring?.by_urgency.critical || []).slice(0, 2),
              ].map((item) => (
                <Link
                  key={item.id}
                  href={`/pipeline/${item.pipeline_project_id}`}
                  className="flex items-center justify-between p-2 bg-[var(--ff-bg-primary)] rounded hover:bg-[var(--ff-bg-tertiary)] transition-colors"
                >
                  <div>
                    <p className="text-sm font-medium text-[var(--ff-text-primary)]">
                      {item.approval_type_name}
                    </p>
                    <p className="text-xs text-[var(--ff-text-secondary)]">
                      {item.project_name}
                    </p>
                  </div>
                  <span
                    className={`text-xs px-2 py-1 rounded ${URGENCY_CONFIG[item.urgency].bgColor} ${URGENCY_CONFIG[item.urgency].color}`}
                  >
                    {item.days_until_expiry < 0
                      ? `${Math.abs(item.days_until_expiry)}d overdue`
                      : `${item.days_until_expiry}d left`}
                  </span>
                </Link>
              ))}
              {criticalCount > 4 && (
                <Link
                  href="/pipeline/alerts"
                  className="block text-center text-sm text-[var(--ff-accent)] hover:underline py-2"
                >
                  View all {criticalCount} critical items →
                </Link>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  // Full Dashboard View
  return (
    <div className={`space-y-6 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-[var(--ff-text-primary)]">
            Pipeline Alerts
          </h2>
          <p className="text-sm text-[var(--ff-text-secondary)]">
            Expiring approvals and due follow-ups
          </p>
        </div>
        <button
          onClick={fetchData}
          className="p-2 hover:bg-[var(--ff-bg-secondary)] rounded-lg transition-colors"
          title="Refresh"
        >
          <RefreshCw className="w-5 h-5 text-[var(--ff-text-secondary)]" />
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <XCircle className="w-5 h-5 text-red-500" />
            <span className="text-sm font-medium text-red-600">Expired</span>
          </div>
          <p className="text-3xl font-bold text-red-600">
            {expiring?.by_urgency.expired.length || 0}
          </p>
        </div>
        <div className="bg-orange-50 dark:bg-orange-900/30 border border-orange-200 dark:border-orange-800 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-5 h-5 text-orange-500" />
            <span className="text-sm font-medium text-orange-600">Critical</span>
          </div>
          <p className="text-3xl font-bold text-orange-600">
            {expiring?.by_urgency.critical.length || 0}
          </p>
          <p className="text-xs text-orange-500 mt-1">Expiring in 7 days</p>
        </div>
        <div className="bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <Clock className="w-5 h-5 text-amber-500" />
            <span className="text-sm font-medium text-amber-600">Warning</span>
          </div>
          <p className="text-3xl font-bold text-amber-600">
            {expiring?.by_urgency.warning.length || 0}
          </p>
          <p className="text-xs text-amber-500 mt-1">Expiring in 30 days</p>
        </div>
        <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <Calendar className="w-5 h-5 text-blue-500" />
            <span className="text-sm font-medium text-blue-600">Follow-ups</span>
          </div>
          <p className="text-3xl font-bold text-blue-600">
            {(followups?.by_status.overdue.length || 0) +
              (followups?.by_status.today.length || 0)}
          </p>
          <p className="text-xs text-blue-500 mt-1">Overdue or due today</p>
        </div>
      </div>

      {/* Expiring Approvals Section */}
      <div className="bg-[var(--ff-bg-primary)] border border-[var(--ff-border-light)] rounded-lg">
        <div className="p-4 border-b border-[var(--ff-border-light)]">
          <h3 className="font-medium text-[var(--ff-text-primary)] flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-500" />
            Expiring Approvals
          </h3>
        </div>
        <div className="divide-y divide-[var(--ff-border-light)]">
          {expiring &&
          Object.entries(expiring.by_urgency).some(([, items]) => items.length > 0) ? (
            (['expired', 'critical', 'warning', 'upcoming'] as ExpiryUrgency[]).map(
              (urgency) => {
                const items = expiring.by_urgency[urgency as keyof typeof expiring.by_urgency];
                if (!items || items.length === 0) return null;
                const config = URGENCY_CONFIG[urgency];

                return (
                  <div key={urgency} className="p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <span className={config.color}>{config.icon}</span>
                      <span className={`text-sm font-medium ${config.color}`}>
                        {config.label} ({items.length})
                      </span>
                    </div>
                    <div className="space-y-2">
                      {items.map((item) => (
                        <Link
                          key={item.id}
                          href={`/pipeline/${item.pipeline_project_id}`}
                          className="flex items-center justify-between p-3 bg-[var(--ff-bg-secondary)] rounded-lg hover:bg-[var(--ff-bg-tertiary)] transition-colors group"
                        >
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-[var(--ff-text-primary)] truncate">
                              {item.approval_type_name}
                            </p>
                            <p className="text-xs text-[var(--ff-text-secondary)] truncate">
                              {item.project_name}
                            </p>
                          </div>
                          <div className="flex items-center gap-3 ml-4">
                            <div className="text-right">
                              <p className="text-xs text-[var(--ff-text-secondary)]">
                                Expires
                              </p>
                              <p className="text-sm font-medium text-[var(--ff-text-primary)]">
                                {formatDate(item.expiry_date)}
                              </p>
                            </div>
                            <span
                              className={`text-xs px-2 py-1 rounded ${config.bgColor} ${config.color}`}
                            >
                              {item.days_until_expiry < 0
                                ? `${Math.abs(item.days_until_expiry)}d overdue`
                                : `${item.days_until_expiry}d`}
                            </span>
                            <ChevronRight className="w-4 h-4 text-[var(--ff-text-tertiary)] opacity-0 group-hover:opacity-100 transition-opacity" />
                          </div>
                        </Link>
                      ))}
                    </div>
                  </div>
                );
              }
            )
          ) : (
            <div className="p-8 text-center">
              <CheckCircle className="w-12 h-12 text-green-400 mx-auto mb-3" />
              <p className="text-[var(--ff-text-secondary)]">
                No approvals expiring in the next 90 days
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Due Follow-ups Section */}
      <div className="bg-[var(--ff-bg-primary)] border border-[var(--ff-border-light)] rounded-lg">
        <div className="p-4 border-b border-[var(--ff-border-light)]">
          <h3 className="font-medium text-[var(--ff-text-primary)] flex items-center gap-2">
            <Calendar className="w-5 h-5 text-blue-500" />
            Due Follow-ups
          </h3>
        </div>
        <div className="divide-y divide-[var(--ff-border-light)]">
          {followups &&
          Object.entries(followups.by_status).some(([, items]) => items.length > 0) ? (
            (['overdue', 'today', 'upcoming', 'scheduled'] as FollowupStatus[]).map(
              (status) => {
                const items = followups.by_status[status as keyof typeof followups.by_status];
                if (!items || items.length === 0) return null;
                const config = FOLLOWUP_CONFIG[status];

                return (
                  <div key={status} className="p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <span
                        className={`w-2 h-2 rounded-full ${config.bgColor.replace('bg-', 'bg-').replace('/30', '')}`}
                      />
                      <span className={`text-sm font-medium ${config.color}`}>
                        {config.label} ({items.length})
                      </span>
                    </div>
                    <div className="space-y-2">
                      {items.map((item) => (
                        <Link
                          key={item.id}
                          href={`/pipeline/${item.pipeline_project_id}`}
                          className="flex items-center justify-between p-3 bg-[var(--ff-bg-secondary)] rounded-lg hover:bg-[var(--ff-bg-tertiary)] transition-colors group"
                        >
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-[var(--ff-text-primary)] truncate">
                              {item.approval_type_name}
                            </p>
                            <p className="text-xs text-[var(--ff-text-secondary)] truncate">
                              {item.project_name}
                            </p>
                          </div>
                          <div className="flex items-center gap-3 ml-4">
                            <div className="text-right">
                              <p className="text-xs text-[var(--ff-text-secondary)]">
                                Follow-up
                              </p>
                              <p className="text-sm font-medium text-[var(--ff-text-primary)]">
                                {formatDate(item.next_followup_date)}
                              </p>
                            </div>
                            <span
                              className={`text-xs px-2 py-1 rounded ${config.bgColor} ${config.color}`}
                            >
                              {item.days_until_followup < 0
                                ? `${Math.abs(item.days_until_followup)}d overdue`
                                : item.days_until_followup === 0
                                  ? 'Today'
                                  : `${item.days_until_followup}d`}
                            </span>
                            <ChevronRight className="w-4 h-4 text-[var(--ff-text-tertiary)] opacity-0 group-hover:opacity-100 transition-opacity" />
                          </div>
                        </Link>
                      ))}
                    </div>
                  </div>
                );
              }
            )
          ) : (
            <div className="p-8 text-center">
              <CheckCircle className="w-12 h-12 text-green-400 mx-auto mb-3" />
              <p className="text-[var(--ff-text-secondary)]">No follow-ups scheduled</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default AlertsDashboard;

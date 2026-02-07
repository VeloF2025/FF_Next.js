/**
 * Overview Tab Component
 * Shows summary statistics and recent activity
 *
 * Follows FibreFlow UI patterns:
 * - CSS variables for dark mode compatibility
 * - Semi-transparent backgrounds for badges
 */

'use client';

import { ArrowRight, TrendingUp, TrendingDown, Clock, Activity } from 'lucide-react';
import type { QAStats, ActionType } from '../types';
import { formatDistanceToNow } from 'date-fns';

interface OverviewTabProps {
  stats: QAStats | null;
  recentActivity: Array<{
    action_type: ActionType;
    action_by: string;
    action_at: string;
    notes: string | null;
  }>;
  onViewAll: () => void;
}

export function OverviewTab({ stats, recentActivity, onViewAll }: OverviewTabProps) {
  if (!stats) return null;

  const totalValidated = stats.ai_confidence.high_confidence + stats.ai_confidence.medium_confidence + stats.ai_confidence.low_confidence;
  const passRate = totalValidated > 0
    ? ((stats.ai_confidence.high_confidence + stats.ai_confidence.medium_confidence) / totalValidated * 100).toFixed(1)
    : '0';

  return (
    <div className="space-y-6">
      {/* Work Type Stats */}
      <div>
        <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-4">
          By Work Type
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {stats.by_work_type.map((wt) => {
            const total = wt.total || 1;
            const approvedPercent = (wt.approved / total) * 100;
            const rejectedPercent = (wt.rejected / total) * 100;
            const pendingPercent = (wt.pending / total) * 100;

            return (
              <div
                key={wt.work_type}
                className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-4"
              >
                <p className="text-sm text-[var(--ff-text-secondary)] mb-1">
                  {formatWorkType(wt.work_type)}
                </p>
                <p className="text-3xl font-bold text-[var(--ff-text-primary)] mb-2">
                  {wt.total}
                </p>
                <div className="flex h-2 rounded overflow-hidden mb-2">
                  <div style={{ width: `${approvedPercent}%` }} className="bg-green-500" />
                  <div style={{ width: `${rejectedPercent}%` }} className="bg-red-500" />
                  <div style={{ width: `${pendingPercent}%` }} className="bg-yellow-500" />
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-green-400">{wt.approved} approved</span>
                  <span className="text-red-400">{wt.rejected} rejected</span>
                </div>
                {wt.avg_confidence && (
                  <p className="text-xs text-[var(--ff-text-tertiary)] mt-2">
                    Avg confidence: {(parseFloat(wt.avg_confidence) * 100).toFixed(0)}%
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* AI Validation Stats */}
      <div>
        <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-4">
          AI Validation Summary
        </h3>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Confidence Distribution */}
          <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-4">
            <div className="flex justify-between items-center mb-4">
              <p className="text-sm text-[var(--ff-text-secondary)]">
                Confidence Distribution
              </p>
              <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                parseFloat(passRate) > 70
                  ? 'bg-green-500/20 text-green-400'
                  : parseFloat(passRate) > 50
                  ? 'bg-yellow-500/20 text-yellow-400'
                  : 'bg-red-500/20 text-red-400'
              }`}>
                {passRate}% Pass Rate
              </span>
            </div>

            <ProgressBar
              label="High Confidence (80%+)"
              value={stats.ai_confidence.high_confidence}
              total={totalValidated || 1}
              color="green"
            />
            <ProgressBar
              label="Medium Confidence (60-80%)"
              value={stats.ai_confidence.medium_confidence}
              total={totalValidated || 1}
              color="yellow"
            />
            <ProgressBar
              label="Low Confidence (<60%)"
              value={stats.ai_confidence.low_confidence}
              total={totalValidated || 1}
              color="red"
            />
            <ProgressBar
              label="Not Validated"
              value={stats.ai_confidence.not_validated}
              total={stats.summary.total || 1}
              color="gray"
            />
          </div>

          {/* Priority Queue */}
          <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-4">
            <p className="text-sm text-[var(--ff-text-secondary)] mb-4">
              Priority Queue
            </p>
            <div className="flex gap-4 flex-wrap">
              <PriorityBadge label="Urgent" count={stats.by_priority.urgent} color="red" />
              <PriorityBadge label="High" count={stats.by_priority.high} color="orange" />
              <PriorityBadge label="Normal" count={stats.by_priority.normal} color="blue" />
              <PriorityBadge label="Low" count={stats.by_priority.low} color="gray" />
            </div>

            {stats.summary.overdue > 0 && (
              <div className="mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
                <div className="flex items-center gap-2">
                  <Clock className="w-5 h-5 text-red-400" />
                  <span className="text-sm font-medium text-red-400">
                    {stats.summary.overdue} overdue items
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Recent Activity */}
      <div>
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">
            Recent Activity
          </h3>
          <button
            onClick={onViewAll}
            className="flex items-center gap-1 text-sm text-blue-400 hover:text-blue-300 transition-colors"
          >
            View All Photos
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
        <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg overflow-hidden">
          {recentActivity.length === 0 ? (
            <div className="p-8 text-center">
              <Activity className="w-8 h-8 mx-auto mb-2 text-[var(--ff-text-tertiary)]" />
              <p className="text-[var(--ff-text-secondary)]">No recent activity</p>
            </div>
          ) : (
            <div className="divide-y divide-[var(--ff-border-light)]">
              {recentActivity.slice(0, 5).map((activity, index) => (
                <div
                  key={index}
                  className="px-4 py-3 flex justify-between items-center"
                >
                  <div className="flex items-center gap-3">
                    <ActionIcon action={activity.action_type} />
                    <div>
                      <p className="text-sm text-[var(--ff-text-primary)]">
                        <span className="font-medium">{activity.action_by}</span>
                        {' '}
                        {formatAction(activity.action_type)}
                      </p>
                      {activity.notes && (
                        <p className="text-xs text-[var(--ff-text-tertiary)]">
                          {activity.notes}
                        </p>
                      )}
                    </div>
                  </div>
                  <span className="text-xs text-[var(--ff-text-tertiary)]">
                    {formatDistanceToNow(new Date(activity.action_at), { addSuffix: true })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ProgressBar({
  label,
  value,
  total,
  color,
}: {
  label: string;
  value: number;
  total: number;
  color: 'green' | 'yellow' | 'red' | 'gray';
}) {
  const percent = (value / total) * 100;
  const colorClasses = {
    green: 'bg-green-500',
    yellow: 'bg-yellow-500',
    red: 'bg-red-500',
    gray: 'bg-gray-500',
  };
  const textClasses = {
    green: 'text-green-400',
    yellow: 'text-yellow-400',
    red: 'text-red-400',
    gray: 'text-[var(--ff-text-tertiary)]',
  };

  return (
    <div className="mb-3 last:mb-0">
      <div className="flex justify-between text-sm mb-1">
        <span className="text-[var(--ff-text-secondary)]">{label}</span>
        <span className={`font-medium ${textClasses[color]}`}>{value}</span>
      </div>
      <div className="h-2 bg-[var(--ff-bg-tertiary)] rounded overflow-hidden">
        <div
          className={`h-full ${colorClasses[color]} rounded transition-all`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

function PriorityBadge({
  label,
  count,
  color,
}: {
  label: string;
  count: number;
  color: 'red' | 'orange' | 'blue' | 'gray';
}) {
  const colorClasses = {
    red: 'bg-red-500/20 border-red-500 text-red-400',
    orange: 'bg-orange-500/20 border-orange-500 text-orange-400',
    blue: 'bg-blue-500/20 border-blue-500 text-blue-400',
    gray: 'bg-gray-500/20 border-gray-500 text-gray-400',
  };

  return (
    <div className="text-center min-w-[80px]">
      <div
        className={`w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-1 border-2 ${colorClasses[color]}`}
      >
        <span className="text-lg font-bold">{count}</span>
      </div>
      <span className="text-xs text-[var(--ff-text-secondary)]">{label}</span>
    </div>
  );
}

function ActionIcon({ action }: { action: ActionType }) {
  const iconClass = 'w-5 h-5';
  switch (action) {
    case 'approve':
      return <TrendingUp className={`${iconClass} text-green-400`} />;
    case 'reject':
      return <TrendingDown className={`${iconClass} text-red-400`} />;
    case 'escalate':
      return <Activity className={`${iconClass} text-yellow-400`} />;
    default:
      return <Activity className={`${iconClass} text-[var(--ff-text-tertiary)]`} />;
  }
}

function formatAction(action: ActionType): string {
  switch (action) {
    case 'approve': return 'approved a photo';
    case 'reject': return 'rejected a photo';
    case 'escalate': return 'escalated a photo';
    case 'assign': return 'assigned a photo';
    case 'revalidate': return 'triggered re-validation';
    case 'comment': return 'added a comment';
    default: return 'performed an action';
  }
}

function formatWorkType(workType: string): string {
  switch (workType) {
    case 'pole_installation': return 'Pole Installation';
    case 'cable_stringing': return 'Cable Stringing';
    case 'dome_joint': return 'Dome Joint';
    case 'activation': return 'Activation';
    default: return workType.charAt(0).toUpperCase() + workType.slice(1).replace(/_/g, ' ');
  }
}

export default OverviewTab;

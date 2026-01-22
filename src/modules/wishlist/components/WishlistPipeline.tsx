/**
 * Wishlist Pipeline - Shows MVP build status for approved items
 */

import { useState, useEffect } from 'react';
import {
  GitBranch,
  ExternalLink,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import type { WishlistItem, MvpBuildStatus } from '../types/wishlist';

interface WishlistPipelineProps {
  items: WishlistItem[];
  onRefresh: () => void;
}

const statusConfig: Record<MvpBuildStatus, { icon: React.ElementType; color: string; label: string }> = {
  pending: { icon: Clock, color: 'text-yellow-500', label: 'Pending' },
  building: { icon: Loader2, color: 'text-blue-500', label: 'Building' },
  complete: { icon: CheckCircle2, color: 'text-green-500', label: 'Complete' },
  failed: { icon: XCircle, color: 'text-red-500', label: 'Failed' },
};

export function WishlistPipeline({ items, onRefresh }: WishlistPipelineProps) {
  const [refreshing, setRefreshing] = useState(false);

  // Filter items that have MVP pipeline data
  const pipelineItems = items.filter(
    (item) => item.build_status || item.github_issue_url
  );

  // Items eligible for MVP (approved + XS/S/M) but not yet triggered
  const eligibleItems = items.filter(
    (item) =>
      item.status === 'Approved' &&
      ['XS', 'S', 'M'].includes(item.effort_estimate || '') &&
      !item.github_issue_url
  );

  const handleRefresh = async () => {
    setRefreshing(true);
    await onRefresh();
    setTimeout(() => setRefreshing(false), 500);
  };

  // Group pipeline items by status
  const groupedItems = {
    building: pipelineItems.filter((item) => item.build_status === 'building'),
    pending: pipelineItems.filter((item) => item.build_status === 'pending'),
    complete: pipelineItems.filter((item) => item.build_status === 'complete'),
    failed: pipelineItems.filter((item) => item.build_status === 'failed'),
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-lg font-semibold text-[var(--ff-text-primary)]">
            MVP Development Pipeline
          </h2>
          <p className="text-sm text-[var(--ff-text-secondary)]">
            Approved wishlist items being built by Claude Code
          </p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="inline-flex items-center px-3 py-1.5 text-sm text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] transition-colors"
        >
          <RefreshCw className={`h-4 w-4 mr-1.5 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard
          label="Building"
          count={groupedItems.building.length}
          icon={Loader2}
          color="bg-blue-500/10 text-blue-500"
        />
        <StatCard
          label="Pending"
          count={groupedItems.pending.length}
          icon={Clock}
          color="bg-yellow-500/10 text-yellow-500"
        />
        <StatCard
          label="Complete"
          count={groupedItems.complete.length}
          icon={CheckCircle2}
          color="bg-green-500/10 text-green-500"
        />
        <StatCard
          label="Failed"
          count={groupedItems.failed.length}
          icon={XCircle}
          color="bg-red-500/10 text-red-500"
        />
      </div>

      {/* Eligible Items Notice */}
      {eligibleItems.length > 0 && (
        <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-blue-500 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-blue-600">
                {eligibleItems.length} item{eligibleItems.length > 1 ? 's' : ''} eligible for MVP automation
              </p>
              <p className="text-xs text-blue-500 mt-1">
                These approved items have XS/S/M effort and will trigger builds automatically.
                Make sure GITHUB_TOKEN is configured.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Pipeline Items */}
      {pipelineItems.length === 0 ? (
        <div className="text-center py-12 bg-[var(--ff-bg-secondary)] rounded-lg">
          <GitBranch className="h-12 w-12 mx-auto text-[var(--ff-text-tertiary)] mb-4" />
          <h3 className="text-lg font-medium text-[var(--ff-text-primary)] mb-2">
            No MVP Builds Yet
          </h3>
          <p className="text-sm text-[var(--ff-text-secondary)] max-w-md mx-auto">
            When you approve a wishlist item with effort XS, S, or M, it will automatically
            trigger an MVP build via Claude Code.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Active Builds */}
          {groupedItems.building.length > 0 && (
            <BuildSection
              title="Currently Building"
              items={groupedItems.building}
              showProgress
            />
          )}

          {/* Pending */}
          {groupedItems.pending.length > 0 && (
            <BuildSection title="Pending" items={groupedItems.pending} />
          )}

          {/* Recent Completions */}
          {groupedItems.complete.length > 0 && (
            <BuildSection title="Completed" items={groupedItems.complete} />
          )}

          {/* Failed */}
          {groupedItems.failed.length > 0 && (
            <BuildSection title="Failed" items={groupedItems.failed} showError />
          )}
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  count,
  icon: Icon,
  color,
}: {
  label: string;
  count: number;
  icon: React.ElementType;
  color: string;
}) {
  return (
    <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-4 border border-[var(--ff-border-light)]">
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-lg ${color}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="text-2xl font-bold text-[var(--ff-text-primary)]">{count}</p>
          <p className="text-sm text-[var(--ff-text-secondary)]">{label}</p>
        </div>
      </div>
    </div>
  );
}

function BuildSection({
  title,
  items,
  showProgress = false,
  showError = false,
}: {
  title: string;
  items: WishlistItem[];
  showProgress?: boolean;
  showError?: boolean;
}) {
  return (
    <div>
      <h3 className="text-sm font-medium text-[var(--ff-text-secondary)] mb-3">{title}</h3>
      <div className="space-y-2">
        {items.map((item) => (
          <BuildCard
            key={item.id}
            item={item}
            showProgress={showProgress}
            showError={showError}
          />
        ))}
      </div>
    </div>
  );
}

function BuildCard({
  item,
  showProgress,
  showError,
}: {
  item: WishlistItem;
  showProgress: boolean;
  showError: boolean;
}) {
  const status = item.build_status || 'pending';
  const config = statusConfig[status];
  const StatusIcon = config.icon;

  return (
    <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-4 border border-[var(--ff-border-light)]">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <StatusIcon
              className={`h-4 w-4 ${config.color} ${status === 'building' ? 'animate-spin' : ''}`}
            />
            <h4 className="font-medium text-[var(--ff-text-primary)]">{item.title}</h4>
          </div>

          <div className="flex items-center gap-4 mt-2 text-xs text-[var(--ff-text-tertiary)]">
            <span className="inline-flex items-center gap-1">
              Effort: {item.effort_estimate || 'N/A'}
            </span>
            <span className="inline-flex items-center gap-1">
              Priority: {item.priority}
            </span>
          </div>

          {/* Progress Bar */}
          {showProgress && item.build_progress !== undefined && (
            <div className="mt-3">
              <div className="flex justify-between text-xs text-[var(--ff-text-secondary)] mb-1">
                <span>Progress</span>
                <span>{item.build_progress}%</span>
              </div>
              <div className="h-2 bg-[var(--ff-bg-tertiary)] rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500 transition-all duration-500"
                  style={{ width: `${item.build_progress}%` }}
                />
              </div>
            </div>
          )}

          {/* Error Message */}
          {showError && item.build_error && (
            <div className="mt-2 p-2 bg-red-500/10 rounded text-xs text-red-500">
              {item.build_error}
            </div>
          )}
        </div>

        {/* Links */}
        <div className="flex items-center gap-2 ml-4">
          {item.github_issue_url && (
            <a
              href={item.github_issue_url}
              target="_blank"
              rel="noopener noreferrer"
              className="p-2 text-[var(--ff-text-tertiary)] hover:text-[var(--ff-text-primary)] transition-colors"
              title="View GitHub Issue"
            >
              <GitBranch className="h-4 w-4" />
            </a>
          )}
          {item.github_pr_url && (
            <a
              href={item.github_pr_url}
              target="_blank"
              rel="noopener noreferrer"
              className="p-2 text-green-500 hover:text-green-400 transition-colors"
              title="View Pull Request"
            >
              <ExternalLink className="h-4 w-4" />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

export default WishlistPipeline;

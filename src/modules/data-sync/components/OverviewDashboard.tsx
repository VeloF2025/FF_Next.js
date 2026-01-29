/**
 * Data Sync Overview Dashboard
 * Shows aggregated stats and clickable category cards for each sync group
 */

'use client';

import React, { useState, useEffect } from 'react';
import {
  Database,
  Wrench,
  Zap,
  AlertTriangle,
  Clock,
  CheckCircle,
  ArrowRight,
  Loader2,
  RefreshCw,
  FileSpreadsheet,
  Upload,
  Users,
} from 'lucide-react';
import type { TabGroupId, DataSyncStats } from '../types';

interface OverviewDashboardProps {
  onGroupSelect: (groupId: TabGroupId) => void;
}

// Category card configuration
const CATEGORY_CARDS: {
  id: TabGroupId;
  label: string;
  icon: React.ElementType;
  description: string;
  color: string;
  bgColor: string;
}[] = [
  {
    id: 'maintenance',
    label: 'Maintenance',
    icon: Wrench,
    description: 'QContact sync, alignment reports, weekly imports, and offline tracking',
    color: 'text-blue-400',
    bgColor: 'bg-blue-500/10',
  },
  {
    id: 'activate',
    label: 'Activate',
    icon: Zap,
    description: 'OES activation imports, ARCH offline device reports, and manual DR entry',
    color: 'text-amber-400',
    bgColor: 'bg-amber-500/10',
  },
  {
    id: 'olt',
    label: 'OLT Report',
    icon: AlertTriangle,
    description: 'Nokia OLT report import, serial mismatch fixes, and 1Map integration',
    color: 'text-red-400',
    bgColor: 'bg-red-500/10',
  },
  {
    id: 'history',
    label: 'History',
    icon: Clock,
    description: 'Unified timeline of all sync and import operations with status tracking',
    color: 'text-cyan-400',
    bgColor: 'bg-cyan-500/10',
  },
];

export function OverviewDashboard({ onGroupSelect }: OverviewDashboardProps) {
  const [stats, setStats] = useState<DataSyncStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch stats
  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await fetch('/api/system/data-sync/stats');
        if (res.ok) {
          const data = await res.json();
          if (data.success) {
            setStats(data.data);
          } else {
            setError(data.error || 'Failed to load stats');
          }
        } else {
          setError('Failed to fetch stats');
        }
      } catch {
        setError('Failed to fetch stats');
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
  }, []);

  // Format relative time
  const formatRelativeTime = (dateStr: string | null): string => {
    if (!dateStr) return 'Never';
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${diffDays}d ago`;
  };

  // Get stats for a category
  const getStatsForCategory = (id: TabGroupId) => {
    if (!stats) return [];

    switch (id) {
      case 'maintenance':
        return [
          {
            label: 'Last Sync',
            value: formatRelativeTime(stats.maintenance.lastQContactSync),
            icon: Clock,
          },
          {
            label: 'Pending Tickets',
            value: stats.maintenance.pendingTickets.toString(),
            icon: RefreshCw,
          },
          {
            label: 'Weekly Imports',
            value: stats.maintenance.weeklyImportsThisMonth.toString(),
            icon: FileSpreadsheet,
          },
        ];
      case 'activate':
        return [
          {
            label: 'Last OES Import',
            value: formatRelativeTime(stats.activate.lastOESImport),
            icon: Upload,
          },
          {
            label: 'Total DRs',
            value: stats.activate.totalDRs.toLocaleString(),
            icon: Database,
          },
          {
            label: 'Pending Review',
            value: stats.activate.pendingReview.toString(),
            icon: Clock,
          },
        ];
      case 'olt':
        return [
          {
            label: 'Pending Fixes',
            value: stats.olt.pendingFixes.toString(),
            icon: Wrench,
            highlight: stats.olt.pendingFixes > 0,
          },
          {
            label: 'Needs Investigation',
            value: stats.olt.needsInvestigation.toString(),
            icon: AlertTriangle,
            highlight: stats.olt.needsInvestigation > 0,
          },
          {
            label: 'Fixed This Week',
            value: stats.olt.fixedThisWeek.toString(),
            icon: CheckCircle,
          },
        ];
      case 'history':
        return [
          { label: 'View All', value: 'Timeline', icon: Clock },
        ];
      default:
        return [];
    }
  };

  return (
    <div className="space-y-8">
      {/* Summary Stats Row */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-[var(--ff-bg-secondary)] rounded-xl p-5 border border-[var(--ff-border-light)]">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-[var(--ff-accent)]/10 rounded-lg">
              <Database className="w-5 h-5 text-[var(--ff-accent)]" />
            </div>
            <span className="text-sm text-[var(--ff-text-secondary)]">Total Sync Sources</span>
          </div>
          <p className="text-3xl font-bold text-[var(--ff-text-primary)]">3</p>
        </div>

        {loading ? (
          <>
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="bg-[var(--ff-bg-secondary)] rounded-xl p-5 border border-[var(--ff-border-light)] animate-pulse"
              >
                <div className="h-4 w-24 bg-[var(--ff-bg-tertiary)] rounded mb-3" />
                <div className="h-8 w-16 bg-[var(--ff-bg-tertiary)] rounded" />
              </div>
            ))}
          </>
        ) : stats ? (
          <>
            <div className="bg-[var(--ff-bg-secondary)] rounded-xl p-5 border border-[var(--ff-border-light)]">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 bg-amber-500/10 rounded-lg">
                  <Clock className="w-5 h-5 text-amber-400" />
                </div>
                <span className="text-sm text-[var(--ff-text-secondary)]">Pending Actions</span>
              </div>
              <p className="text-3xl font-bold text-[var(--ff-text-primary)]">
                {stats.maintenance.pendingTickets +
                  stats.activate.pendingReview +
                  stats.olt.pendingFixes}
              </p>
            </div>

            <div className="bg-[var(--ff-bg-secondary)] rounded-xl p-5 border border-[var(--ff-border-light)]">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 bg-red-500/10 rounded-lg">
                  <AlertTriangle className="w-5 h-5 text-red-400" />
                </div>
                <span className="text-sm text-[var(--ff-text-secondary)]">Needs Attention</span>
              </div>
              <p className="text-3xl font-bold text-[var(--ff-text-primary)]">
                {stats.olt.needsInvestigation + stats.olt.escalated}
              </p>
            </div>

            <div className="bg-[var(--ff-bg-secondary)] rounded-xl p-5 border border-[var(--ff-border-light)]">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 bg-green-500/10 rounded-lg">
                  <CheckCircle className="w-5 h-5 text-green-400" />
                </div>
                <span className="text-sm text-[var(--ff-text-secondary)]">Fixed This Week</span>
              </div>
              <p className="text-3xl font-bold text-[var(--ff-text-primary)]">
                {stats.olt.fixedThisWeek}
              </p>
            </div>
          </>
        ) : null}
      </div>

      {/* Error message */}
      {error && (
        <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400">
          {error}
        </div>
      )}

      {/* Category Cards */}
      <div>
        <h2 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-4">Sync Categories</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {CATEGORY_CARDS.map((card) => {
            const Icon = card.icon;
            const cardStats = getStatsForCategory(card.id);

            return (
              <button
                key={card.id}
                onClick={() => onGroupSelect(card.id)}
                className="group bg-[var(--ff-bg-secondary)] rounded-xl p-6 border border-[var(--ff-border-light)] hover:border-[var(--ff-accent)] transition-all text-left"
              >
                {/* Card Header */}
                <div className="flex items-start justify-between mb-4">
                  <div className={`p-3 rounded-xl ${card.bgColor}`}>
                    <Icon className={`w-6 h-6 ${card.color}`} />
                  </div>
                  <ArrowRight className="w-5 h-5 text-[var(--ff-text-tertiary)] group-hover:text-[var(--ff-accent)] group-hover:translate-x-1 transition-all" />
                </div>

                {/* Card Title */}
                <h3 className="text-xl font-semibold text-[var(--ff-text-primary)] mb-2 group-hover:text-[var(--ff-accent)] transition-colors">
                  {card.label}
                </h3>

                {/* Card Description */}
                <p className="text-sm text-[var(--ff-text-secondary)] mb-4 line-clamp-2">
                  {card.description}
                </p>

                {/* Card Stats */}
                {loading ? (
                  <div className="flex items-center gap-2 text-[var(--ff-text-tertiary)]">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span className="text-sm">Loading stats...</span>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-4 pt-4 border-t border-[var(--ff-border-light)]">
                    {cardStats.map((stat, idx) => {
                      const StatIcon = stat.icon;
                      return (
                        <div key={idx} className="flex items-center gap-2">
                          <StatIcon
                            className={`w-4 h-4 ${
                              'highlight' in stat && stat.highlight
                                ? 'text-amber-400'
                                : 'text-[var(--ff-text-tertiary)]'
                            }`}
                          />
                          <span className="text-xs text-[var(--ff-text-tertiary)]">
                            {stat.label}:
                          </span>
                          <span
                            className={`text-sm font-medium ${
                              'highlight' in stat && stat.highlight
                                ? 'text-amber-400'
                                : 'text-[var(--ff-text-primary)]'
                            }`}
                          >
                            {stat.value}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Quick Actions */}
      <div>
        <h2 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-4">Quick Actions</h2>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => onGroupSelect('maintenance')}
            className="flex items-center gap-2 px-4 py-2 bg-[var(--ff-bg-tertiary)] hover:bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] rounded-lg transition-colors border border-[var(--ff-border-light)]"
          >
            <RefreshCw className="w-4 h-4 text-blue-400" />
            Sync QContact
          </button>
          <button
            onClick={() => onGroupSelect('activate')}
            className="flex items-center gap-2 px-4 py-2 bg-[var(--ff-bg-tertiary)] hover:bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] rounded-lg transition-colors border border-[var(--ff-border-light)]"
          >
            <Upload className="w-4 h-4 text-amber-400" />
            Import OES Report
          </button>
          <button
            onClick={() => onGroupSelect('olt')}
            className="flex items-center gap-2 px-4 py-2 bg-[var(--ff-bg-tertiary)] hover:bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] rounded-lg transition-colors border border-[var(--ff-border-light)]"
          >
            <Wrench className="w-4 h-4 text-red-400" />
            Fix OLT Mismatches
          </button>
          <button
            onClick={() => onGroupSelect('history')}
            className="flex items-center gap-2 px-4 py-2 bg-[var(--ff-bg-tertiary)] hover:bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] rounded-lg transition-colors border border-[var(--ff-border-light)]"
          >
            <Clock className="w-4 h-4 text-cyan-400" />
            View History
          </button>
        </div>
      </div>
    </div>
  );
}

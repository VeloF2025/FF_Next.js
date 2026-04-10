/**
 * VLM Learning Dashboard
 *
 * Admin interface for managing VLM corrections and viewing accuracy metrics.
 * Uses HITL (Human-in-the-Loop) corrections to improve VLM accuracy via few-shot learning.
 *
 * Tabs:
 * - Overview: Module accuracy summary and trends
 * - Corrections: Browse and manage correction records
 * - Canonical: Curated high-quality examples
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { AppLayout } from '@/components/layout/AppLayout';
import { useAuth } from '@/contexts/AuthContext';
import { Permission } from '@/types/auth.types';
import {
  Brain,
  TrendingUp,
  ListChecks,
  Star,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  Filter,
  Trash2,
} from 'lucide-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import { log } from '@/lib/logger';
import type {
  VlmModule,
  VlmAnalysisType,
  VlmCorrection,
  ModuleAccuracySummary,
  VlmMetricsSummary,
  ErrorPattern,
} from '@/types/vlm-learning';

// Tab types
type TabId = 'overview' | 'corrections' | 'canonical';

const TABS: { id: TabId; label: string; icon: React.ElementType }[] = [
  { id: 'overview', label: 'Overview', icon: TrendingUp },
  { id: 'corrections', label: 'Corrections', icon: ListChecks },
  { id: 'canonical', label: 'Canonical Examples', icon: Star },
];

const MODULE_LABELS: Record<VlmModule, string> = {
  activate: 'Activate',
  fleet: 'Fleet',
  procurement: 'Procurement',
  assets: 'Assets',
  staff: 'Staff',
  qfield: 'QField',
  construction_qa: 'Construction QA',
  'data-sync': 'Data Sync',
};

export default function VlmLearningPage() {
  const router = useRouter();
  const { user, hasPermission } = useAuth();
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  // Check permissions
  const hasAccess = hasPermission(Permission.SYSTEM_ADMIN);

  // Handle URL tab parameter
  useEffect(() => {
    const { tab } = router.query;
    if (tab && typeof tab === 'string' && TABS.some((t) => t.id === tab)) {
      setActiveTab(tab as TabId);
    }
  }, [router.query]);

  const handleTabChange = (tab: TabId) => {
    setActiveTab(tab);
    router.push({ pathname: '/system/vlm-learning', query: { tab } }, undefined, { shallow: true });
  };

  const handleRefresh = useCallback(() => {
    setIsRefreshing(true);
    setLastRefresh(new Date());
    setTimeout(() => setIsRefreshing(false), 1000);
  }, []);

  if (!hasAccess) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="text-center">
            <AlertTriangle className="w-16 h-16 text-yellow-500 mx-auto mb-4" />
            <h1 className="text-2xl font-semibold text-white mb-2">Access Denied</h1>
            <p className="text-gray-400">
              You do not have permission to view the VLM Learning Dashboard.
            </p>
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <Head>
        <title>VLM Learning | FibreFlow</title>
      </Head>

      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Brain className="w-8 h-8 text-purple-500" />
            <div>
              <h1 className="text-2xl font-semibold text-white">VLM Learning</h1>
              <p className="text-sm text-gray-400">
                Manage corrections and improve VLM accuracy via few-shot learning
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-500">
              Last updated: {lastRefresh.toLocaleTimeString()}
            </span>
            <button
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-5 h-5 ${isRefreshing ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="border-b border-gray-800">
          <nav className="-mb-px flex gap-4" aria-label="Tabs">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => handleTabChange(tab.id)}
                  className={`flex items-center gap-2 px-4 py-3 border-b-2 text-sm font-medium transition-colors ${
                    isActive
                      ? 'border-purple-500 text-purple-400'
                      : 'border-transparent text-gray-400 hover:text-gray-200 hover:border-gray-600'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {tab.label}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Tab Content */}
        <div key={lastRefresh.getTime()}>
          {activeTab === 'overview' && <OverviewTab />}
          {activeTab === 'corrections' && <CorrectionsTab isCanonicalOnly={false} />}
          {activeTab === 'canonical' && <CorrectionsTab isCanonicalOnly={true} />}
        </div>
      </div>
    </AppLayout>
  );
}

// ============================================================================
// Overview Tab
// ============================================================================

function OverviewTab() {
  const [summaries, setSummaries] = useState<ModuleAccuracySummary[]>([]);
  const [metrics, setMetrics] = useState<VlmMetricsSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      setIsLoading(true);
      try {
        const [summaryRes, metricsRes] = await Promise.all([
          fetch('/api/system/vlm/metrics?summary=modules'),
          fetch('/api/system/vlm/metrics'),
        ]);

        if (summaryRes.ok) {
          const data = await summaryRes.json();
          setSummaries(data.data?.summaries || []);
        }

        if (metricsRes.ok) {
          const data = await metricsRes.json();
          setMetrics(data.data || null);
        }
      } catch (error) {
        log.error('VLM Learning: Failed to fetch metrics', { error });
      } finally {
        setIsLoading(false);
      }
    }

    fetchData();
  }, []);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="w-8 h-8 animate-spin text-purple-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Overall Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard
          label="Total Extractions"
          value={metrics?.totals.extractions || 0}
          icon={Brain}
        />
        <StatCard
          label="Correct"
          value={metrics?.totals.correct || 0}
          icon={CheckCircle2}
          color="green"
        />
        <StatCard
          label="Corrected (HITL)"
          value={metrics?.totals.corrected || 0}
          icon={ListChecks}
          color="yellow"
        />
        <StatCard
          label="Failed"
          value={metrics?.totals.failed || 0}
          icon={XCircle}
          color="red"
        />
      </div>

      {/* Module Accuracy Cards */}
      <div>
        <h2 className="text-lg font-medium text-white mb-4">Accuracy by Module</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {summaries.map((summary) => (
            <ModuleAccuracyCard key={summary.module} summary={summary} />
          ))}
          {summaries.length === 0 && (
            <div className="col-span-full text-center py-8 text-gray-500">
              No metrics data available yet. VLM extractions will be tracked automatically.
            </div>
          )}
        </div>
      </div>

      {/* Accuracy Trend Chart */}
      {metrics?.accuracy?.byDay && metrics.accuracy.byDay.length > 0 && (
        <div>
          <h2 className="text-lg font-medium text-white mb-4">Accuracy Trend (Last 30 Days)</h2>
          <div className="bg-gray-900 rounded-lg border border-gray-800 p-4">
            <ResponsiveContainer width="100%" height={280}>
              <LineChart
                data={metrics.accuracy.byDay.map((d) => ({
                  ...d,
                  ratePercent: (d.rate * 100).toFixed(1),
                  dateFormatted: new Date(d.date).toLocaleDateString('en-GB', {
                    day: 'numeric',
                    month: 'short',
                  }),
                }))}
                margin={{ top: 10, right: 30, left: 0, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis
                  dataKey="dateFormatted"
                  stroke="#9CA3AF"
                  fontSize={12}
                  tickLine={false}
                />
                <YAxis
                  domain={[0, 100]}
                  stroke="#9CA3AF"
                  fontSize={12}
                  tickLine={false}
                  tickFormatter={(value) => `${value}%`}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#1F2937',
                    border: '1px solid #374151',
                    borderRadius: '8px',
                    color: '#fff',
                  }}
                  labelStyle={{ color: '#9CA3AF' }}
                  formatter={((value: number, name: string) => {
                    if (name === 'ratePercent') return [`${value}%`, 'Accuracy'];
                    if (name === 'count') return [value, 'Extractions'];
                    return [value, name];
                  }) as any}
                />
                <Line
                  type="monotone"
                  dataKey="ratePercent"
                  stroke="#A855F7"
                  strokeWidth={2}
                  dot={{ fill: '#A855F7', strokeWidth: 0, r: 3 }}
                  activeDot={{ r: 5, fill: '#A855F7' }}
                />
              </LineChart>
            </ResponsiveContainer>
            <div className="flex justify-center gap-6 mt-2 text-sm text-gray-400">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-purple-500" />
                <span>Accuracy Rate</span>
              </div>
              <div>
                Total extractions this period:{' '}
                <span className="text-white font-medium">
                  {metrics.totals.extractions.toLocaleString()}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Top Errors */}
      {metrics?.topErrors && metrics.topErrors.length > 0 && (
        <div>
          <h2 className="text-lg font-medium text-white mb-4">Common Error Patterns</h2>
          <div className="bg-gray-900 rounded-lg border border-gray-800 overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-800">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">
                    Pattern
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase">
                    Count
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase">
                    % of Errors
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {metrics.topErrors.map((error) => (
                  <tr key={error.pattern}>
                    <td className="px-4 py-3 text-sm text-white font-mono">
                      {formatErrorPattern(error.pattern)}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-400 text-right">{error.count}</td>
                    <td className="px-4 py-3 text-sm text-gray-400 text-right">
                      {error.percentage.toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  icon: Icon,
  color = 'purple',
}: {
  label: string;
  value: number;
  icon: React.ElementType;
  color?: 'purple' | 'green' | 'yellow' | 'red';
}) {
  const colorClasses = {
    purple: 'text-purple-500 bg-purple-500/10',
    green: 'text-green-500 bg-green-500/10',
    yellow: 'text-yellow-500 bg-yellow-500/10',
    red: 'text-red-500 bg-red-500/10',
  };

  return (
    <div className="bg-gray-900 rounded-lg border border-gray-800 p-4">
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-lg ${colorClasses[color]}`}>
          <Icon className="w-5 h-5" />
        </div>
        <div>
          <p className="text-sm text-gray-400">{label}</p>
          <p className="text-2xl font-semibold text-white">{value.toLocaleString()}</p>
        </div>
      </div>
    </div>
  );
}

function ModuleAccuracyCard({ summary }: { summary: ModuleAccuracySummary }) {
  const accuracyPercent = (summary.accuracy * 100).toFixed(1);
  const trendPercent = (summary.trendValue * 100).toFixed(1);

  const TrendIcon =
    summary.trend === 'up' ? ArrowUpRight : summary.trend === 'down' ? ArrowDownRight : Minus;
  const trendColor =
    summary.trend === 'up'
      ? 'text-green-500'
      : summary.trend === 'down'
        ? 'text-red-500'
        : 'text-gray-500';

  return (
    <div className="bg-gray-900 rounded-lg border border-gray-800 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-medium text-white">{summary.displayName}</h3>
        <div className={`flex items-center gap-1 text-sm ${trendColor}`}>
          <TrendIcon className="w-4 h-4" />
          <span>{summary.trend === 'stable' ? '0' : trendPercent}%</span>
        </div>
      </div>

      <div className="mb-3">
        <div className="flex items-end gap-2">
          <span className="text-3xl font-bold text-white">{accuracyPercent}%</span>
          <span className="text-sm text-gray-400 mb-1">accuracy</span>
        </div>
      </div>

      <div className="w-full bg-gray-800 rounded-full h-2 mb-3">
        <div
          className="bg-purple-500 h-2 rounded-full transition-all"
          style={{ width: `${summary.accuracy * 100}%` }}
        />
      </div>

      <div className="flex justify-between text-xs text-gray-400">
        <span>{summary.totalExtractions.toLocaleString()} extractions</span>
        <span>{summary.correctionCount} corrections</span>
      </div>
    </div>
  );
}

// ============================================================================
// Corrections Tab
// ============================================================================

function CorrectionsTab({ isCanonicalOnly }: { isCanonicalOnly: boolean }) {
  const [corrections, setCorrections] = useState<VlmCorrection[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [filters, setFilters] = useState({
    module: '' as VlmModule | '',
    analysisType: '' as VlmAnalysisType | '',
    errorPattern: '' as ErrorPattern | '',
  });
  const [page, setPage] = useState(0);
  const limit = 20;

  const fetchCorrections = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.module) params.set('module', filters.module);
      if (filters.analysisType) params.set('analysisType', filters.analysisType);
      if (filters.errorPattern) params.set('errorPattern', filters.errorPattern);
      if (isCanonicalOnly) params.set('isCanonical', 'true');
      params.set('limit', String(limit));
      params.set('offset', String(page * limit));

      const res = await fetch(`/api/system/vlm/corrections?${params}`);
      if (res.ok) {
        const data = await res.json();
        setCorrections(data.data?.corrections || []);
        setTotal(data.data?.total || 0);
      }
    } catch (error) {
      log.error('VLM Learning: Failed to fetch corrections', { error });
    } finally {
      setIsLoading(false);
    }
  }, [filters, page, isCanonicalOnly]);

  useEffect(() => {
    fetchCorrections();
  }, [fetchCorrections]);

  const handleToggleCanonical = async (id: string, isCanonical: boolean) => {
    try {
      const res = await fetch('/api/system/vlm/corrections', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, isCanonical: !isCanonical }),
      });
      if (res.ok) {
        fetchCorrections();
      }
    } catch (error) {
      log.error('VLM Learning: Failed to update correction', { error });
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this correction?')) return;

    try {
      const res = await fetch(`/api/system/vlm/corrections?id=${id}`, { method: 'DELETE' });
      if (res.ok) {
        fetchCorrections();
      }
    } catch (error) {
      log.error('VLM Learning: Failed to delete correction', { error });
    }
  };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <Filter className="w-4 h-4 text-gray-400" />
        <select
          value={filters.module}
          onChange={(e) => {
            setFilters({ ...filters, module: e.target.value as VlmModule | '' });
            setPage(0);
          }}
          className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:ring-purple-500 focus:border-purple-500"
        >
          <option value="">All Modules</option>
          {Object.entries(MODULE_LABELS).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>

        <select
          value={filters.errorPattern}
          onChange={(e) => {
            setFilters({ ...filters, errorPattern: e.target.value as ErrorPattern | '' });
            setPage(0);
          }}
          className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:ring-purple-500 focus:border-purple-500"
        >
          <option value="">All Patterns</option>
          <option value="digit_1_6">Digit 1↔6</option>
          <option value="digit_1_7">Digit 1↔7</option>
          <option value="digit_6_8">Digit 6↔8</option>
          <option value="ssid_not_serial">SSID ≠ Serial</option>
          <option value="gauge_reversed">Gauge Reversed</option>
        </select>

        <span className="text-sm text-gray-400 ml-auto">
          {total} {isCanonicalOnly ? 'canonical examples' : 'corrections'}
        </span>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <RefreshCw className="w-8 h-8 animate-spin text-purple-500" />
        </div>
      ) : corrections.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          No {isCanonicalOnly ? 'canonical examples' : 'corrections'} found.
          {!isCanonicalOnly &&
            ' Corrections will appear here when users override VLM readings.'}
        </div>
      ) : (
        <div className="bg-gray-900 rounded-lg border border-gray-800 overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-800">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">
                  Module / Type
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">
                  VLM Value
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">
                  Correct Value
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">
                  Pattern
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">
                  Date
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {corrections.map((correction) => (
                <tr key={correction.id} className="hover:bg-gray-800/50">
                  <td className="px-4 py-3">
                    <div className="text-sm text-white">
                      {MODULE_LABELS[correction.module]}
                    </div>
                    <div className="text-xs text-gray-500">{correction.analysisType}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-mono text-sm text-red-400 line-through">
                      {correction.vlmExtractedValue || '-'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-mono text-sm text-green-400">
                      {correction.correctedValue}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {correction.errorPattern ? (
                      <span className="inline-flex items-center px-2 py-1 rounded-full text-xs bg-gray-800 text-gray-300">
                        {formatErrorPattern(correction.errorPattern)}
                      </span>
                    ) : (
                      <span className="text-gray-500">-</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-400">
                    {new Date(correction.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => handleToggleCanonical(correction.id, correction.isCanonical)}
                        className={`p-1.5 rounded-lg transition-colors ${
                          correction.isCanonical
                            ? 'text-yellow-400 hover:bg-yellow-500/10'
                            : 'text-gray-500 hover:text-yellow-400 hover:bg-gray-700'
                        }`}
                        title={correction.isCanonical ? 'Remove from canonical' : 'Mark as canonical'}
                      >
                        <Star className="w-4 h-4" fill={correction.isCanonical ? 'currentColor' : 'none'} />
                      </button>
                      <button
                        onClick={() => handleDelete(correction.id)}
                        className="p-1.5 text-gray-500 hover:text-red-400 hover:bg-gray-700 rounded-lg transition-colors"
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {total > limit && (
        <div className="flex items-center justify-between">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="px-4 py-2 text-sm text-gray-400 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Previous
          </button>
          <span className="text-sm text-gray-400">
            Page {page + 1} of {Math.ceil(total / limit)}
          </span>
          <button
            onClick={() => setPage((p) => p + 1)}
            disabled={(page + 1) * limit >= total}
            className="px-4 py-2 text-sm text-gray-400 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Helpers
// ============================================================================

function formatErrorPattern(pattern: string): string {
  const labels: Record<string, string> = {
    digit_1_6: '1↔6',
    digit_1_7: '1↔7',
    digit_2_3: '2↔3',
    digit_6_8: '6↔8',
    digit_8_0: '8↔0',
    digit_9_4: '9↔4',
    missed_decimal: 'Missed decimal',
    extra_decimal: 'Extra decimal',
    ssid_not_serial: 'SSID ≠ Serial',
    part_number_not_serial: 'P/N ≠ Serial',
    mac_not_serial: 'MAC ≠ Serial',
    gauge_reversed: 'Gauge reversed',
    trip_not_odometer: 'Trip ≠ ODO',
    wrong_line_item: 'Wrong line',
  };
  return labels[pattern] || pattern;
}

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { ArrowLeft, RefreshCw, ChevronRight, ChevronDown, Zap, TrendingUp } from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { useAuth } from '@/contexts/AuthContext';
import { Permission } from '@/types/auth.types';
import type { WeeklyActivationsResponse, WeekRow } from '../api/reports/weekly-activations';

const REVENUE_PER_ACTIVATION = 3105;

function formatRevenue(amount: number): string {
  return `R ${amount.toLocaleString('en-ZA', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

export default function WeeklyActivationsPage() {
  const router = useRouter();
  const { hasPermission } = useAuth();
  const [data, setData] = useState<WeeklyActivationsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/reports/weekly-activations');
      if (!res.ok) throw new Error(`API error: ${res.status}`);
      const json = await res.json() as { data: WeeklyActivationsResponse };
      setData(json.data);
      setLastRefresh(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!hasPermission(Permission.ANALYTICS_READ)) {
      router.replace('/dashboard');
      return;
    }
    fetchData();
  }, [fetchData, hasPermission, router]);

  const toggleWeek = (weekStart: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(weekStart)) {
        next.delete(weekStart);
      } else {
        next.add(weekStart);
      }
      return next;
    });
  };

  const allTimeTotal = data?.weeks.reduce((sum: number, w: WeekRow) => sum + w.total, 0) ?? 0;
  const allTimeRevenue = allTimeTotal * REVENUE_PER_ACTIVATION;
  const currentWeek = data?.weeks[0] ?? null;
  const currentWeekRevenue = (currentWeek?.total ?? 0) * REVENUE_PER_ACTIVATION;

  return (
    <AppLayout>
      <Head>
        <title>Weekly Activations | FibreFlow</title>
      </Head>

      <div className="ff-page-container">
        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push('/dashboard')}
              className="p-2 rounded-lg hover:bg-[var(--ff-bg-tertiary)] transition-colors text-[var(--ff-text-secondary)]"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">Weekly Activations</h1>
              <p className="text-sm text-[var(--ff-text-secondary)]">OES activations grouped by ISO week · Revenue @ R3,105/activation</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {lastRefresh && (
              <span className="text-xs text-[var(--ff-text-tertiary)]">
                Updated {lastRefresh.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
            <button
              onClick={fetchData}
              disabled={loading}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] hover:bg-[var(--ff-bg-tertiary)] transition-colors text-sm text-[var(--ff-text-primary)] disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </div>

        {/* Error state */}
        {error && (
          <div className="mb-6 p-4 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm">
            {error}
          </div>
        )}

        {/* Summary bar */}
        <div className="mb-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Current week WTD */}
          <div className="p-4 rounded-lg bg-[var(--ff-bg-secondary)] border border-emerald-500/40 relative overflow-hidden">
            <div className="absolute top-2 right-2 text-[10px] font-semibold uppercase tracking-widest text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full">WTD</div>
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-emerald-500/20">
                <Zap className="w-5 h-5 text-emerald-400" />
              </div>
              <div>
                <p className="text-sm text-[var(--ff-text-secondary)]">This Week</p>
                <p className="text-2xl font-bold text-[var(--ff-text-primary)]">
                  {loading ? (
                    <span className="inline-block w-16 h-8 bg-[var(--ff-bg-tertiary)] rounded animate-pulse" />
                  ) : (
                    (currentWeek?.total ?? 0).toLocaleString()
                  )}
                </p>
                {!loading && currentWeek && (
                  <p className="text-xs text-[var(--ff-text-tertiary)] mt-0.5">{currentWeek.week_label}</p>
                )}
              </div>
            </div>
          </div>
          {/* Current week revenue WTD */}
          <div className="p-4 rounded-lg bg-[var(--ff-bg-secondary)] border border-blue-500/40 relative overflow-hidden">
            <div className="absolute top-2 right-2 text-[10px] font-semibold uppercase tracking-widest text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded-full">WTD</div>
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-500/20">
                <TrendingUp className="w-5 h-5 text-blue-400" />
              </div>
              <div>
                <p className="text-sm text-[var(--ff-text-secondary)]">This Week Revenue</p>
                <p className="text-2xl font-bold text-[var(--ff-text-primary)]">
                  {loading ? (
                    <span className="inline-block w-28 h-8 bg-[var(--ff-bg-tertiary)] rounded animate-pulse" />
                  ) : (
                    formatRevenue(currentWeekRevenue)
                  )}
                </p>
              </div>
            </div>
          </div>
          {/* All-time activations */}
          <div className="p-4 rounded-lg bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)]">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-emerald-500/10">
                <Zap className="w-5 h-5 text-[var(--ff-text-tertiary)]" />
              </div>
              <div>
                <p className="text-sm text-[var(--ff-text-secondary)]">All-time Activations</p>
                <p className="text-2xl font-bold text-[var(--ff-text-primary)]">
                  {loading ? (
                    <span className="inline-block w-24 h-8 bg-[var(--ff-bg-tertiary)] rounded animate-pulse" />
                  ) : (
                    allTimeTotal.toLocaleString()
                  )}
                </p>
              </div>
            </div>
          </div>
          {/* All-time revenue */}
          <div className="p-4 rounded-lg bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)]">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-500/10">
                <TrendingUp className="w-5 h-5 text-[var(--ff-text-tertiary)]" />
              </div>
              <div>
                <p className="text-sm text-[var(--ff-text-secondary)]">All-time Revenue</p>
                <p className="text-2xl font-bold text-[var(--ff-text-primary)]">
                  {loading ? (
                    <span className="inline-block w-36 h-8 bg-[var(--ff-bg-tertiary)] rounded animate-pulse" />
                  ) : (
                    formatRevenue(allTimeRevenue)
                  )}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Loading skeleton */}
        {loading && (
          <div className="rounded-lg border border-[var(--ff-border-light)] overflow-hidden">
            {[...Array(5)].map((_, i) => (
              <div
                key={i}
                className="flex items-center gap-4 px-4 py-4 border-b border-[var(--ff-border-light)] last:border-b-0"
              >
                <div className="w-4 h-4 bg-[var(--ff-bg-tertiary)] rounded animate-pulse" />
                <div className="flex-1 h-4 bg-[var(--ff-bg-tertiary)] rounded animate-pulse" />
                <div className="w-20 h-4 bg-[var(--ff-bg-tertiary)] rounded animate-pulse" />
                <div className="w-28 h-4 bg-[var(--ff-bg-tertiary)] rounded animate-pulse" />
                <div className="w-16 h-4 bg-[var(--ff-bg-tertiary)] rounded animate-pulse" />
              </div>
            ))}
          </div>
        )}

        {/* Empty state */}
        {!loading && data && data.weeks.length === 0 && (
          <div className="rounded-lg border border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)] p-12 text-center">
            <Zap className="w-10 h-10 text-[var(--ff-text-tertiary)] mx-auto mb-3" />
            <p className="text-sm text-[var(--ff-text-secondary)]">No activation data found</p>
            <p className="text-xs text-[var(--ff-text-tertiary)] mt-1">
              Activations from active projects will appear here once imported
            </p>
          </div>
        )}

        {/* Collapsible table */}
        {!loading && data && data.weeks.length > 0 && (
          <div className="rounded-lg border border-[var(--ff-border-light)] overflow-hidden">
            {/* Table header */}
            <div className="grid grid-cols-[2rem_1fr_8rem_12rem_10rem] gap-2 px-4 py-2 bg-[var(--ff-bg-secondary)] border-b border-[var(--ff-border-light)]">
              <div />
              <span className="text-xs font-medium text-[var(--ff-text-tertiary)] uppercase tracking-wide">Week</span>
              <span className="text-xs font-medium text-[var(--ff-text-tertiary)] uppercase tracking-wide text-right">Activations</span>
              <span className="text-xs font-medium text-[var(--ff-text-tertiary)] uppercase tracking-wide text-right">Revenue Estimate</span>
              <span className="text-xs font-medium text-[var(--ff-text-tertiary)] uppercase tracking-wide text-right">Projects</span>
            </div>

            {data.weeks.map((week: WeekRow, idx: number) => {
              const isExpanded = expanded.has(week.week_start);
              const weekRevenue = week.total * REVENUE_PER_ACTIVATION;
              return (
                <div key={week.week_start}>
                  {/* Week row */}
                  <button
                    onClick={() => toggleWeek(week.week_start)}
                    className={`w-full grid grid-cols-[2rem_1fr_8rem_12rem_10rem] gap-2 px-4 py-3 text-left hover:bg-[var(--ff-bg-tertiary)] transition-colors ${
                      idx > 0 ? 'border-t border-[var(--ff-border-light)]' : ''
                    }`}
                  >
                    <div className="flex items-center">
                      {isExpanded ? (
                        <ChevronDown className="w-4 h-4 text-[var(--ff-text-tertiary)]" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-[var(--ff-text-tertiary)]" />
                      )}
                    </div>
                    <span className="text-sm font-medium text-[var(--ff-text-primary)]">
                      {week.week_label}
                    </span>
                    <span className="text-sm font-semibold text-emerald-400 text-right">
                      {week.total.toLocaleString()}
                    </span>
                    <span className="text-sm font-semibold text-blue-400 text-right">
                      {formatRevenue(weekRevenue)}
                    </span>
                    <span className="text-xs text-[var(--ff-text-tertiary)] text-right self-center">
                      {isExpanded ? '▾' : '▸'} {week.projects.length} project{week.projects.length !== 1 ? 's' : ''}
                    </span>
                  </button>

                  {/* Project sub-rows */}
                  {isExpanded && (
                    <div className="bg-[var(--ff-surface-primary,var(--ff-bg-secondary))] border-t border-[var(--ff-border-light)]">
                      {week.projects.map((project: WeekRow['projects'][number], pIdx: number) => {
                        const projectRevenue = project.count * REVENUE_PER_ACTIVATION;
                        return (
                          <div
                            key={project.project_id}
                            className={`grid grid-cols-[2rem_1fr_8rem_12rem_10rem] gap-2 px-4 py-2.5 ${
                              pIdx < week.projects.length - 1 ? 'border-b border-[var(--ff-border-light)]/50' : ''
                            }`}
                          >
                            <div />
                            <span className="text-sm text-[var(--ff-text-secondary)] pl-4">
                              — {project.project_name}
                            </span>
                            <span className="text-sm text-[var(--ff-text-primary)] text-right font-medium">
                              {project.count.toLocaleString()}
                            </span>
                            <span className="text-sm text-[var(--ff-text-secondary)] text-right">
                              {formatRevenue(projectRevenue)}
                            </span>
                            <div />
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}

            {/* All-time total footer row */}
            <div className="grid grid-cols-[2rem_1fr_8rem_12rem_10rem] gap-2 px-4 py-3 border-t-2 border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)]">
              <div />
              <span className="text-sm font-semibold text-[var(--ff-text-primary)]">All time total</span>
              <span className="text-sm font-bold text-emerald-400 text-right">
                {allTimeTotal.toLocaleString()}
              </span>
              <span className="text-sm font-bold text-blue-400 text-right">
                {formatRevenue(allTimeRevenue)}
              </span>
              <div />
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}

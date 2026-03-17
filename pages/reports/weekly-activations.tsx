import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { ArrowLeft, RefreshCw, ChevronRight, ChevronDown, Zap, TrendingUp, Filter, X } from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { useAuth } from '@/contexts/AuthContext';
import { Permission } from '@/types/auth.types';
import type { WeeklyActivationsResponse, WeekRow } from '../api/reports/weekly-activations';

const REVENUE_PER_ACTIVATION = 3105;

function formatRevenue(amount: number): string {
  return `R ${amount.toLocaleString('en-ZA', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

// ── Grouping helpers ──────────────────────────────────────────────────────────

interface MonthGroup {
  key: string;          // e.g. "2026-03"
  label: string;        // e.g. "March 2026"
  total: number;
  weeks: WeekRow[];
}

interface YearGroup {
  year: number;
  total: number;
  months: MonthGroup[];
}

function groupWeeks(weeks: WeekRow[]): YearGroup[] {
  const yearMap = new Map<number, Map<string, MonthGroup>>();

  for (const week of weeks) {
    const date = new Date(week.week_start + 'T00:00:00');
    const year = date.getFullYear();
    const monthKey = `${year}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    const monthLabel = date.toLocaleString('en-ZA', { month: 'long', year: 'numeric' });

    if (!yearMap.has(year)) yearMap.set(year, new Map());
    const months = yearMap.get(year)!;

    if (!months.has(monthKey)) {
      months.set(monthKey, { key: monthKey, label: monthLabel, total: 0, weeks: [] });
    }
    const m = months.get(monthKey)!;
    m.total += week.total;
    m.weeks.push(week);
  }

  return Array.from(yearMap.entries())
    .sort(([a], [b]) => b - a)
    .map(([year, months]) => ({
      year,
      total: Array.from(months.values()).reduce((s, m) => s + m.total, 0),
      months: Array.from(months.values()).sort((a, b) => b.key.localeCompare(a.key)),
    }));
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ActivationsPage() {
  const router = useRouter();
  const { hasPermission } = useAuth();
  const [data, setData] = useState<WeeklyActivationsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const [projectFilter, setProjectFilter] = useState<string>('');

  // Three independent expand sets
  const [expandedYears, setExpandedYears] = useState<Set<number>>(new Set());
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(new Set());
  const [expandedWeeks, setExpandedWeeks] = useState<Set<string>>(new Set());

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

  // Auto-expand current year + current month on load
  useEffect(() => {
    if (!data?.weeks.length) return;
    const now = new Date();
    const year = now.getFullYear();
    const monthKey = `${year}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    setExpandedYears(new Set([year]));
    setExpandedMonths(new Set([monthKey]));
  }, [data]);

  const toggle = <T,>(set: Set<T>, key: T): Set<T> => {
    const next = new Set(set);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  };

  // Unique projects across all weeks (for filter dropdown)
  const allProjects = useMemo(() => {
    const map = new Map<string, string>();
    for (const week of data?.weeks ?? []) {
      for (const p of week.projects) {
        map.set(p.project_id, p.project_name);
      }
    }
    return Array.from(map.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [data]);

  // Apply project filter to weeks (recalculate per-week totals for filtered view)
  const filteredWeeks = useMemo(() => {
    const weeks = data?.weeks ?? [];
    if (!projectFilter) return weeks;
    return weeks
      .map(week => {
        const projects = week.projects.filter(p => p.project_id === projectFilter);
        const total = projects.reduce((s, p) => s + p.count, 0);
        return { ...week, total, projects };
      })
      .filter(week => week.total > 0);
  }, [data, projectFilter]);

  const grouped = useMemo(() => groupWeeks(filteredWeeks), [filteredWeeks]);

  const allTimeTotal = filteredWeeks.reduce((s, w) => s + w.total, 0);
  const allTimeRevenue = allTimeTotal * REVENUE_PER_ACTIVATION;
  const currentWeek = filteredWeeks[0] ?? null;
  const currentWeekRevenue = (currentWeek?.total ?? 0) * REVENUE_PER_ACTIVATION;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <AppLayout>
      <Head>
        <title>Activations | FibreFlow</title>
      </Head>

      <div className="ff-page-container">
        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push('/dashboard')}
              aria-label="Back to dashboard"
              className="p-2 rounded-lg hover:bg-[var(--ff-bg-tertiary)] transition-colors text-[var(--ff-text-secondary)]"
            >
              <ArrowLeft className="w-5 h-5" aria-hidden="true" />
            </button>
            <div>
              <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">Activations</h1>
              <p className="text-sm text-[var(--ff-text-secondary)]">OES activations by project · Revenue @ R3,105/activation</p>
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
              aria-label="Refresh activations data"
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] hover:bg-[var(--ff-bg-tertiary)] transition-colors text-sm text-[var(--ff-text-primary)] disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
              Refresh
            </button>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-6 p-4 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm">
            {error}
          </div>
        )}

        {/* Summary bar — 4 cards */}
        <div className="mb-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="p-4 rounded-lg bg-[var(--ff-bg-secondary)] border border-emerald-500/40 relative overflow-hidden">
            <div className="absolute top-2 right-2 text-[10px] font-semibold uppercase tracking-widest text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full">WTD</div>
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-emerald-500/20">
                <Zap className="w-5 h-5 text-emerald-400" aria-hidden="true" />
              </div>
              <div>
                <p className="text-sm text-[var(--ff-text-secondary)]">This Week</p>
                <p className="text-2xl font-bold text-[var(--ff-text-primary)]">
                  {loading ? <span className="inline-block w-16 h-8 bg-[var(--ff-bg-tertiary)] rounded animate-pulse" /> : (currentWeek?.total ?? 0).toLocaleString()}
                </p>
                {!loading && currentWeek && (
                  <p className="text-xs text-[var(--ff-text-tertiary)] mt-0.5">{currentWeek.week_label}</p>
                )}
              </div>
            </div>
          </div>

          <div className="p-4 rounded-lg bg-[var(--ff-bg-secondary)] border border-blue-500/40 relative overflow-hidden">
            <div className="absolute top-2 right-2 text-[10px] font-semibold uppercase tracking-widest text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded-full">WTD</div>
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-500/20">
                <TrendingUp className="w-5 h-5 text-blue-400" aria-hidden="true" />
              </div>
              <div>
                <p className="text-sm text-[var(--ff-text-secondary)]">This Week Revenue</p>
                <p className="text-2xl font-bold text-[var(--ff-text-primary)]">
                  {loading ? <span className="inline-block w-28 h-8 bg-[var(--ff-bg-tertiary)] rounded animate-pulse" /> : formatRevenue(currentWeekRevenue)}
                </p>
              </div>
            </div>
          </div>

          <div className="p-4 rounded-lg bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)]">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-emerald-500/10">
                <Zap className="w-5 h-5 text-[var(--ff-text-tertiary)]" aria-hidden="true" />
              </div>
              <div>
                <p className="text-sm text-[var(--ff-text-secondary)]">All-time Activations</p>
                <p className="text-2xl font-bold text-[var(--ff-text-primary)]">
                  {loading ? <span className="inline-block w-24 h-8 bg-[var(--ff-bg-tertiary)] rounded animate-pulse" /> : allTimeTotal.toLocaleString()}
                </p>
              </div>
            </div>
          </div>

          <div className="p-4 rounded-lg bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)]">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-500/10">
                <TrendingUp className="w-5 h-5 text-[var(--ff-text-tertiary)]" />
              </div>
              <div>
                <p className="text-sm text-[var(--ff-text-secondary)]">All-time Revenue</p>
                <p className="text-2xl font-bold text-[var(--ff-text-primary)]">
                  {loading ? <span className="inline-block w-36 h-8 bg-[var(--ff-bg-tertiary)] rounded animate-pulse" /> : formatRevenue(allTimeRevenue)}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Filter bar */}
        <div className="mb-4 flex flex-wrap items-center gap-3 p-3 rounded-lg bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)]">
          <div className="flex items-center gap-2 text-xs font-medium text-[var(--ff-text-tertiary)] uppercase tracking-wide">
            <Filter className="w-3.5 h-3.5" aria-hidden="true" />
            Filters
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-[var(--ff-text-secondary)]">Project</label>
            <div className="relative">
              <select
                value={projectFilter}
                onChange={e => setProjectFilter(e.target.value)}
                className="appearance-none pl-3 pr-8 py-1.5 rounded-md text-sm bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] text-[var(--ff-text-primary)] focus:outline-none focus:ring-1 focus:ring-emerald-500/50 cursor-pointer"
              >
                <option value="">All projects</option>
                {allProjects.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--ff-text-tertiary)] pointer-events-none" aria-hidden="true" />
            </div>
            {projectFilter && (
              <button
                onClick={() => setProjectFilter('')}
                className="flex items-center gap-1 px-2 py-1 rounded-md text-xs text-rose-400 hover:bg-rose-500/10 transition-colors"
              >
                <X className="w-3 h-3" /> Clear
              </button>
            )}
          </div>
          {projectFilter && (
            <span className="ml-auto text-xs text-[var(--ff-text-tertiary)]">
              Showing {filteredWeeks.length} week{filteredWeeks.length !== 1 ? 's' : ''} with activations
            </span>
          )}
        </div>

        {/* Loading skeleton */}
        {loading && (
          <div role="status" aria-live="polite" aria-label="Loading activations data" className="rounded-lg border border-[var(--ff-border-light)] overflow-hidden">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-4 border-b border-[var(--ff-border-light)] last:border-b-0">
                <div className="w-4 h-4 bg-[var(--ff-bg-tertiary)] rounded animate-pulse" />
                <div className="flex-1 h-4 bg-[var(--ff-bg-tertiary)] rounded animate-pulse" />
                <div className="w-20 h-4 bg-[var(--ff-bg-tertiary)] rounded animate-pulse" />
                <div className="w-28 h-4 bg-[var(--ff-bg-tertiary)] rounded animate-pulse" />
              </div>
            ))}
          </div>
        )}

        {/* Empty state */}
        {!loading && (!data || data.weeks.length === 0) && (
          <div className="rounded-lg border border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)] p-12 text-center">
            <Zap className="w-10 h-10 text-[var(--ff-text-tertiary)] mx-auto mb-3" />
            <p className="text-sm text-[var(--ff-text-secondary)]">No activation data found</p>
            <p className="text-xs text-[var(--ff-text-tertiary)] mt-1">Activations from active projects will appear here once imported</p>
          </div>
        )}

        {/* ── Tiered table: Year → Month → Week → Projects ── */}
        {!loading && grouped.length > 0 && (
          <div className="rounded-lg border border-[var(--ff-border-light)] overflow-hidden">

            {/* Column headers */}
            <div className="grid grid-cols-[2rem_1fr_9rem_13rem] gap-2 px-4 py-2 bg-[var(--ff-bg-secondary)] border-b border-[var(--ff-border-light)]">
              <div />
              <span className="text-xs font-medium text-[var(--ff-text-tertiary)] uppercase tracking-wide">Period</span>
              <span className="text-xs font-medium text-[var(--ff-text-tertiary)] uppercase tracking-wide text-right">Activations</span>
              <span className="text-xs font-medium text-[var(--ff-text-tertiary)] uppercase tracking-wide text-right">Revenue Estimate</span>
            </div>

            {grouped.map((yearGroup, yi) => {
              const yearExpanded = expandedYears.has(yearGroup.year);
              return (
                <div key={yearGroup.year} className={yi > 0 ? 'border-t border-[var(--ff-border-light)]' : ''}>

                  {/* ── Year row ── */}
                  <button
                    onClick={() => setExpandedYears(toggle(expandedYears, yearGroup.year))}
                    aria-expanded={yearExpanded}
                    aria-label={`${yearGroup.year} activations`}
                    className="w-full grid grid-cols-[2rem_1fr_9rem_13rem] gap-2 px-4 py-3 text-left hover:bg-[var(--ff-bg-tertiary)] transition-colors bg-[var(--ff-bg-secondary)]"
                  >
                    <div className="flex items-center">
                      {yearExpanded
                        ? <ChevronDown className="w-4 h-4 text-emerald-400" aria-hidden="true" />
                        : <ChevronRight className="w-4 h-4 text-emerald-400" aria-hidden="true" />}
                    </div>
                    <span className="text-sm font-bold text-[var(--ff-text-primary)]">{yearGroup.year}</span>
                    <span className="text-sm font-bold text-emerald-400 text-right">{yearGroup.total.toLocaleString()}</span>
                    <span className="text-sm font-bold text-blue-400 text-right">{formatRevenue(yearGroup.total * REVENUE_PER_ACTIVATION)}</span>
                  </button>

                  {yearExpanded && yearGroup.months.map((monthGroup, mi) => {
                    const monthExpanded = expandedMonths.has(monthGroup.key);
                    return (
                      <div key={monthGroup.key} className={mi > 0 ? 'border-t border-[var(--ff-border-light)]/60' : 'border-t border-[var(--ff-border-light)]/60'}>

                        {/* ── Month row ── */}
                        <button
                          onClick={() => setExpandedMonths(toggle(expandedMonths, monthGroup.key))}
                          aria-expanded={monthExpanded}
                          aria-label={`${monthGroup.label} activations`}
                          className="w-full grid grid-cols-[2rem_1fr_9rem_13rem] gap-2 px-4 py-2.5 text-left hover:bg-[var(--ff-bg-tertiary)] transition-colors"
                        >
                          <div className="flex items-center pl-4">
                            {monthExpanded
                              ? <ChevronDown className="w-3.5 h-3.5 text-[var(--ff-text-secondary)]" aria-hidden="true" />
                              : <ChevronRight className="w-3.5 h-3.5 text-[var(--ff-text-secondary)]" aria-hidden="true" />}
                          </div>
                          <span className="text-sm font-semibold text-[var(--ff-text-primary)] pl-1">{monthGroup.label}</span>
                          <span className="text-sm font-semibold text-emerald-400 text-right">{monthGroup.total.toLocaleString()}</span>
                          <span className="text-sm font-semibold text-blue-400 text-right">{formatRevenue(monthGroup.total * REVENUE_PER_ACTIVATION)}</span>
                        </button>

                        {monthExpanded && monthGroup.weeks.map((week, wi) => {
                          const weekExpanded = expandedWeeks.has(week.week_start);
                          return (
                            <div key={week.week_start} className={wi > 0 ? 'border-t border-[var(--ff-border-light)]/40' : 'border-t border-[var(--ff-border-light)]/40'}>

                              {/* ── Week row ── */}
                              <button
                                onClick={() => setExpandedWeeks(toggle(expandedWeeks, week.week_start))}
                                aria-expanded={weekExpanded}
                                aria-label={`${week.week_label} activations`}
                                className="w-full grid grid-cols-[2rem_1fr_9rem_13rem] gap-2 px-4 py-2 text-left hover:bg-[var(--ff-bg-tertiary)] transition-colors"
                              >
                                <div className="flex items-center pl-8">
                                  {weekExpanded
                                    ? <ChevronDown className="w-3 h-3 text-[var(--ff-text-tertiary)]" aria-hidden="true" />
                                    : <ChevronRight className="w-3 h-3 text-[var(--ff-text-tertiary)]" aria-hidden="true" />}
                                </div>
                                <span className="text-sm text-[var(--ff-text-primary)] pl-1">{week.week_label}</span>
                                <span className="text-sm text-emerald-400 text-right">{week.total.toLocaleString()}</span>
                                <span className="text-sm text-blue-400 text-right">{formatRevenue(week.total * REVENUE_PER_ACTIVATION)}</span>
                              </button>

                              {/* ── Project rows ── */}
                              {weekExpanded && week.projects.map((project, pi) => (
                                <div
                                  key={project.project_id}
                                  className={`grid grid-cols-[2rem_1fr_9rem_13rem] gap-2 px-4 py-1.5 bg-[var(--ff-bg-secondary)] ${
                                    pi < week.projects.length - 1 ? 'border-b border-[var(--ff-border-light)]/30' : ''
                                  }`}
                                >
                                  <div />
                                  <span className="text-xs text-[var(--ff-text-secondary)] pl-14">— {project.project_name}</span>
                                  <span className="text-xs text-[var(--ff-text-primary)] text-right font-medium">{project.count.toLocaleString()}</span>
                                  <span className="text-xs text-[var(--ff-text-secondary)] text-right">{formatRevenue(project.count * REVENUE_PER_ACTIVATION)}</span>
                                </div>
                              ))}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              );
            })}

            {/* All-time footer */}
            <div className="grid grid-cols-[2rem_1fr_9rem_13rem] gap-2 px-4 py-3 border-t-2 border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)]">
              <div />
              <span className="text-sm font-semibold text-[var(--ff-text-primary)]">All time total</span>
              <span className="text-sm font-bold text-emerald-400 text-right">{allTimeTotal.toLocaleString()}</span>
              <span className="text-sm font-bold text-blue-400 text-right">{formatRevenue(allTimeRevenue)}</span>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}

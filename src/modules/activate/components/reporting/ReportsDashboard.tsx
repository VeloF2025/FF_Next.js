/**
 * ReportsDashboard - Main container for comprehensive reporting suite
 *
 * Purpose: Unified dashboard with 4 report categories
 * - Anomalies: WA-only, OES-only, serial mismatches, resubmissions
 * - Trends: Daily/weekly charts, completion velocity
 * - Team: Technician leaderboard, team comparison, compliance
 * - QA Funnel: Photo completion, VLM rates, cycle times
 *
 * Status: WORKING - Main dashboard container
 * NLNH Confidence: HIGH
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  AlertTriangle,
  TrendingUp,
  Users,
  Filter as FilterIcon,
  Calendar,
  RefreshCw,
  Download,
  WifiOff,
  Repeat,
  FileWarning,
  CircleDollarSign,
  Target,
  Clock,
  Gauge,
} from 'lucide-react';
import toast from 'react-hot-toast';
import type { ReportCategory, ReportFilters } from '../../types/reporting.types';
import { useActivateData, getTodaySAST, getYesterdaySAST } from '../../context';

// Import report sections
import { AnomalyReports } from './AnomalyReports';
import { TrendReports } from './TrendReports';
import { TeamReports } from './TeamReports';
import { FunnelReports } from './FunnelReports';
import { OfflineDevicesReports } from './OfflineDevicesReports';
import { SerialSwapReports } from './SerialSwapReports';
import { SerialMismatchReports } from './SerialMismatchReports';
import { InstallationGapsReports } from './InstallationGapsReports';
import { ActivationProgressReport } from './ActivationProgressReport';
import { MaturityTrackingReport } from './MaturityTrackingReport';
import { PenetrationCurveReport } from './PenetrationCurveReport';
import { UptakeReport } from './UptakeReport';
import { Button } from '@/components/ui/button';

interface CategoryTab {
  id: ReportCategory;
  label: string;
  icon: typeof AlertTriangle;
  description: string;
}

const categories: CategoryTab[] = [
  {
    id: 'anomalies',
    label: 'Anomalies',
    icon: AlertTriangle,
    description: 'WA-only, OES-only, serial mismatches, resubmissions',
  },
  {
    id: 'trends',
    label: 'Trends',
    icon: TrendingUp,
    description: 'Daily/weekly charts, completion velocity',
  },
  {
    id: 'team',
    label: 'Team Performance',
    icon: Users,
    description: 'Technician rankings, compliance rates',
  },
  {
    id: 'funnel',
    label: 'QA Funnel',
    icon: FilterIcon,
    description: 'Photo completion, VLM rates, cycle times',
  },
  {
    id: 'offline',
    label: 'Offline Devices',
    icon: WifiOff,
    description: 'Offline device tracking, serial validation, match status',
  },
  {
    id: 'swaps',
    label: 'Serial Swaps',
    icon: Repeat,
    description: 'ONT/UPS serials in wrong 1Map fields - pending correction',
  },
  {
    id: 'mismatches',
    label: 'Serial Mismatches',
    icon: FileWarning,
    description: 'Installation serial differs from activation serial - potential replacement or theft',
  },
  {
    id: 'gaps',
    label: 'Installation Gaps',
    icon: CircleDollarSign,
    description: 'Installed but not activated - money spent, work done, never went live',
  },
  {
    id: 'progress',
    label: 'Activation Progress',
    icon: Target,
    description: 'Track activation progress by Project > Zone > PON against total scope',
  },
  {
    id: 'maturity',
    label: 'Maturity Tracking',
    icon: Clock,
    description: 'Time from first installation to maturity - milestones, velocity, projections',
  },
  {
    id: 'penetration',
    label: 'Penetration Curve',
    icon: TrendingUp,
    description: 'Penetration % over time — drill down Project → Zone → PON',
  },
  {
    id: 'uptake',
    label: 'Uptake',
    icon: Gauge,
    description: 'Per-PON activation % against target — downloadable as dark-themed PDF',
  },
];

// Helper to format date as YYYY-MM-DD without timezone issues
function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function ReportsDashboard() {
  // Get shared filters from context
  const { filters: sharedFilters, projects } = useActivateData();

  // Active category
  const [activeCategory, setActiveCategory] = useState<ReportCategory>('anomalies');

  // Local filters
  const [filters, setFilters] = useState<ReportFilters>({
    dateFrom: getYesterdaySAST(), // Default to yesterday for reports
    dateTo: getTodaySAST(),
    project: sharedFilters.projectFilter !== 'all' ? sharedFilters.projectFilter : undefined,
  });

  // UI state
  const [isLoading, setIsLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  // Sync project filter from context
  useEffect(() => {
    setFilters((prev) => ({
      ...prev,
      project: sharedFilters.projectFilter !== 'all' ? sharedFilters.projectFilter : undefined,
    }));
  }, [sharedFilters.projectFilter]);

  // NOTE: Removed auto-refresh on lastRefreshAt change to prevent visual re-renders.
  // Reports now only refresh when user clicks "Refresh" button or changes filters.
  // The Dashboard tab still auto-refreshes via ActivateDataContext.

  // Quick filter handlers
  type QuickFilterType = 'today' | 'yesterday' | 'thisWeek' | 'lastWeek' | 'thisMonth' | 'last7days' | 'last30days' | 'all';

  const handleQuickFilter = (filter: QuickFilterType) => {
    const todayStr = getTodaySAST();
    const today = new Date(todayStr);

    switch (filter) {
      case 'today':
        setFilters({ ...filters, dateFrom: todayStr, dateTo: todayStr });
        break;
      case 'yesterday': {
        const yesterdayStr = getYesterdaySAST();
        setFilters({ ...filters, dateFrom: yesterdayStr, dateTo: yesterdayStr });
        break;
      }
      case 'thisWeek': {
        // Start of current week (Monday)
        const startOfWeek = new Date(today);
        const day = startOfWeek.getDay();
        const diff = day === 0 ? -6 : 1 - day; // Monday as start
        startOfWeek.setDate(startOfWeek.getDate() + diff);
        setFilters({
          ...filters,
          dateFrom: formatLocalDate(startOfWeek),
          dateTo: todayStr,
        });
        break;
      }
      case 'lastWeek': {
        // Last week Monday to Sunday
        const startOfLastWeek = new Date(today);
        const day = startOfLastWeek.getDay();
        const diff = day === 0 ? -13 : -6 - day; // Previous Monday
        startOfLastWeek.setDate(startOfLastWeek.getDate() + diff);
        const endOfLastWeek = new Date(startOfLastWeek);
        endOfLastWeek.setDate(endOfLastWeek.getDate() + 6);
        setFilters({
          ...filters,
          dateFrom: formatLocalDate(startOfLastWeek),
          dateTo: formatLocalDate(endOfLastWeek),
        });
        break;
      }
      case 'thisMonth': {
        // First of current month to today
        const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
        setFilters({
          ...filters,
          dateFrom: formatLocalDate(startOfMonth),
          dateTo: todayStr,
        });
        break;
      }
      case 'last7days': {
        const last7 = new Date(today);
        last7.setDate(last7.getDate() - 7);
        setFilters({
          ...filters,
          dateFrom: formatLocalDate(last7),
          dateTo: todayStr,
        });
        break;
      }
      case 'last30days': {
        const last30 = new Date(today);
        last30.setDate(last30.getDate() - 30);
        setFilters({
          ...filters,
          dateFrom: formatLocalDate(last30),
          dateTo: todayStr,
        });
        break;
      }
      case 'all': {
        // Set to earliest possible date (2020-01-01) to today
        setFilters({
          ...filters,
          dateFrom: '2020-01-01',
          dateTo: todayStr,
        });
        break;
      }
    }
  };

  // Get active quick filter
  const getActiveQuickFilter = (): QuickFilterType | null => {
    const todayStr = getTodaySAST();
    const yesterdayStr = getYesterdaySAST();
    const today = new Date(todayStr);

    // Last 7 days
    const last7 = new Date(today);
    last7.setDate(last7.getDate() - 7);
    const last7Str = formatLocalDate(last7);

    // Last 30 days
    const last30 = new Date(today);
    last30.setDate(last30.getDate() - 30);
    const last30Str = formatLocalDate(last30);

    // This week (Monday to today)
    const startOfWeek = new Date(today);
    const day = startOfWeek.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    startOfWeek.setDate(startOfWeek.getDate() + diff);
    const thisWeekStr = formatLocalDate(startOfWeek);

    // Last week (Monday to Sunday)
    const startOfLastWeek = new Date(today);
    const dayLw = startOfLastWeek.getDay();
    const diffLw = dayLw === 0 ? -13 : -6 - dayLw;
    startOfLastWeek.setDate(startOfLastWeek.getDate() + diffLw);
    const endOfLastWeek = new Date(startOfLastWeek);
    endOfLastWeek.setDate(endOfLastWeek.getDate() + 6);
    const lastWeekStartStr = formatLocalDate(startOfLastWeek);
    const lastWeekEndStr = formatLocalDate(endOfLastWeek);

    // This month
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const thisMonthStr = formatLocalDate(startOfMonth);

    if (filters.dateFrom === todayStr && filters.dateTo === todayStr) return 'today';
    if (filters.dateFrom === yesterdayStr && filters.dateTo === yesterdayStr) return 'yesterday';
    if (filters.dateFrom === thisWeekStr && filters.dateTo === todayStr) return 'thisWeek';
    if (filters.dateFrom === lastWeekStartStr && filters.dateTo === lastWeekEndStr) return 'lastWeek';
    if (filters.dateFrom === thisMonthStr && filters.dateTo === todayStr) return 'thisMonth';
    if (filters.dateFrom === last7Str && filters.dateTo === todayStr) return 'last7days';
    if (filters.dateFrom === last30Str && filters.dateTo === todayStr) return 'last30days';
    if (filters.dateFrom === '2020-01-01' && filters.dateTo === todayStr) return 'all';

    return null;
  };

  // Handle refresh
  const handleRefresh = useCallback(() => {
    setIsLoading(true);
    setRefreshKey((k) => k + 1);
    // Let child components handle their own loading
    setTimeout(() => setIsLoading(false), 100);
  }, []);

  // Export filtered report data to Excel via /api/activate/export
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = useCallback(async () => {
    setIsExporting(true);
    try {
      const params = new URLSearchParams();
      if (filters.dateFrom) params.set('dateFrom', filters.dateFrom);
      if (filters.dateTo) params.set('dateTo', filters.dateTo);
      if (filters.project) params.set('project', filters.project);

      const response = await fetch(`/api/activate/export?${params.toString()}`);
      if (!response.ok) throw new Error('Export failed');

      const exportCount = response.headers.get('X-Export-Count') || '?';
      const parts: string[] = ['activate-reports'];
      if (filters.project) parts.push(filters.project.replace(/\s+/g, '-'));
      if (filters.dateFrom) parts.push(filters.dateFrom);
      if (filters.dateTo && filters.dateTo !== filters.dateFrom) parts.push(`to-${filters.dateTo}`);
      parts.push(`${exportCount}-records`);

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${parts.join('-')}.xlsx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      toast.success(`Exported ${exportCount} records`);
    } catch (err) {
      toast.error('Export failed. Please try again.');
    } finally {
      setIsExporting(false);
    }
  }, [filters]);

  return (
    <div className="space-y-6">
      {/* Category Navigation */}
      <div className="bg-card rounded-lg shadow-md dark:shadow-gray-900/50 p-4">
        <div className="flex flex-wrap gap-2">
          {categories.map((cat) => {
            const Icon = cat.icon;
            const isActive = activeCategory === cat.id;

            return (
              <button
                key={cat.id}
                onClick={() => setActiveCategory(cat.id)}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-lg font-medium text-sm transition-all ${
                  isActive
                    ? 'bg-blue-600 text-white shadow-md'
                    : 'bg-secondary text-muted-foreground hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
                title={cat.description}
              >
                <Icon className="h-4 w-4" />
                <span>{cat.label}</span>
              </button>
            );
          })}
        </div>

        {/* Category description */}
        <p className="mt-3 text-sm text-muted-foreground">
          {categories.find((c) => c.id === activeCategory)?.description}
        </p>
      </div>

      {/* Filters Bar - Sticky */}
      <div className="bg-card rounded-lg shadow-md dark:shadow-gray-900/50 p-4 sticky top-0 z-10">
        <div className="flex flex-wrap items-center gap-4">
          {/* Quick Filters */}
          <div className="flex flex-wrap gap-1.5">
            {(
              [
                { key: 'today', label: 'Today' },
                { key: 'yesterday', label: 'Yesterday' },
                { key: 'thisWeek', label: 'This Week' },
                { key: 'lastWeek', label: 'Last Week' },
                { key: 'thisMonth', label: 'This Month' },
                { key: 'last7days', label: '7 Days' },
                { key: 'last30days', label: '30 Days' },
                { key: 'all', label: 'All' },
              ] as const
            ).map(({ key, label }) => (
              <button
                key={key}
                onClick={() => handleQuickFilter(key)}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                  getActiveQuickFilter() === key
                    ? 'bg-blue-600 text-white'
                    : 'bg-secondary text-muted-foreground hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Date Range Inputs */}
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-gray-400" />
            <input
              type="date"
              value={filters.dateFrom}
              onChange={(e) => setFilters({ ...filters, dateFrom: e.target.value })}
              className="px-2 py-1.5 border border-border rounded text-sm bg-card text-foreground"
            />
            <span className="text-muted-foreground">to</span>
            <input
              type="date"
              value={filters.dateTo}
              onChange={(e) => setFilters({ ...filters, dateTo: e.target.value })}
              className="px-2 py-1.5 border border-border rounded text-sm bg-card text-foreground"
            />
          </div>

          {/* Project Filter */}
          <select
            value={filters.project || ''}
            onChange={(e) =>
              setFilters({
                ...filters,
                project: e.target.value || undefined,
              })
            }
            className="px-3 py-1.5 border border-border rounded text-sm bg-card text-foreground"
          >
            <option value="">All Projects</option>
            {projects.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>

          {/* Action Buttons */}
          <div className="flex gap-2 ml-auto">
            <Button
              variant="secondary"
              size="sm"
              onClick={handleRefresh}
              disabled={isLoading}
              loading={isLoading}
            >
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleExport}
              disabled={isExporting}
              loading={isExporting}
            >
              <Download className="h-4 w-4" />
              {isExporting ? 'Exporting...' : 'Export'}
            </Button>
          </div>
        </div>
      </div>

      {/* Report Content */}
      <div className="bg-card rounded-lg shadow-md dark:shadow-gray-900/50">
        {activeCategory === 'anomalies' && (
          <AnomalyReports filters={filters} refreshKey={refreshKey} />
        )}
        {activeCategory === 'trends' && (
          <TrendReports filters={filters} refreshKey={refreshKey} />
        )}
        {activeCategory === 'team' && (
          <TeamReports filters={filters} refreshKey={refreshKey} />
        )}
        {activeCategory === 'funnel' && (
          <FunnelReports filters={filters} refreshKey={refreshKey} />
        )}
        {activeCategory === 'offline' && (
          <OfflineDevicesReports filters={filters} refreshKey={refreshKey} />
        )}
        {activeCategory === 'swaps' && (
          <SerialSwapReports filters={filters} refreshKey={refreshKey} />
        )}
        {activeCategory === 'mismatches' && (
          <SerialMismatchReports filters={filters} refreshKey={refreshKey} />
        )}
        {activeCategory === 'gaps' && (
          <InstallationGapsReports filters={filters} refreshKey={refreshKey} />
        )}
        {activeCategory === 'progress' && (
          <ActivationProgressReport filters={filters} refreshKey={refreshKey} />
        )}
        {activeCategory === 'maturity' && (
          <MaturityTrackingReport
            projectId={filters.project}
          />
        )}
        {activeCategory === 'penetration' && (
          <PenetrationCurveReport filters={filters} refreshKey={refreshKey} />
        )}
        {activeCategory === 'uptake' && (
          <UptakeReport filters={filters} refreshKey={refreshKey} />
        )}
      </div>
    </div>
  );
}

export default ReportsDashboard;

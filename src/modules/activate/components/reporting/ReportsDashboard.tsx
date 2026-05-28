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
import { useActivateData, getTodaySAST } from '../../context';

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
import { ReportsFilterBar } from './ReportsFilterBar';

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

export function ReportsDashboard() {
  // Get shared filters from context
  const { filters: sharedFilters, projects } = useActivateData();

  // Active category
  const [activeCategory, setActiveCategory] = useState<ReportCategory>('anomalies');

  // Local filters — default chip is 'all' (matches the shared DateChipFilter
  // convention used across PP Data and the OLT tabs). ReportsFilterBar resolves
  // 'all' to 2020-01-01..today, so initialize with the same explicit range to
  // avoid a double-fetch on mount.
  const [filters, setFilters] = useState<ReportFilters>({
    dateFrom: '2020-01-01',
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

      <ReportsFilterBar
        filters={filters}
        onFiltersChange={setFilters}
        projects={projects}
        isLoading={isLoading}
        onRefresh={handleRefresh}
        isExporting={isExporting}
        onExport={handleExport}
      />

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

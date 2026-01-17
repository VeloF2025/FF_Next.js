/**
 * Reports Tab Component
 *
 * Main container for all reporting functionality in Activate
 * Provides sub-navigation between report types and shared filters
 *
 * Report Types:
 * - Daily Counts: Zone/PON breakdown by project
 * - Discrepancy: WhatsApp vs OES comparison
 * - Serial Validation: ONT/UPS serial matching
 * - User/Team Attribution: Performance metrics
 *
 * Uses shared context for filter synchronization with Dashboard tab
 */

'use client';

import { useState, useEffect, useContext } from 'react';
import {
  BarChart3,
  AlertTriangle,
  Hash,
  Users,
  Calendar,
  RefreshCw,
  Download,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import type {
  ReportType,
  ReportFilters,
  DailyCountsResponse,
  DiscrepancyReportResponse,
  SerialValidationReportResponse,
  UserTeamAttributionResponse,
  ProjectDailyCount,
  ZoneBreakdown,
} from '../../types/reporting.types';
import { useActivateData, getTodaySAST, getYesterdaySAST } from '../../context';

export function ReportsTab() {
  // Get shared filters from context
  const { filters: sharedFilters, lastRefreshAt } = useActivateData();

  // Active report type
  const [activeReport, setActiveReport] = useState<ReportType>('daily-counts');

  // Local filters - synced with shared context
  const [filters, setFilters] = useState<ReportFilters>({
    dateFrom: sharedFilters.dateFrom || getTodaySAST(),
    dateTo: sharedFilters.dateTo || getTodaySAST(),
    project: sharedFilters.projectFilter !== 'all' ? sharedFilters.projectFilter : undefined,
  });

  // Sync filters when shared context changes
  useEffect(() => {
    setFilters({
      dateFrom: sharedFilters.dateFrom || getTodaySAST(),
      dateTo: sharedFilters.dateTo || getTodaySAST(),
      project: sharedFilters.projectFilter !== 'all' ? sharedFilters.projectFilter : undefined,
    });
  }, [sharedFilters.dateFrom, sharedFilters.dateTo, sharedFilters.projectFilter]);

  // Loading and error states
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Report data states
  const [dailyCountsData, setDailyCountsData] =
    useState<DailyCountsResponse | null>(null);
  const [discrepancyData, setDiscrepancyData] =
    useState<DiscrepancyReportResponse | null>(null);
  const [serialData, setSerialData] =
    useState<SerialValidationReportResponse | null>(null);
  const [userTeamData, setUserTeamData] =
    useState<UserTeamAttributionResponse | null>(null);

  // Expanded state for accordions
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(
    new Set()
  );
  const [expandedZones, setExpandedZones] = useState<Set<string>>(new Set());

  // Track last refresh to trigger re-fetch on background refresh
  const [lastContextRefresh, setLastContextRefresh] = useState<Date | null>(null);

  // Trigger refetch when context does background refresh
  useEffect(() => {
    if (lastRefreshAt && lastContextRefresh && lastRefreshAt > lastContextRefresh) {
      // Background refresh happened, refetch report data silently
      fetchReportData(true);
    }
    setLastContextRefresh(lastRefreshAt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastRefreshAt]);

  // Fetch report data when filters or report type changes
  useEffect(() => {
    fetchReportData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeReport, filters]);

  const fetchReportData = async (silent = false) => {
    if (!silent) setIsLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      params.set('dateFrom', filters.dateFrom);
      params.set('dateTo', filters.dateTo);
      if (filters.project) params.set('project', filters.project);

      let endpoint = '';
      switch (activeReport) {
        case 'daily-counts':
          endpoint = `/api/activate/reporting/daily-counts?${params.toString()}`;
          break;
        case 'discrepancy':
          endpoint = `/api/activate/reporting/discrepancy?waDate=${filters.dateFrom}`;
          if (filters.project) endpoint += `&project=${filters.project}`;
          break;
        case 'serial-validation':
          endpoint = `/api/activate/reporting/serial-validation?${params.toString()}`;
          break;
        case 'user-attribution':
          endpoint = `/api/activate/reporting/user-attribution?${params.toString()}`;
          break;
      }

      const response = await fetch(endpoint);
      if (!response.ok) {
        throw new Error(`Failed to fetch ${activeReport} report`);
      }

      const data = await response.json();

      switch (activeReport) {
        case 'daily-counts':
          setDailyCountsData(data);
          break;
        case 'discrepancy':
          setDiscrepancyData(data);
          break;
        case 'serial-validation':
          setSerialData(data);
          break;
        case 'user-attribution':
          setUserTeamData(data);
          break;
      }
    } catch (err) {
      if (!silent) {
        setError(err instanceof Error ? err.message : 'Failed to fetch report');
      }
    } finally {
      if (!silent) setIsLoading(false);
    }
  };

  // Quick filter handlers
  const handleQuickFilter = (filter: 'today' | 'yesterday' | 'last7days') => {
    const todayStr = getTodaySAST();

    switch (filter) {
      case 'today':
        setFilters({ ...filters, dateFrom: todayStr, dateTo: todayStr });
        break;
      case 'yesterday': {
        const yesterdayStr = getYesterdaySAST();
        setFilters({ ...filters, dateFrom: yesterdayStr, dateTo: yesterdayStr });
        break;
      }
      case 'last7days': {
        const last7DaysDate = new Date(todayStr);
        last7DaysDate.setDate(last7DaysDate.getDate() - 7);
        const last7DaysStr = last7DaysDate.toISOString().split('T')[0] as string;
        setFilters({ ...filters, dateFrom: last7DaysStr, dateTo: todayStr });
        break;
      }
    }
  };

  // Toggle project expansion
  const toggleProject = (project: string) => {
    const newExpanded = new Set(expandedProjects);
    if (newExpanded.has(project)) {
      newExpanded.delete(project);
    } else {
      newExpanded.add(project);
    }
    setExpandedProjects(newExpanded);
  };

  // Toggle zone expansion
  const toggleZone = (projectZoneKey: string) => {
    const newExpanded = new Set(expandedZones);
    if (newExpanded.has(projectZoneKey)) {
      newExpanded.delete(projectZoneKey);
    } else {
      newExpanded.add(projectZoneKey);
    }
    setExpandedZones(newExpanded);
  };

  // Get active quick filter
  const getActiveQuickFilter = (): 'today' | 'yesterday' | 'last7days' | null => {
    const todayStr = getTodaySAST();
    const yesterdayStr = getYesterdaySAST();
    const last7DaysDate = new Date(todayStr);
    last7DaysDate.setDate(last7DaysDate.getDate() - 7);
    const last7DaysStr = last7DaysDate.toISOString().split('T')[0] as string;

    if (filters.dateFrom === todayStr && filters.dateTo === todayStr)
      return 'today';
    if (filters.dateFrom === yesterdayStr && filters.dateTo === yesterdayStr)
      return 'yesterday';
    if (filters.dateFrom === last7DaysStr && filters.dateTo === todayStr)
      return 'last7days';

    return null;
  };

  // Skeleton component
  const Skeleton = ({ className }: { className?: string }) => (
    <div
      className={`animate-pulse bg-gray-200 dark:bg-gray-700 rounded ${className || ''}`}
    />
  );

  return (
    <div className="space-y-6">
      {/* Report Type Navigation */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md dark:shadow-gray-900/50 p-4">
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setActiveReport('daily-counts')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm transition-colors ${
              activeReport === 'daily-counts'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
            }`}
          >
            <BarChart3 className="h-4 w-4" />
            Daily Counts
          </button>
          <button
            onClick={() => setActiveReport('discrepancy')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm transition-colors ${
              activeReport === 'discrepancy'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
            }`}
          >
            <AlertTriangle className="h-4 w-4" />
            Discrepancy
          </button>
          <button
            onClick={() => setActiveReport('serial-validation')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm transition-colors ${
              activeReport === 'serial-validation'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
            }`}
          >
            <Hash className="h-4 w-4" />
            Serial Validation
          </button>
          <button
            onClick={() => setActiveReport('user-attribution')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm transition-colors ${
              activeReport === 'user-attribution'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
            }`}
          >
            <Users className="h-4 w-4" />
            User/Team
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md dark:shadow-gray-900/50 p-4">
        <div className="flex flex-wrap items-center gap-4">
          {/* Quick Filters */}
          <div className="flex gap-2">
            <button
              onClick={() => handleQuickFilter('today')}
              className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                getActiveQuickFilter() === 'today'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
              }`}
            >
              Today
            </button>
            <button
              onClick={() => handleQuickFilter('yesterday')}
              className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                getActiveQuickFilter() === 'yesterday'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
              }`}
            >
              Yesterday
            </button>
            <button
              onClick={() => handleQuickFilter('last7days')}
              className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                getActiveQuickFilter() === 'last7days'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
              }`}
            >
              Last 7 Days
            </button>
          </div>

          {/* Date Range */}
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-gray-400" />
            <input
              type="date"
              value={filters.dateFrom}
              onChange={(e) =>
                setFilters({ ...filters, dateFrom: e.target.value })
              }
              className="px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />
            <span className="text-gray-500">to</span>
            <input
              type="date"
              value={filters.dateTo}
              onChange={(e) =>
                setFilters({ ...filters, dateTo: e.target.value })
              }
              className="px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />
          </div>

          {/* Refresh Button */}
          <button
            onClick={fetchReportData}
            disabled={isLoading}
            className="flex items-center gap-2 px-3 py-1.5 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded text-sm font-medium hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors disabled:opacity-50"
          >
            <RefreshCw
              className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`}
            />
            Refresh
          </button>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <p className="text-red-600 dark:text-red-400">{error}</p>
        </div>
      )}

      {/* Report Content */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md dark:shadow-gray-900/50 p-6">
        {/* Daily Counts Report */}
        {activeReport === 'daily-counts' && (
          <DailyCountsContent
            data={dailyCountsData}
            isLoading={isLoading}
            expandedProjects={expandedProjects}
            expandedZones={expandedZones}
            onToggleProject={toggleProject}
            onToggleZone={toggleZone}
          />
        )}

        {/* Discrepancy Report */}
        {activeReport === 'discrepancy' && (
          <DiscrepancyContent data={discrepancyData} isLoading={isLoading} />
        )}

        {/* Serial Validation Report */}
        {activeReport === 'serial-validation' && (
          <SerialValidationContent data={serialData} isLoading={isLoading} />
        )}

        {/* User/Team Attribution Report */}
        {activeReport === 'user-attribution' && (
          <UserTeamContent data={userTeamData} isLoading={isLoading} />
        )}
      </div>
    </div>
  );
}

// ============================================================================
// DAILY COUNTS CONTENT
// ============================================================================

interface DailyCountsContentProps {
  data: DailyCountsResponse | null;
  isLoading: boolean;
  expandedProjects: Set<string>;
  expandedZones: Set<string>;
  onToggleProject: (project: string) => void;
  onToggleZone: (key: string) => void;
}

function DailyCountsContent({
  data,
  isLoading,
  expandedProjects,
  expandedZones,
  onToggleProject,
  onToggleZone,
}: DailyCountsContentProps) {
  if (isLoading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-16 animate-pulse bg-gray-200 dark:bg-gray-700 rounded"
          />
        ))}
      </div>
    );
  }

  if (!data || data.projects.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500 dark:text-gray-400">
        No data available for the selected date range.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Grand Total */}
      <div className="bg-gray-100 dark:bg-gray-900/50 rounded-lg p-4 mb-4">
        <div className="flex items-center justify-between">
          <span className="font-bold text-gray-900 dark:text-white">
            Grand Total
          </span>
          <div className="flex gap-4 text-sm">
            <span className="text-blue-600 dark:text-blue-400">
              Installed:{' '}
              <span className="font-semibold">
                {data.grand_total.installed}
              </span>
            </span>
            <span className="text-green-600 dark:text-green-500">
              Complete:{' '}
              <span className="font-semibold">{data.grand_total.complete}</span>
            </span>
            <span className="text-yellow-600 dark:text-yellow-500">
              Incomplete:{' '}
              <span className="font-semibold">
                {data.grand_total.incomplete}
              </span>
            </span>
            <span className="text-purple-600 dark:text-purple-400">
              Activated:{' '}
              <span className="font-semibold">
                {data.grand_total.activated}
              </span>
            </span>
          </div>
        </div>
      </div>

      {/* Project Accordions */}
      {data.projects.map((project) => (
        <ProjectAccordion
          key={project.project}
          project={project}
          isExpanded={expandedProjects.has(project.project)}
          expandedZones={expandedZones}
          onToggle={() => onToggleProject(project.project)}
          onToggleZone={onToggleZone}
        />
      ))}
    </div>
  );
}

interface ProjectAccordionProps {
  project: ProjectDailyCount;
  isExpanded: boolean;
  expandedZones: Set<string>;
  onToggle: () => void;
  onToggleZone: (key: string) => void;
}

function ProjectAccordion({
  project,
  isExpanded,
  expandedZones,
  onToggle,
  onToggleZone,
}: ProjectAccordionProps) {
  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
      {/* Project Header */}
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-900/30 hover:bg-gray-100 dark:hover:bg-gray-900/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          {isExpanded ? (
            <ChevronDown className="h-5 w-5 text-gray-500" />
          ) : (
            <ChevronRight className="h-5 w-5 text-gray-500" />
          )}
          <span className="font-semibold text-gray-900 dark:text-white">
            {project.project}
          </span>
        </div>
        <div className="flex gap-4 text-sm">
          <span className="text-blue-600 dark:text-blue-400">
            Installed:{' '}
            <span className="font-semibold">
              {project.installed}
            </span>
          </span>
          <span className="text-green-600 dark:text-green-500">
            Complete: <span className="font-semibold">{project.complete}</span>
          </span>
          <span className="text-yellow-600 dark:text-yellow-500">
            Incomplete:{' '}
            <span className="font-semibold">{project.incomplete}</span>
          </span>
          <span className="text-purple-600 dark:text-purple-400">
            Activated:{' '}
            <span className="font-semibold">{project.activated}</span>
          </span>
        </div>
      </button>

      {/* Zone Breakdown */}
      {isExpanded && (
        <div className="pl-6 pr-4 pb-4 pt-2 space-y-2">
          {project.zones.map((zone) => (
            <ZoneAccordion
              key={`${project.project}_${zone.zone_no}`}
              projectName={project.project}
              zone={zone}
              isExpanded={expandedZones.has(
                `${project.project}_${zone.zone_no}`
              )}
              onToggle={() =>
                onToggleZone(`${project.project}_${zone.zone_no}`)
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface ZoneAccordionProps {
  projectName: string;
  zone: ZoneBreakdown;
  isExpanded: boolean;
  onToggle: () => void;
}

function ZoneAccordion({
  projectName,
  zone,
  isExpanded,
  onToggle,
}: ZoneAccordionProps) {
  return (
    <div className="border border-gray-100 dark:border-gray-700 rounded-lg overflow-hidden">
      {/* Zone Header */}
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-3 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          {isExpanded ? (
            <ChevronDown className="h-4 w-4 text-gray-400" />
          ) : (
            <ChevronRight className="h-4 w-4 text-gray-400" />
          )}
          <span className="font-medium text-gray-700 dark:text-gray-300">
            {zone.zone_name}
          </span>
        </div>
        <div className="flex gap-4 text-sm">
          <span className="text-blue-600 dark:text-blue-400">
            Installed:{' '}
            <span className="font-medium">
              {zone.installed}
            </span>
          </span>
          <span className="text-green-600 dark:text-green-500">
            Complete: {zone.complete}
          </span>
          <span className="text-yellow-600 dark:text-yellow-500">
            Incomplete: {zone.incomplete}
          </span>
          <span className="text-purple-600 dark:text-purple-400">
            Activated: {zone.activated}
          </span>
        </div>
      </button>

      {/* PON List */}
      {isExpanded && (
        <div className="pl-8 pr-4 pb-3 pt-1 space-y-1">
          {zone.pons.map((pon) => (
            <div
              key={`${projectName}_${zone.zone_no}_${pon.pon_no}`}
              className="flex items-center justify-between py-2 px-3 bg-gray-50 dark:bg-gray-900/30 rounded"
            >
              <span className="text-sm text-gray-600 dark:text-gray-400">
                {pon.pon_name}
              </span>
              <div className="flex gap-4 text-sm">
                <span className="text-blue-600 dark:text-blue-400">
                  {pon.installed}
                </span>
                <span className="text-green-600 dark:text-green-500">
                  {pon.complete}
                </span>
                <span className="text-yellow-600 dark:text-yellow-500">
                  {pon.incomplete}
                </span>
                <span className="text-purple-600 dark:text-purple-400">
                  {pon.activated}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// DISCREPANCY CONTENT
// ============================================================================

interface DiscrepancyContentProps {
  data: DiscrepancyReportResponse | null;
  isLoading: boolean;
}

function DiscrepancyContent({ data, isLoading }: DiscrepancyContentProps) {
  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-24 animate-pulse bg-gray-200 dark:bg-gray-700 rounded-lg"
            />
          ))}
        </div>
        <div className="h-64 animate-pulse bg-gray-200 dark:bg-gray-700 rounded" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center py-8 text-gray-500 dark:text-gray-400">
        No data available for the selected date.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <SummaryCard
          title="WA Submissions"
          value={data.summary.total_wa_submissions}
          color="blue"
        />
        <SummaryCard
          title="OES Activations"
          value={data.summary.total_oes_activations}
          color="purple"
        />
        <SummaryCard
          title="Matched"
          value={data.summary.matched}
          color="green"
        />
        <SummaryCard
          title="WA Only"
          value={data.summary.wa_only}
          color="yellow"
          subtitle="Not yet activated"
        />
        <SummaryCard
          title="OES Only"
          value={data.summary.oes_only}
          color="orange"
          subtitle="Manual install?"
        />
      </div>

      {/* Discrepancy Table */}
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
          <thead className="bg-gray-50 dark:bg-gray-900/50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                DR Number
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                Project
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                Status
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                WA Submitted By
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                OES Team
              </th>
            </tr>
          </thead>
          <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
            {data.records.slice(0, 50).map((record) => (
              <tr
                key={record.drop_number}
                className={`${
                  record.discrepancy_type === 'matched'
                    ? 'bg-green-50 dark:bg-green-900/10'
                    : record.discrepancy_type === 'wa_only'
                      ? 'bg-yellow-50 dark:bg-yellow-900/10'
                      : 'bg-orange-50 dark:bg-orange-900/10'
                }`}
              >
                <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-white">
                  {record.drop_number}
                </td>
                <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                  {record.project || '-'}
                </td>
                <td className="px-4 py-3 text-sm">
                  <span
                    className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${
                      record.discrepancy_type === 'matched'
                        ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-200'
                        : record.discrepancy_type === 'wa_only'
                          ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-200'
                          : 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-200'
                    }`}
                  >
                    {record.discrepancy_type === 'matched'
                      ? 'Matched'
                      : record.discrepancy_type === 'wa_only'
                        ? 'WA Only'
                        : 'OES Only'}
                  </span>
                </td>
                <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                  {record.wa_submitted_by || record.wa_sender_phone || '-'}
                </td>
                <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                  {record.oes_team || '-'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data.records.length > 50 && (
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-2 text-center">
            Showing first 50 of {data.records.length} records
          </p>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// SERIAL VALIDATION CONTENT
// ============================================================================

interface SerialValidationContentProps {
  data: SerialValidationReportResponse | null;
  isLoading: boolean;
}

function SerialValidationContent({
  data,
  isLoading,
}: SerialValidationContentProps) {
  const [showMismatchesOnly, setShowMismatchesOnly] = useState(false);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="h-24 animate-pulse bg-gray-200 dark:bg-gray-700 rounded-lg"
            />
          ))}
        </div>
        <div className="h-64 animate-pulse bg-gray-200 dark:bg-gray-700 rounded" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center py-8 text-gray-500 dark:text-gray-400">
        No data available for the selected date range.
      </div>
    );
  }

  const displayRecords = showMismatchesOnly ? data.mismatches_only : data.records;

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
        <SummaryCard
          title="Total Checked"
          value={data.summary.total_checked}
          color="gray"
        />
        <SummaryCard
          title="ONT Matches"
          value={data.summary.ont_matches}
          color="green"
        />
        <SummaryCard
          title="ONT Mismatches"
          value={data.summary.ont_mismatches}
          color="red"
        />
        <SummaryCard
          title="ONT Missing"
          value={data.summary.ont_missing}
          color="yellow"
        />
        <SummaryCard
          title="UPS Present"
          value={data.summary.ups_present}
          color="green"
        />
        <SummaryCard
          title="UPS Missing"
          value={data.summary.ups_missing}
          color="yellow"
        />
      </div>

      {/* Toggle for mismatches only */}
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={showMismatchesOnly}
            onChange={(e) => setShowMismatchesOnly(e.target.checked)}
            className="rounded border-gray-300 text-red-600 focus:ring-red-500"
          />
          <span className="text-sm text-gray-700 dark:text-gray-300">
            Show mismatches only ({data.mismatches_only.length})
          </span>
        </label>
      </div>

      {/* Validation Table */}
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
          <thead className="bg-gray-50 dark:bg-gray-900/50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                DR Number
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                ONT (WA)
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                ONT (OES)
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                Status
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                UPS
              </th>
            </tr>
          </thead>
          <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
            {displayRecords.slice(0, 50).map((record) => (
              <tr
                key={record.drop_number}
                className={`${
                  record.ont_match_status === 'match'
                    ? ''
                    : record.ont_match_status === 'mismatch'
                      ? 'bg-red-50 dark:bg-red-900/10'
                      : 'bg-yellow-50 dark:bg-yellow-900/10'
                }`}
              >
                <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-white">
                  {record.drop_number}
                </td>
                <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400 font-mono">
                  {record.ont_serial_wa || '-'}
                </td>
                <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400 font-mono">
                  {record.ont_serial_oes || '-'}
                </td>
                <td className="px-4 py-3 text-sm">
                  <span
                    className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${
                      record.ont_match_status === 'match'
                        ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-200'
                        : record.ont_match_status === 'mismatch'
                          ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-200'
                          : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-200'
                    }`}
                  >
                    {record.ont_match_status}
                  </span>
                </td>
                <td className="px-4 py-3 text-sm">
                  {record.ups_serial_exists ? (
                    <span className="text-green-600 dark:text-green-500">
                      Yes
                    </span>
                  ) : (
                    <span className="text-yellow-600 dark:text-yellow-500">
                      No
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {displayRecords.length > 50 && (
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-2 text-center">
            Showing first 50 of {displayRecords.length} records
          </p>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// USER/TEAM CONTENT
// ============================================================================

interface UserTeamContentProps {
  data: UserTeamAttributionResponse | null;
  isLoading: boolean;
}

function UserTeamContent({ data, isLoading }: UserTeamContentProps) {
  const [activeView, setActiveView] = useState<'users' | 'teams'>('users');

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="h-24 animate-pulse bg-gray-200 dark:bg-gray-700 rounded-lg"
            />
          ))}
        </div>
        <div className="h-64 animate-pulse bg-gray-200 dark:bg-gray-700 rounded" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center py-8 text-gray-500 dark:text-gray-400">
        No data available for the selected date range.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <SummaryCard
          title="Total Users"
          value={data.summary.total_users}
          color="blue"
        />
        <SummaryCard
          title="Total Teams"
          value={data.summary.total_teams}
          color="purple"
        />
        <SummaryCard
          title="Avg Completion"
          value={`${data.summary.avg_completion_rate}%`}
          color="green"
        />
        <SummaryCard
          title="Avg Serial Compliance"
          value={`${data.summary.avg_serial_compliance}%`}
          color="blue"
        />
      </div>

      {/* View Toggle */}
      <div className="flex gap-2">
        <button
          onClick={() => setActiveView('users')}
          className={`px-4 py-2 rounded-lg font-medium text-sm transition-colors ${
            activeView === 'users'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
          }`}
        >
          Users ({data.users.length})
        </button>
        <button
          onClick={() => setActiveView('teams')}
          className={`px-4 py-2 rounded-lg font-medium text-sm transition-colors ${
            activeView === 'teams'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
          }`}
        >
          Teams ({data.teams.length})
        </button>
      </div>

      {/* Users Table */}
      {activeView === 'users' && (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-900/50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                  User
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                  Project
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                  Installed
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                  Complete
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                  Completion %
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                  Serial %
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                  Activated %
                </th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
              {data.users.map((user, idx) => (
                <tr key={idx}>
                  <td className="px-4 py-3 text-sm">
                    <div className="font-medium text-gray-900 dark:text-white">
                      {user.user_name || 'Unknown'}
                    </div>
                    <div className="text-gray-500 dark:text-gray-400 text-xs">
                      {user.sender_phone
                        ? user.sender_phone.replace(/^27/, '0')
                        : '-'}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                    {user.project}
                  </td>
                  <td className="px-4 py-3 text-sm text-blue-600 dark:text-blue-400">
                    {user.installed}
                  </td>
                  <td className="px-4 py-3 text-sm text-green-600 dark:text-green-500">
                    {user.complete}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <span
                      className={`font-medium ${
                        user.completion_rate >= 80
                          ? 'text-green-600 dark:text-green-500'
                          : user.completion_rate >= 50
                            ? 'text-yellow-600 dark:text-yellow-500'
                            : 'text-red-600 dark:text-red-500'
                      }`}
                    >
                      {user.completion_rate}%
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <span
                      className={`font-medium ${
                        user.serial_compliance_rate >= 80
                          ? 'text-green-600 dark:text-green-500'
                          : user.serial_compliance_rate >= 50
                            ? 'text-yellow-600 dark:text-yellow-500'
                            : 'text-red-600 dark:text-red-500'
                      }`}
                    >
                      {user.serial_compliance_rate}%
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-purple-600 dark:text-purple-400">
                    {user.activation_rate}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Teams Table */}
      {activeView === 'teams' && (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-900/50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                  Team
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                  Project
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                  Total Activations
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                  Matched to WA
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                  Match Rate
                </th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
              {data.teams.map((team, idx) => (
                <tr key={idx}>
                  <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-white">
                    {team.team}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                    {team.project || '-'}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-900 dark:text-white">
                    {team.total_activations}
                  </td>
                  <td className="px-4 py-3 text-sm text-green-600 dark:text-green-500">
                    {team.matched_to_wa}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <span
                      className={`font-medium ${
                        team.match_rate >= 80
                          ? 'text-green-600 dark:text-green-500'
                          : team.match_rate >= 50
                            ? 'text-yellow-600 dark:text-yellow-500'
                            : 'text-red-600 dark:text-red-500'
                      }`}
                    >
                      {team.match_rate}%
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// SHARED COMPONENTS
// ============================================================================

interface SummaryCardProps {
  title: string;
  value: number | string;
  color: 'blue' | 'green' | 'yellow' | 'red' | 'orange' | 'purple' | 'gray';
  subtitle?: string;
}

function SummaryCard({ title, value, color, subtitle }: SummaryCardProps) {
  const colorClasses = {
    blue: 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400',
    green:
      'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400',
    yellow:
      'bg-yellow-50 dark:bg-yellow-900/20 text-yellow-600 dark:text-yellow-400',
    red: 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400',
    orange:
      'bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400',
    purple:
      'bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400',
    gray: 'bg-gray-50 dark:bg-gray-900/20 text-gray-600 dark:text-gray-400',
  };

  return (
    <div className={`rounded-lg p-4 ${colorClasses[color]}`}>
      <div className="text-sm font-medium opacity-75">{title}</div>
      <div className="text-2xl font-bold">{value}</div>
      {subtitle && (
        <div className="text-xs opacity-60 mt-1">{subtitle}</div>
      )}
    </div>
  );
}

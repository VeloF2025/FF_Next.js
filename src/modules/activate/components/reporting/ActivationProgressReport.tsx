/**
 * ActivationProgressReport - Track DR activation progress by Project > Zone > PON
 *
 * Purpose: Show activation completion percentages against total scope
 * - Hierarchical drill-down: Project → Zone → PON
 * - Flat table view with sorting
 * - Daily/Weekly/Cumulative time views
 *
 * Status: WORKING
 * NLNH Confidence: HIGH
 */

'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Table2,
  GitBranch,
  Calendar,
  TrendingUp,
  BarChart3,
  Target,
  ArrowUpDown,
  EyeOff,
  Eye,
} from 'lucide-react';
import type {
  ReportFilters,
  ActivationProgressResponse,
  ActivationProgressView,
  ActivationProgressGranularity,
  ProjectProgressNode,
  ZoneProgressNode,
  FlatProgressRow,
} from '../../types/reporting.types';

interface ActivationProgressReportProps {
  filters: ReportFilters;
  refreshKey: number;
}

type SortField = 'project_name' | 'zone_no' | 'pon_no' | 'total_scope' | 'activated' | 'completion_percent';
type SortDir = 'asc' | 'desc';

export function ActivationProgressReport({ filters, refreshKey }: ActivationProgressReportProps) {
  // State
  const [data, setData] = useState<ActivationProgressResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [view, setView] = useState<ActivationProgressView>('hierarchy');
  const [granularity, setGranularity] = useState<ActivationProgressGranularity>('cumulative');
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [expandedZones, setExpandedZones] = useState<Set<string>>(new Set());

  // Table sorting
  const [sortField, setSortField] = useState<SortField>('completion_percent');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  // Filter toggle - hide zone/pon = 0
  const [hideZeroValues, setHideZeroValues] = useState(true);

  // Fetch data
  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams();
        params.set('dateFrom', filters.dateFrom);
        params.set('dateTo', filters.dateTo);
        if (filters.project) params.set('project', filters.project);
        params.set('view', view);
        params.set('granularity', granularity);

        const res = await fetch(`/api/activate/reporting/activation-progress?${params}`);
        if (!res.ok) {
          throw new Error(`Failed to fetch: ${res.status}`);
        }
        const json = await res.json();
        setData(json);

        // Auto-expand single project
        if (json.hierarchy?.length === 1) {
          setExpandedProjects(new Set([json.hierarchy[0].project_id]));
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load data');
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [filters, refreshKey, view, granularity]);

  // Toggle project expansion
  const toggleProject = (projectId: string) => {
    const next = new Set(expandedProjects);
    if (next.has(projectId)) {
      next.delete(projectId);
    } else {
      next.add(projectId);
    }
    setExpandedProjects(next);
  };

  // Toggle zone expansion
  const toggleZone = (key: string) => {
    const next = new Set(expandedZones);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    setExpandedZones(next);
  };

  // Filter and sort flat data
  const sortedFlat = useMemo(() => {
    if (!data?.flat) return [];
    let filtered = data.flat;

    // Filter out zone/pon = 0 AND rows with 0 activations if toggle is on
    if (hideZeroValues) {
      filtered = filtered.filter(row => row.zone_no > 0 && row.pon_no > 0 && row.activated > 0);
    }

    const sorted = [...filtered];
    sorted.sort((a, b) => {
      let aVal: string | number = a[sortField];
      let bVal: string | number = b[sortField];
      if (typeof aVal === 'string') {
        aVal = aVal.toLowerCase();
        bVal = (bVal as string).toLowerCase();
      }
      if (aVal < bVal) return sortDir === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return sorted;
  }, [data?.flat, sortField, sortDir, hideZeroValues]);

  // Filter hierarchy data
  const filteredHierarchy = useMemo(() => {
    if (!data?.hierarchy) return [];
    if (!hideZeroValues) return data.hierarchy;

    return data.hierarchy.map(project => ({
      ...project,
      zones: project.zones
        .filter(zone => zone.zone_no > 0 && zone.activated > 0)
        .map(zone => ({
          ...zone,
          pons: zone.pons.filter(pon => pon.pon_no > 0 && pon.activated > 0),
        }))
        .filter(zone => zone.pons.length > 0),
    })).filter(project => project.zones.length > 0);
  }, [data?.hierarchy, hideZeroValues]);

  // Summary always shows full totals - Hide Zero only affects displayed zones/PONs
  // Total Scope = all DRs in scope, Activated = all activated DRs
  const filteredSummary = data?.summary ?? null;

  // Handle sort click
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-1/3"></div>
          <div className="grid grid-cols-4 gap-4">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="h-24 bg-gray-200 dark:bg-gray-700 rounded"></div>
            ))}
          </div>
          <div className="h-64 bg-gray-200 dark:bg-gray-700 rounded"></div>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="p-6">
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <p className="text-red-800 dark:text-red-200">{error}</p>
        </div>
      </div>
    );
  }

  // Empty state
  if (!data || filteredHierarchy.length === 0) {
    return (
      <div className="p-6">
        <div className="text-center py-12 text-gray-500 dark:text-gray-400">
          <Target className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p>No activation data found for the selected filters.</p>
          <p className="text-sm mt-2">Try adjusting the date range or project filter.</p>
        </div>
      </div>
    );
  }

  const summary = filteredSummary || data.summary;

  return (
    <div className="p-6 space-y-6">
      {/* Controls Row */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        {/* View Toggle */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500 dark:text-gray-400">View:</span>
          <div className="flex rounded-lg border border-gray-300 dark:border-gray-600 overflow-hidden">
            <button
              onClick={() => setView('hierarchy')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium transition-colors ${
                view === 'hierarchy'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
              }`}
            >
              <GitBranch className="h-4 w-4" />
              Hierarchy
            </button>
            <button
              onClick={() => setView('flat')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium transition-colors ${
                view === 'flat'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
              }`}
            >
              <Table2 className="h-4 w-4" />
              Table
            </button>
          </div>
        </div>

        {/* Hide Zero Toggle */}
        <button
          onClick={() => setHideZeroValues(!hideZeroValues)}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border transition-colors ${
            hideZeroValues
              ? 'bg-blue-600 text-white border-blue-600'
              : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700'
          }`}
          title={hideZeroValues ? 'Showing zones/PONs with assigned values only' : 'Click to hide Zone 0 and PON 0'}
        >
          {hideZeroValues ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          {hideZeroValues ? 'Hiding Zero' : 'Show All'}
        </button>

        {/* Granularity Tabs */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500 dark:text-gray-400">Period:</span>
          <div className="flex rounded-lg border border-gray-300 dark:border-gray-600 overflow-hidden">
            {(['daily', 'weekly', 'cumulative'] as const).map(g => (
              <button
                key={g}
                onClick={() => setGranularity(g)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium transition-colors ${
                  granularity === g
                    ? 'bg-blue-600 text-white'
                    : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                }`}
              >
                {g === 'daily' && <Calendar className="h-4 w-4" />}
                {g === 'weekly' && <BarChart3 className="h-4 w-4" />}
                {g === 'cumulative' && <TrendingUp className="h-4 w-4" />}
                {g.charAt(0).toUpperCase() + g.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <SummaryCard
          label="Total Scope"
          value={summary.total_scope.toLocaleString()}
          subtext="DRs in SOW"
          color="blue"
        />
        <SummaryCard
          label="Activated"
          value={summary.total_activated.toLocaleString()}
          subtext={`${summary.activation_rate_per_day}/day avg`}
          color="green"
        />
        <SummaryCard
          label="Remaining"
          value={summary.total_remaining.toLocaleString()}
          subtext="Not yet on OES"
          color="orange"
        />
        <SummaryCard
          label="Completion"
          value={`${summary.completion_percent}%`}
          subtext={`${summary.days_in_range} days in range`}
          color="purple"
          isPercent
          percent={summary.completion_percent}
        />
      </div>

      {/* Data Display */}
      {view === 'hierarchy' ? (
        <HierarchyView
          hierarchy={filteredHierarchy}
          expandedProjects={expandedProjects}
          expandedZones={expandedZones}
          toggleProject={toggleProject}
          toggleZone={toggleZone}
        />
      ) : (
        <FlatTableView
          rows={sortedFlat}
          sortField={sortField}
          sortDir={sortDir}
          onSort={handleSort}
        />
      )}
    </div>
  );
}

// Summary Card Component
interface SummaryCardProps {
  label: string;
  value: string;
  subtext: string;
  color: 'blue' | 'green' | 'orange' | 'purple';
  isPercent?: boolean;
  percent?: number;
}

function SummaryCard({ label, value, subtext, color, isPercent, percent }: SummaryCardProps) {
  const colors = {
    blue: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800',
    green: 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800',
    orange: 'bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800',
    purple: 'bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-800',
  };

  const textColors = {
    blue: 'text-blue-700 dark:text-blue-300',
    green: 'text-green-700 dark:text-green-300',
    orange: 'text-orange-700 dark:text-orange-300',
    purple: 'text-purple-700 dark:text-purple-300',
  };

  return (
    <div className={`rounded-lg border p-4 ${colors[color]}`}>
      <p className="text-sm text-gray-600 dark:text-gray-400">{label}</p>
      <p className={`text-2xl font-bold ${textColors[color]}`}>{value}</p>
      {isPercent && percent !== undefined && (
        <div className="mt-2 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
          <div
            className="h-full bg-purple-500 transition-all duration-500"
            style={{ width: `${Math.min(percent, 100)}%` }}
          />
        </div>
      )}
      <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">{subtext}</p>
    </div>
  );
}

// Hierarchy View Component
interface HierarchyViewProps {
  hierarchy: ProjectProgressNode[];
  expandedProjects: Set<string>;
  expandedZones: Set<string>;
  toggleProject: (id: string) => void;
  toggleZone: (key: string) => void;
}

function HierarchyView({
  hierarchy,
  expandedProjects,
  expandedZones,
  toggleProject,
  toggleZone,
}: HierarchyViewProps) {
  return (
    <div className="space-y-2">
      {hierarchy.map(project => (
        <ProjectCard
          key={project.project_id}
          project={project}
          isExpanded={expandedProjects.has(project.project_id)}
          expandedZones={expandedZones}
          onToggle={() => toggleProject(project.project_id)}
          onToggleZone={toggleZone}
        />
      ))}
    </div>
  );
}

// Project Card Component
interface ProjectCardProps {
  project: ProjectProgressNode;
  isExpanded: boolean;
  expandedZones: Set<string>;
  onToggle: () => void;
  onToggleZone: (key: string) => void;
}

function ProjectCard({ project, isExpanded, expandedZones, onToggle, onToggleZone }: ProjectCardProps) {
  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
      {/* Project Header */}
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-750 transition-colors"
      >
        <div className="flex items-center gap-3">
          {isExpanded ? (
            <ChevronDown className="h-5 w-5 text-gray-500" />
          ) : (
            <ChevronRight className="h-5 w-5 text-gray-500" />
          )}
          <span className="font-semibold text-gray-900 dark:text-white">{project.project_name}</span>
          <span className="text-sm text-gray-500">({project.zones.length} zones)</span>
        </div>
        <div className="flex items-center gap-6">
          <ProgressStats
            total={project.total_scope}
            activated={project.activated}
            percent={project.completion_percent}
          />
        </div>
      </button>

      {/* Zones */}
      {isExpanded && (
        <div className="border-t border-gray-200 dark:border-gray-700">
          {project.zones.map(zone => {
            const zoneKey = `${project.project_id}-${zone.zone_no}`;
            const isZoneExpanded = expandedZones.has(zoneKey);

            return (
              <div key={zone.zone_no} className="border-b border-gray-100 dark:border-gray-800 last:border-b-0">
                {/* Zone Header */}
                <button
                  onClick={() => onToggleZone(zoneKey)}
                  className="w-full flex items-center justify-between p-3 pl-10 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    {isZoneExpanded ? (
                      <ChevronDown className="h-4 w-4 text-gray-400" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-gray-400" />
                    )}
                    <span className="font-medium text-gray-700 dark:text-gray-300">
                      Zone {zone.zone_no || 'N/A'}
                    </span>
                    <span className="text-xs text-gray-500">({zone.pons.length} PONs)</span>
                  </div>
                  <ProgressStats
                    total={zone.total_scope}
                    activated={zone.activated}
                    percent={zone.completion_percent}
                    small
                  />
                </button>

                {/* PONs */}
                {isZoneExpanded && (
                  <div className="bg-gray-50 dark:bg-gray-900/30">
                    {zone.pons.map(pon => (
                      <div
                        key={pon.pon_no}
                        className="flex items-center justify-between p-2 pl-20 border-t border-gray-100 dark:border-gray-800"
                      >
                        <span className="text-sm text-gray-600 dark:text-gray-400">
                          PON {pon.pon_no || 'N/A'}
                        </span>
                        <ProgressStats
                          total={pon.total_scope}
                          activated={pon.activated}
                          percent={pon.completion_percent}
                          small
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Progress Stats Component
interface ProgressStatsProps {
  total: number;
  activated: number;
  percent: number;
  small?: boolean;
}

function ProgressStats({ total, activated, percent, small }: ProgressStatsProps) {
  const barWidth = small ? 'w-24' : 'w-32';
  const textSize = small ? 'text-xs' : 'text-sm';

  return (
    <div className="flex items-center gap-4">
      <div className={`${textSize} text-gray-600 dark:text-gray-400`}>
        <span className="text-green-600 dark:text-green-400 font-medium">{activated}</span>
        <span className="mx-1">/</span>
        <span>{total}</span>
      </div>
      <div className={`${barWidth} h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden`}>
        <div
          className={`h-full transition-all duration-300 ${
            percent > 80 ? 'bg-green-500' :
            percent >= 60 ? 'bg-blue-500' :
            percent >= 40 ? 'bg-orange-500' : 'bg-red-500'
          }`}
          style={{ width: `${Math.min(percent, 100)}%` }}
        />
      </div>
      <span className={`${textSize} font-medium ${
        percent > 80 ? 'text-green-600 dark:text-green-400' :
        percent >= 60 ? 'text-blue-600 dark:text-blue-400' :
        percent >= 40 ? 'text-orange-600 dark:text-orange-400' :
        'text-red-600 dark:text-red-400'
      }`}>
        {percent}%
      </span>
    </div>
  );
}

// Flat Table View Component
interface FlatTableViewProps {
  rows: FlatProgressRow[];
  sortField: SortField;
  sortDir: SortDir;
  onSort: (field: SortField) => void;
}

function FlatTableView({ rows, sortField, sortDir, onSort }: FlatTableViewProps) {
  const SortHeader = ({ field, label }: { field: SortField; label: string }) => (
    <th
      className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 tracking-wide cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700"
      onClick={() => onSort(field)}
    >
      <div className="flex items-center gap-1">
        {label}
        {sortField === field && (
          <ArrowUpDown className={`h-3 w-3 ${sortDir === 'asc' ? 'rotate-180' : ''}`} />
        )}
      </div>
    </th>
  );

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
          <thead className="bg-gray-50 dark:bg-gray-800">
            <tr>
              <SortHeader field="project_name" label="Project" />
              <SortHeader field="zone_no" label="Zone" />
              <SortHeader field="pon_no" label="PON" />
              <SortHeader field="total_scope" label="Total" />
              <SortHeader field="activated" label="Activated" />
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 tracking-wide">
                Remaining
              </th>
              <SortHeader field="completion_percent" label="Progress" />
            </tr>
          </thead>
          <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-200 dark:divide-gray-800">
            {rows.map((row, idx) => (
              <tr key={idx} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-white">
                  {row.project_name}
                </td>
                <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                  {row.zone_no || 'N/A'}
                </td>
                <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                  {row.pon_no || 'N/A'}
                </td>
                <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                  {row.total_scope}
                </td>
                <td className="px-4 py-3 text-sm text-green-600 dark:text-green-400 font-medium">
                  {row.activated}
                </td>
                <td className="px-4 py-3 text-sm text-orange-600 dark:text-orange-400">
                  {row.remaining}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="w-20 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                      <div
                        className={`h-full ${
                          row.completion_percent > 80 ? 'bg-green-500' :
                          row.completion_percent >= 60 ? 'bg-blue-500' :
                          row.completion_percent >= 40 ? 'bg-orange-500' : 'bg-red-500'
                        }`}
                        style={{ width: `${Math.min(row.completion_percent, 100)}%` }}
                      />
                    </div>
                    <span className={`text-sm font-medium ${
                      row.completion_percent > 80 ? 'text-green-600 dark:text-green-400' :
                      row.completion_percent >= 60 ? 'text-blue-600 dark:text-blue-400' :
                      row.completion_percent >= 40 ? 'text-orange-600 dark:text-orange-400' :
                      'text-red-600 dark:text-red-400'
                    }`}>
                      {row.completion_percent}%
                    </span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default ActivationProgressReport;

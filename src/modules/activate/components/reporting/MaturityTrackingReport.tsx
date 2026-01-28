/**
 * MaturityTrackingReport.tsx
 *
 * Track project maturity - how long from first installation to completion
 * Shows milestone tracking, velocity metrics, and completion projections
 */

'use client';

import React, { useState, useCallback, useMemo } from 'react';
import {
  Clock,
  TrendingUp,
  TrendingDown,
  Minus,
  AlertCircle,
  Calendar,
  ChevronDown,
  ChevronRight,
  Target,
  Gauge,
  BarChart3,
  Download,
  Loader2,
  CheckCircle2,
  Circle,
  Filter,
} from 'lucide-react';
import type {
  MaturityTrackingResponse,
  ProjectMaturityNode,
  ZoneMaturityNode,
  VelocityMetrics,
  MilestoneData,
  ProjectionData,
} from '../../types/reporting.types';

interface MaturityTrackingReportProps {
  projectId?: string;
  projectName?: string;
}

// Fetch helper
async function fetchMaturityData(project?: string): Promise<MaturityTrackingResponse> {
  const params = new URLSearchParams();
  if (project) params.set('project', project);
  params.set('view', 'hierarchy');

  const response = await fetch(`/api/activate/reporting/maturity-tracking?${params}`);
  if (!response.ok) {
    throw new Error('Failed to fetch maturity data');
  }
  return response.json();
}

export function MaturityTrackingReport({ projectId, projectName }: MaturityTrackingReportProps) {
  const [data, setData] = useState<MaturityTrackingResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [expandedZones, setExpandedZones] = useState<Set<string>>(new Set());
  const [hideComplete, setHideComplete] = useState(false);
  const [hideZero, setHideZero] = useState(false);

  // Load data on mount or when filters change
  React.useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await fetchMaturityData(projectId || projectName);
        setData(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load data');
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [projectId, projectName]);

  // Toggle project expansion
  const toggleProject = useCallback((projectId: string) => {
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
      }
      return next;
    });
  }, []);

  // Toggle zone expansion
  const toggleZone = useCallback((key: string) => {
    setExpandedZones((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  // Filter data based on hide options
  const filteredHierarchy = useMemo(() => {
    if (!data) return [];
    return data.hierarchy.filter((p) => {
      if (hideComplete && p.completion_percent >= 100) return false;
      if (hideZero && p.activated === 0) return false;
      return true;
    });
  }, [data, hideComplete, hideZero]);

  // Export CSV
  const exportCsv = useCallback(() => {
    if (!data) return;

    const headers = [
      'Project',
      'Zone',
      'PON',
      'Scope',
      'Activated',
      'Remaining',
      'Completion %',
      'First Activation',
      'Latest Activation',
      'Age (Days)',
      '25% Date',
      '25% Days',
      '50% Date',
      '50% Days',
      '75% Date',
      '75% Days',
      '90% Date',
      '90% Days',
      'Weekly Velocity (4w)',
      'Weekly Velocity (12w)',
      'Trend',
      'Projected Completion',
      'Days to Complete',
      'Confidence',
    ].join(',');

    const rows = data.flat.map((row) => {
      const m25 = row.milestones.find((m) => m.percent === 25);
      const m50 = row.milestones.find((m) => m.percent === 50);
      const m75 = row.milestones.find((m) => m.percent === 75);
      const m90 = row.milestones.find((m) => m.percent === 90);

      return [
        `"${row.project_name}"`,
        row.zone_no,
        row.pon_no,
        row.total_scope,
        row.activated,
        row.remaining,
        row.completion_percent,
        row.first_activation_date || '',
        row.latest_activation_date || '',
        row.age_days,
        m25?.reached_date || '',
        m25?.days_to_reach ?? '',
        m50?.reached_date || '',
        m50?.days_to_reach ?? '',
        m75?.reached_date || '',
        m75?.days_to_reach ?? '',
        m90?.reached_date || '',
        m90?.days_to_reach ?? '',
        row.velocity.last_4_weeks,
        row.velocity.last_12_weeks,
        row.velocity.trend,
        row.projection.projected_completion_date || '',
        row.projection.days_to_completion ?? '',
        row.projection.confidence,
      ].join(',');
    });

    const csv = [headers, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `maturity-tracking-${data.as_of_date}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [data]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
        <span className="ml-3 text-[var(--ff-text-secondary)]">Loading maturity data...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-12 text-red-500">
        <AlertCircle className="w-6 h-6 mr-2" />
        {error}
      </div>
    );
  }

  if (!data) {
    return null;
  }

  const { summary } = data;

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-4">
        <SummaryCard
          label="Total Projects"
          value={summary.total_projects}
          icon={<BarChart3 className="w-5 h-5" />}
        />
        <SummaryCard
          label="Avg Completion"
          value={`${summary.avg_completion_percent.toFixed(1)}%`}
          icon={<Target className="w-5 h-5" />}
        />
        <SummaryCard
          label="Avg Days to 25%"
          value={summary.avg_days_to_25_percent !== null ? `${summary.avg_days_to_25_percent}` : '-'}
          sublabel="milestone"
          icon={<Gauge className="w-5 h-5 text-red-500" />}
        />
        <SummaryCard
          label="Avg Days to 50%"
          value={summary.avg_days_to_50_percent !== null ? `${summary.avg_days_to_50_percent}` : '-'}
          sublabel="milestone"
          icon={<Gauge className="w-5 h-5 text-orange-500" />}
        />
        <SummaryCard
          label="Avg Days to 75%"
          value={summary.avg_days_to_75_percent !== null ? `${summary.avg_days_to_75_percent}` : '-'}
          sublabel="milestone"
          icon={<Gauge className="w-5 h-5 text-blue-500" />}
        />
        <SummaryCard
          label="Avg Project Age"
          value={`${summary.avg_age_days} days`}
          icon={<Clock className="w-5 h-5" />}
        />
        <SummaryCard
          label="Near Complete"
          value={summary.projects_near_complete}
          sublabel="≥75%"
          icon={<CheckCircle2 className="w-5 h-5 text-green-500" />}
        />
        <SummaryCard
          label="Not Started"
          value={summary.projects_not_started}
          sublabel="0%"
          icon={<Circle className="w-5 h-5 text-gray-400" />}
        />
      </div>

      {/* Maturity Distribution */}
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-4">
        <h3 className="text-sm font-medium text-[var(--ff-text-secondary)] mb-3">
          Project Maturity Distribution
        </h3>
        <div className="flex items-center gap-2">
          <MaturityBar
            label="Not Started"
            count={summary.projects_not_started}
            total={summary.total_projects}
            color="bg-gray-400"
          />
          <MaturityBar
            label="Early (0-25%)"
            count={summary.projects_early_stage}
            total={summary.total_projects}
            color="bg-red-500"
          />
          <MaturityBar
            label="Mid (25-75%)"
            count={summary.projects_mid_progress}
            total={summary.total_projects}
            color="bg-orange-500"
          />
          <MaturityBar
            label="Near (75-99%)"
            count={summary.projects_near_complete}
            total={summary.total_projects}
            color="bg-blue-500"
          />
          <MaturityBar
            label="Complete"
            count={summary.projects_complete}
            total={summary.total_projects}
            color="bg-green-500"
          />
        </div>
      </div>

      {/* Filters and Export */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-[var(--ff-text-secondary)] cursor-pointer">
            <input
              type="checkbox"
              checked={hideComplete}
              onChange={(e) => setHideComplete(e.target.checked)}
              className="rounded border-[var(--ff-border-light)]"
            />
            Hide Complete (100%)
          </label>
          <label className="flex items-center gap-2 text-sm text-[var(--ff-text-secondary)] cursor-pointer">
            <input
              type="checkbox"
              checked={hideZero}
              onChange={(e) => setHideZero(e.target.checked)}
              className="rounded border-[var(--ff-border-light)]"
            />
            Hide Zero Activations
          </label>
        </div>
        <button
          onClick={exportCsv}
          className="flex items-center gap-2 px-3 py-1.5 text-sm bg-[var(--ff-bg-secondary)] hover:bg-[var(--ff-bg-tertiary)] rounded-lg transition-colors"
        >
          <Download className="w-4 h-4" />
          Export CSV
        </button>
      </div>

      {/* Project Cards */}
      <div className="space-y-4">
        {filteredHierarchy.map((project) => (
          <ProjectCard
            key={project.project_id}
            project={project}
            expanded={expandedProjects.has(project.project_id)}
            onToggle={() => toggleProject(project.project_id)}
            expandedZones={expandedZones}
            onToggleZone={toggleZone}
          />
        ))}
      </div>

      {filteredHierarchy.length === 0 && (
        <div className="text-center py-12 text-[var(--ff-text-secondary)]">
          <Filter className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p>No projects match the current filters</p>
        </div>
      )}
    </div>
  );
}

// Summary card component
function SummaryCard({
  label,
  value,
  sublabel,
  icon,
}: {
  label: string;
  value: string | number;
  sublabel?: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-4">
      <div className="flex items-center gap-2 text-[var(--ff-text-secondary)] mb-1">
        {icon}
        <span className="text-xs">{label}</span>
      </div>
      <div className="text-2xl font-bold text-[var(--ff-text-primary)]">{value}</div>
      {sublabel && <div className="text-xs text-[var(--ff-text-secondary)]">{sublabel}</div>}
    </div>
  );
}

// Maturity distribution bar
function MaturityBar({
  label,
  count,
  total,
  color,
}: {
  label: string;
  count: number;
  total: number;
  color: string;
}) {
  const percent = total > 0 ? (count / total) * 100 : 0;
  if (count === 0) return null;

  return (
    <div className="flex-1 min-w-0" title={`${label}: ${count} projects (${percent.toFixed(1)}%)`}>
      <div className={`h-8 ${color} rounded flex items-center justify-center`}>
        <span className="text-xs text-white font-medium truncate px-1">{count}</span>
      </div>
      <div className="text-[10px] text-[var(--ff-text-secondary)] text-center mt-1 truncate">
        {label}
      </div>
    </div>
  );
}

// Project card component
function ProjectCard({
  project,
  expanded,
  onToggle,
  expandedZones,
  onToggleZone,
}: {
  project: ProjectMaturityNode;
  expanded: boolean;
  onToggle: () => void;
  expandedZones: Set<string>;
  onToggleZone: (key: string) => void;
}) {
  return (
    <div className="bg-[var(--ff-bg-secondary)] rounded-lg overflow-hidden">
      {/* Project Header */}
      <div
        className="flex items-center justify-between p-4 cursor-pointer hover:bg-[var(--ff-bg-tertiary)] transition-colors"
        onClick={onToggle}
      >
        <div className="flex items-center gap-3">
          {expanded ? (
            <ChevronDown className="w-5 h-5 text-[var(--ff-text-secondary)]" />
          ) : (
            <ChevronRight className="w-5 h-5 text-[var(--ff-text-secondary)]" />
          )}
          <div>
            <h3 className="font-medium text-[var(--ff-text-primary)]">{project.project_name}</h3>
            <div className="flex items-center gap-4 text-xs text-[var(--ff-text-secondary)] mt-1">
              <span>{project.total_scope.toLocaleString()} DRs</span>
              <span>{project.activated.toLocaleString()} activated</span>
              <span>{project.age_days} days old</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-6">
          {/* Velocity Indicator */}
          <VelocityBadge velocity={project.velocity} />

          {/* Milestones Mini */}
          <MilestonesMini milestones={project.milestones} />

          {/* Progress */}
          <div className="w-32">
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="text-[var(--ff-text-secondary)]">Progress</span>
              <ProgressText percent={project.completion_percent} />
            </div>
            <ProgressBar percent={project.completion_percent} />
          </div>

          {/* Projection */}
          <ProjectionBadge projection={project.projection} />
        </div>
      </div>

      {/* Expanded Zones */}
      {expanded && (
        <div className="border-t border-[var(--ff-border-light)]">
          {project.zones.map((zone) => (
            <ZoneRow
              key={`${project.project_id}-${zone.zone_no}`}
              projectId={project.project_id}
              zone={zone}
              expanded={expandedZones.has(`${project.project_id}-${zone.zone_no}`)}
              onToggle={() => onToggleZone(`${project.project_id}-${zone.zone_no}`)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// Zone row component
function ZoneRow({
  projectId,
  zone,
  expanded,
  onToggle,
}: {
  projectId: string;
  zone: ZoneMaturityNode;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="border-b border-[var(--ff-border-light)] last:border-b-0">
      <div
        className="flex items-center justify-between px-4 py-3 pl-12 cursor-pointer hover:bg-[var(--ff-bg-tertiary)] transition-colors"
        onClick={onToggle}
      >
        <div className="flex items-center gap-3">
          {expanded ? (
            <ChevronDown className="w-4 h-4 text-[var(--ff-text-secondary)]" />
          ) : (
            <ChevronRight className="w-4 h-4 text-[var(--ff-text-secondary)]" />
          )}
          <div>
            <span className="font-medium text-[var(--ff-text-primary)]">Zone {zone.zone_no}</span>
            <span className="text-xs text-[var(--ff-text-secondary)] ml-2">
              ({zone.pons.length} PONs)
            </span>
          </div>
        </div>

        <div className="flex items-center gap-6">
          <MilestonesMini milestones={zone.milestones} />
          <div className="w-32">
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="text-[var(--ff-text-secondary)]">
                {zone.activated.toLocaleString()}/{zone.total_scope.toLocaleString()}
              </span>
              <ProgressText percent={zone.completion_percent} />
            </div>
            <ProgressBar percent={zone.completion_percent} />
          </div>
          <div className="w-24 text-xs text-[var(--ff-text-secondary)]">
            {zone.age_days} days
          </div>
        </div>
      </div>

      {/* Expanded PONs */}
      {expanded && (
        <div className="bg-[var(--ff-bg-primary)] mx-4 mb-3 rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-[var(--ff-bg-secondary)] text-[var(--ff-text-secondary)]">
                <th className="px-3 py-2 text-left">PON</th>
                <th className="px-3 py-2 text-right">Scope</th>
                <th className="px-3 py-2 text-right">Activated</th>
                <th className="px-3 py-2 text-right">Progress</th>
                <th className="px-3 py-2 text-center">25%</th>
                <th className="px-3 py-2 text-center">50%</th>
                <th className="px-3 py-2 text-center">75%</th>
                <th className="px-3 py-2 text-center">90%</th>
                <th className="px-3 py-2 text-right">Age</th>
              </tr>
            </thead>
            <tbody>
              {zone.pons.map((pon) => (
                <tr
                  key={`${projectId}-${zone.zone_no}-${pon.pon_no}`}
                  className="border-t border-[var(--ff-border-light)] hover:bg-[var(--ff-bg-secondary)]"
                >
                  <td className="px-3 py-2 font-medium">PON {pon.pon_no}</td>
                  <td className="px-3 py-2 text-right">{pon.total_scope}</td>
                  <td className="px-3 py-2 text-right">{pon.activated}</td>
                  <td className="px-3 py-2 text-right">
                    <ProgressText percent={pon.completion_percent} />
                  </td>
                  <MilestoneCell milestone={pon.milestones.find((m) => m.percent === 25)} />
                  <MilestoneCell milestone={pon.milestones.find((m) => m.percent === 50)} />
                  <MilestoneCell milestone={pon.milestones.find((m) => m.percent === 75)} />
                  <MilestoneCell milestone={pon.milestones.find((m) => m.percent === 90)} />
                  <td className="px-3 py-2 text-right text-[var(--ff-text-secondary)]">
                    {pon.age_days}d
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

// Milestone cell in PON table
function MilestoneCell({ milestone }: { milestone?: MilestoneData }) {
  if (!milestone) {
    return <td className="px-3 py-2 text-center text-[var(--ff-text-secondary)]">-</td>;
  }

  if (milestone.days_to_reach !== null) {
    return (
      <td className="px-3 py-2 text-center">
        <span className="inline-flex items-center gap-1 text-green-500">
          <CheckCircle2 className="w-3 h-3" />
          {milestone.days_to_reach}d
        </span>
      </td>
    );
  }

  return (
    <td className="px-3 py-2 text-center">
      <Circle className="w-3 h-3 text-gray-400 mx-auto" />
    </td>
  );
}

// Mini milestones display
function MilestonesMini({ milestones }: { milestones: MilestoneData[] }) {
  return (
    <div className="flex items-center gap-1">
      {[25, 50, 75, 90].map((percent) => {
        const m = milestones.find((ms) => ms.percent === percent);
        const reached = m?.days_to_reach !== null;
        return (
          <div
            key={percent}
            className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-medium ${
              reached
                ? 'bg-green-500/20 text-green-500 border border-green-500/30'
                : 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)] border border-[var(--ff-border-light)]'
            }`}
            title={`${percent}%: ${reached ? `Reached in ${m?.days_to_reach} days` : 'Not reached'}`}
          >
            {percent}
          </div>
        );
      })}
    </div>
  );
}

// Velocity badge
function VelocityBadge({ velocity }: { velocity: VelocityMetrics }) {
  const trendIcon = {
    accelerating: <TrendingUp className="w-4 h-4 text-green-500" />,
    steady: <Minus className="w-4 h-4 text-blue-500" />,
    slowing: <TrendingDown className="w-4 h-4 text-orange-500" />,
    stalled: <AlertCircle className="w-4 h-4 text-red-500" />,
  };

  const trendColor = {
    accelerating: 'text-green-500',
    steady: 'text-blue-500',
    slowing: 'text-orange-500',
    stalled: 'text-red-500',
  };

  return (
    <div
      className="flex items-center gap-2"
      title={`${velocity.last_4_weeks}/week (4w avg), ${velocity.last_12_weeks}/week (12w avg)`}
    >
      {trendIcon[velocity.trend]}
      <div className="text-xs">
        <div className={`font-medium ${trendColor[velocity.trend]}`}>
          {velocity.last_4_weeks}/wk
        </div>
        <div className="text-[var(--ff-text-secondary)]">{velocity.trend}</div>
      </div>
    </div>
  );
}

// Projection badge
function ProjectionBadge({ projection }: { projection: ProjectionData }) {
  if (projection.days_to_completion === 0) {
    return (
      <div className="flex items-center gap-2 text-green-500">
        <CheckCircle2 className="w-4 h-4" />
        <span className="text-xs font-medium">Complete</span>
      </div>
    );
  }

  if (!projection.projected_completion_date) {
    return (
      <div className="text-xs text-[var(--ff-text-secondary)]">
        <Calendar className="w-4 h-4 inline mr-1" />
        Unknown
      </div>
    );
  }

  const confidenceColor = {
    high: 'text-green-500',
    medium: 'text-blue-500',
    low: 'text-orange-500',
    unknown: 'text-gray-500',
  };

  return (
    <div className="text-xs" title={`Confidence: ${projection.confidence}`}>
      <div className={`font-medium ${confidenceColor[projection.confidence]}`}>
        <Calendar className="w-3 h-3 inline mr-1" />
        {formatDate(projection.projected_completion_date)}
      </div>
      <div className="text-[var(--ff-text-secondary)]">
        {projection.days_to_completion} days
      </div>
    </div>
  );
}

// Progress bar
function ProgressBar({ percent }: { percent: number }) {
  const color =
    percent > 80
      ? 'bg-green-500'
      : percent >= 60
        ? 'bg-blue-500'
        : percent >= 40
          ? 'bg-orange-500'
          : 'bg-red-500';

  return (
    <div className="h-2 bg-[var(--ff-bg-tertiary)] rounded-full overflow-hidden">
      <div
        className={`h-full ${color} transition-all duration-300`}
        style={{ width: `${Math.min(percent, 100)}%` }}
      />
    </div>
  );
}

// Progress text with color
function ProgressText({ percent }: { percent: number }) {
  const color =
    percent > 80
      ? 'text-green-500'
      : percent >= 60
        ? 'text-blue-500'
        : percent >= 40
          ? 'text-orange-500'
          : 'text-red-500';

  return <span className={`font-medium ${color}`}>{percent.toFixed(1)}%</span>;
}

// Format date helper
function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default MaturityTrackingReport;

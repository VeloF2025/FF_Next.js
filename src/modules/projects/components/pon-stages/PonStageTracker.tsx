/**
 * PON Stage Tracker Component
 *
 * Displays build pipeline progress per PON across 6 stages:
 * Permissions -> Poles -> CWC -> Optical -> ATP -> Activation
 *
 * Rows = PONs (grouped by zone accordion)
 * Columns = 6 stages with completion bars
 * Color: green >75%, amber 25-75%, red <25%, gray 0%
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import type {
  PonStagesResponse,
  PonStageRow,
  PonStageData,
  BuildStage,
  ZoneStageNode,
} from '@/types/pon-stages.types';
import { BUILD_STAGES, BUILD_STAGE_META } from '@/types/pon-stages.types';

interface PonStageTrackerProps {
  projectId: string;
}

function getStageColor(pct: number): string {
  if (pct === 0) return 'bg-gray-600';
  if (pct < 25) return 'bg-red-500';
  if (pct < 75) return 'bg-amber-500';
  return 'bg-emerald-500';
}

function getStageTextColor(pct: number): string {
  if (pct === 0) return 'text-gray-400';
  if (pct < 25) return 'text-red-400';
  if (pct < 75) return 'text-amber-400';
  return 'text-emerald-400';
}

function StageCell({ data }: { data: PonStageData }) {
  return (
    <td className="px-3 py-2 text-center">
      <div className="flex flex-col items-center gap-1">
        <span className={`text-xs font-medium ${getStageTextColor(data.pct)}`}>
          {data.complete}/{data.total}
        </span>
        <div className="w-full bg-gray-700 rounded-full h-1.5">
          <div
            className={`h-1.5 rounded-full transition-all ${getStageColor(data.pct)}`}
            style={{ width: `${Math.min(data.pct, 100)}%` }}
          />
        </div>
        <span className="text-[10px] text-[var(--ff-text-secondary)]">
          {data.pct}%
        </span>
      </div>
    </td>
  );
}

function StageSummaryCell({ data, label }: { data: PonStageData; label: string }) {
  return (
    <div className="flex flex-col items-center p-3 bg-[var(--ff-bg-secondary)] rounded-lg">
      <span className="text-xs text-[var(--ff-text-secondary)] mb-1">{label}</span>
      <span className={`text-lg font-bold ${getStageTextColor(data.pct)}`}>
        {data.pct}%
      </span>
      <span className="text-xs text-[var(--ff-text-secondary)]">
        {data.complete}/{data.total}
      </span>
      <div className="w-full bg-gray-700 rounded-full h-1.5 mt-1">
        <div
          className={`h-1.5 rounded-full ${getStageColor(data.pct)}`}
          style={{ width: `${Math.min(data.pct, 100)}%` }}
        />
      </div>
    </div>
  );
}

function ZoneSection({ zone, isExpanded, onToggle }: {
  zone: ZoneStageNode;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      {/* Zone header row */}
      <tr
        className="bg-[var(--ff-bg-secondary)] cursor-pointer hover:bg-[var(--ff-bg-tertiary)] transition-colors"
        onClick={onToggle}
      >
        <td className="px-3 py-2 font-medium text-[var(--ff-text-primary)]">
          <div className="flex items-center gap-2">
            <span className="text-xs">{isExpanded ? '\u25BC' : '\u25B6'}</span>
            <span>{zone.zone_name}</span>
            <span className="text-xs text-[var(--ff-text-secondary)]">
              ({zone.pons.length} PONs)
            </span>
          </div>
        </td>
        {BUILD_STAGES.map(stage => (
          <StageCell key={stage} data={zone.stages[stage]} />
        ))}
      </tr>

      {/* PON rows */}
      {isExpanded && zone.pons.map(pon => (
        <tr
          key={`${zone.zone_no}-${pon.pon_no}`}
          className="border-b border-[var(--ff-border-light)] hover:bg-[var(--ff-bg-tertiary)] transition-colors"
        >
          <td className="px-3 py-2 pl-8 text-sm text-[var(--ff-text-secondary)]">
            PON {pon.pon_no}
          </td>
          {BUILD_STAGES.map(stage => (
            <StageCell key={stage} data={pon[stage]} />
          ))}
        </tr>
      ))}
    </>
  );
}

export function PonStageTracker({ projectId }: PonStageTrackerProps) {
  const [data, setData] = useState<PonStagesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedZones, setExpandedZones] = useState<Set<number>>(new Set());
  const [hideInactive, setHideInactive] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/projects/${projectId}/pon-stages`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`);
      const json = await res.json();
      setData(json);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load PON stages');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const toggleZone = (zoneNo: number) => {
    setExpandedZones(prev => {
      const next = new Set(prev);
      if (next.has(zoneNo)) {
        next.delete(zoneNo);
      } else {
        next.add(zoneNo);
      }
      return next;
    });
  };

  const expandAll = () => {
    setExpandedZones(new Set(filteredHierarchy.map(z => z.zone_no)));
  };

  const collapseAll = () => {
    setExpandedZones(new Set());
  };

  const isPonActive = (pon: PonStageRow) =>
    BUILD_STAGES.some(s => pon[s].complete > 0);

  const filteredHierarchy = useMemo(() => {
    if (!data || !hideInactive) return data?.hierarchy ?? [];
    return data.hierarchy
      .map(zone => ({
        ...zone,
        pons: zone.pons.filter(isPonActive),
        stages: zone.pons.filter(isPonActive).length > 0
          ? zone.stages
          : zone.stages,
      }))
      .filter(zone => zone.pons.length > 0);
  }, [data, hideInactive]);

  const activePonCount = useMemo(() => {
    if (!data) return 0;
    return data.hierarchy.reduce(
      (sum, z) => sum + z.pons.filter(isPonActive).length, 0
    );
  }, [data]);

  if (loading) {
    return (
      <div className="bg-[var(--ff-card-bg)] rounded-lg border border-[var(--ff-border-light)] p-8">
        <div className="flex items-center justify-center gap-3">
          <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-blue-500" />
          <span className="text-[var(--ff-text-secondary)]">Loading PON stages...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-[var(--ff-card-bg)] rounded-lg border border-red-500/30 p-6">
        <p className="text-red-400">{error}</p>
        <button
          onClick={fetchData}
          className="mt-3 px-4 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!data || data.flat.length === 0) {
    return (
      <div className="bg-[var(--ff-card-bg)] rounded-lg border border-[var(--ff-border-light)] p-8 text-center">
        <p className="text-[var(--ff-text-secondary)]">
          No PON stage data available. Run a 1Map sync to populate.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="bg-[var(--ff-card-bg)] rounded-lg border border-[var(--ff-border-light)] p-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">
              PON Stage Tracker
            </h3>
            <p className="text-sm text-[var(--ff-text-secondary)]">
              {data.summary.total_pons} PONs across {data.hierarchy.length} zones
              {data.summary.last_synced && (
                <span className="ml-2">
                  | Last synced: {new Date(data.summary.last_synced).toLocaleString('en-ZA')}
                </span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 cursor-pointer text-xs text-[var(--ff-text-secondary)]">
              <input
                type="checkbox"
                checked={hideInactive}
                onChange={(e) => setHideInactive(e.target.checked)}
                className="rounded border-gray-600 bg-gray-700 text-blue-500 focus:ring-blue-500 focus:ring-offset-0"
              />
              Hide inactive ({data.summary.total_pons - activePonCount})
            </label>
            <button
              onClick={expandAll}
              className="px-3 py-1.5 text-xs bg-[var(--ff-bg-secondary)] text-[var(--ff-text-secondary)] rounded hover:bg-[var(--ff-bg-tertiary)]"
            >
              Expand All
            </button>
            <button
              onClick={collapseAll}
              className="px-3 py-1.5 text-xs bg-[var(--ff-bg-secondary)] text-[var(--ff-text-secondary)] rounded hover:bg-[var(--ff-bg-tertiary)]"
            >
              Collapse All
            </button>
          </div>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-6 gap-3">
          {BUILD_STAGES.map(stage => (
            <StageSummaryCell
              key={stage}
              data={data.summary.stages[stage]}
              label={BUILD_STAGE_META[stage].label}
            />
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="bg-[var(--ff-card-bg)] rounded-lg border border-[var(--ff-border-light)] overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--ff-border-light)]">
              <th className="px-3 py-3 text-left text-[var(--ff-text-secondary)] font-medium w-48">
                Zone / PON
              </th>
              {BUILD_STAGES.map(stage => (
                <th
                  key={stage}
                  className="px-3 py-3 text-center text-[var(--ff-text-secondary)] font-medium"
                >
                  {BUILD_STAGE_META[stage].label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredHierarchy.map(zone => (
              <ZoneSection
                key={zone.zone_no}
                zone={zone}
                isExpanded={expandedZones.has(zone.zone_no)}
                onToggle={() => toggleZone(zone.zone_no)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default PonStageTracker;

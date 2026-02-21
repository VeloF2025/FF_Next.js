/**
 * PON Stage Tracker Component
 *
 * Displays build pipeline progress per PON across 6 stages:
 * Permissions -> Poles -> CWC -> Optical -> ATP -> Activation
 *
 * Rows = PONs (grouped by zone accordion)
 * Columns = 6 stages with completion bars
 *
 * WCAG 2.1 AA — refactored 2026-02-21
 *   Uses ProgressBar from @/components/accessible
 *   Zone rows: aria-expanded + aria-controls (expandable table row pattern)
 *   Table headers: scope="col"
 *   Buttons: type="button" + focus rings
 *   Checkbox label: htmlFor/id properly linked
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
import { ProgressBar, STAGE_THRESHOLDS } from '@/components/accessible';

interface PonStageTrackerProps {
  projectId: string;
}

// ─── StageCell ────────────────────────────────────────────────────────────────

function StageCell({
  data,
  stageLabel,
  ponLabel,
}: {
  data: PonStageData;
  stageLabel: string;
  ponLabel: string;
}) {
  return (
    <td className="px-3 py-2 text-center">
      <div className="flex flex-col items-center gap-1">
        <span
          className="text-xs font-medium"
          aria-hidden="true"
          style={{
            color:
              data.pct === 0
                ? 'var(--ff-text-secondary)'
                : data.pct < 25
                ? '#f87171' // red-400
                : data.pct < 75
                ? '#fbbf24' // amber-400
                : '#34d399', // emerald-400
          }}
        >
          {data.complete}/{data.total}
        </span>

        <ProgressBar
          value={data.pct}
          label={`${stageLabel} — ${ponLabel}`}
          thresholds={STAGE_THRESHOLDS}
          size="xs"
          className="w-full"
        />

        <span className="text-[10px] text-[var(--ff-text-secondary)]" aria-hidden="true">
          {data.pct}%
        </span>
      </div>
    </td>
  );
}

// ─── StageSummaryCell ─────────────────────────────────────────────────────────

function StageSummaryCell({ data, label }: { data: PonStageData; label: string }) {
  const labelId = `summary-label-${label.toLowerCase().replace(/\s+/g, '-')}`;
  return (
    <div className="flex flex-col items-center p-3 bg-[var(--ff-bg-secondary)] rounded-lg">
      <span id={labelId} className="text-xs text-[var(--ff-text-secondary)] mb-1">
        {label}
      </span>
      <span
        className="text-lg font-bold"
        aria-label={`${label}: ${data.pct}%`}
        style={{
          color:
            data.pct === 0
              ? 'var(--ff-text-secondary)'
              : data.pct < 25
              ? '#f87171'
              : data.pct < 75
              ? '#fbbf24'
              : '#34d399',
        }}
      >
        {data.pct}%
      </span>
      <span className="text-xs text-[var(--ff-text-secondary)]">
        {data.complete}/{data.total}
      </span>
      <ProgressBar
        value={data.pct}
        labelledById={labelId}
        thresholds={STAGE_THRESHOLDS}
        size="xs"
        className="mt-1"
      />
    </div>
  );
}

// ─── ZoneSection ─────────────────────────────────────────────────────────────

function ZoneSection({
  zone,
  isExpanded,
  onToggle,
}: {
  zone: ZoneStageNode;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  // Unique id for the PON rows group so aria-controls can reference it
  const ponGroupId = `zone-pons-${zone.zone_no}`;

  return (
    <>
      {/* Zone header row — expandable */}
      <tr
        className="bg-[var(--ff-bg-secondary)] cursor-pointer hover:bg-[var(--ff-bg-tertiary)] transition-colors focus-within:ring-2 focus-within:ring-inset focus-within:ring-[var(--ff-accent)]"
      >
        <td className="px-3 py-2 font-medium text-[var(--ff-text-primary)]">
          {/*
            Button inside <td> keeps the <tr> as a plain layout container.
            Expandable table-row WCAG pattern: aria-expanded + aria-controls on the trigger.
          */}
          <button
            type="button"
            aria-expanded={isExpanded}
            aria-controls={ponGroupId}
            onClick={onToggle}
            className="flex items-center gap-2 w-full text-left focus:outline-none focus:ring-2 focus:ring-[var(--ff-accent)] rounded"
          >
            <svg
              className={`w-3 h-3 text-[var(--ff-text-secondary)] transition-transform flex-shrink-0 ${
                isExpanded ? 'rotate-90' : ''
              }`}
              fill="currentColor"
              viewBox="0 0 20 20"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
                clipRule="evenodd"
              />
            </svg>
            <span>{zone.zone_name}</span>
            <span className="text-xs text-[var(--ff-text-secondary)]">
              ({zone.pons.length} PON{zone.pons.length !== 1 ? 's' : ''})
            </span>
          </button>
        </td>
        {BUILD_STAGES.map((stage) => (
          <StageCell
            key={stage}
            data={zone.stages[stage]}
            stageLabel={BUILD_STAGE_META[stage].label}
            ponLabel={zone.zone_name}
          />
        ))}
      </tr>

      {/* PON rows — grouped with id for aria-controls */}
      {isExpanded &&
        zone.pons.map((pon) => (
          <tr
            key={`${zone.zone_no}-${pon.pon_no}`}
            id={`${ponGroupId}-pon-${pon.pon_no}`}
            className="border-b border-[var(--ff-border-light)] hover:bg-[var(--ff-bg-tertiary)] transition-colors"
          >
            <td className="px-3 py-2 pl-8 text-sm text-[var(--ff-text-secondary)]">
              PON {pon.pon_no}
            </td>
            {BUILD_STAGES.map((stage) => (
              <StageCell
                key={stage}
                data={pon[stage]}
                stageLabel={BUILD_STAGE_META[stage].label}
                ponLabel={`PON ${pon.pon_no}`}
              />
            ))}
          </tr>
        ))}
    </>
  );
}

// ─── PonStageTracker ──────────────────────────────────────────────────────────

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
    setExpandedZones((prev) => {
      const next = new Set(prev);
      if (next.has(zoneNo)) next.delete(zoneNo);
      else next.add(zoneNo);
      return next;
    });
  };

  const expandAll = () =>
    setExpandedZones(new Set(filteredHierarchy.map((z) => z.zone_no)));

  const collapseAll = () => setExpandedZones(new Set());

  const isPonActive = (pon: PonStageRow) =>
    BUILD_STAGES.some((s) => pon[s].complete > 0);

  const filteredHierarchy = useMemo(() => {
    if (!data || !hideInactive) return data?.hierarchy ?? [];
    return data.hierarchy
      .map((zone) => ({ ...zone, pons: zone.pons.filter(isPonActive) }))
      .filter((zone) => zone.pons.length > 0);
  }, [data, hideInactive]);

  const activePonCount = useMemo(() => {
    if (!data) return 0;
    return data.hierarchy.reduce(
      (sum, z) => sum + z.pons.filter(isPonActive).length,
      0,
    );
  }, [data]);

  // ── Loading / error / empty ─────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="bg-[var(--ff-card-bg)] rounded-lg border border-[var(--ff-border-light)] p-8">
        <div className="flex items-center justify-center gap-3">
          <div
            className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-blue-500"
            role="status"
            aria-label="Loading PON stages"
          />
          <span className="text-[var(--ff-text-secondary)]">Loading PON stages...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="bg-[var(--ff-card-bg)] rounded-lg border border-red-500/30 p-6"
        role="alert"
      >
        <p className="text-red-400">{error}</p>
        <button
          type="button"
          onClick={fetchData}
          className="mt-3 px-4 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
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

  const titleId = 'pon-tracker-title';

  return (
    <div className="space-y-4">
      {/* ── Header ── */}
      <div className="bg-[var(--ff-card-bg)] rounded-lg border border-[var(--ff-border-light)] p-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 id={titleId} className="text-lg font-semibold text-[var(--ff-text-primary)]">
              PON Stage Tracker
            </h3>
            <p className="text-sm text-[var(--ff-text-secondary)]">
              {data.summary.total_pons} PONs across {data.hierarchy.length} zones
              {data.summary.last_synced && (
                <span className="ml-2">
                  | Last synced:{' '}
                  {new Date(data.summary.last_synced).toLocaleString('en-ZA')}
                </span>
              )}
            </p>
          </div>

          <div className="flex items-center gap-3">
            {/* WCAG: label properly linked via htmlFor/id */}
            <label
              htmlFor="hide-inactive-checkbox"
              className="flex items-center gap-1.5 cursor-pointer text-xs text-[var(--ff-text-secondary)]"
            >
              <input
                type="checkbox"
                id="hide-inactive-checkbox"
                checked={hideInactive}
                onChange={(e) => setHideInactive(e.target.checked)}
                className="rounded border-gray-600 bg-gray-700 text-blue-500 focus:ring-2 focus:ring-[var(--ff-accent)] focus:ring-offset-0"
              />
              Hide inactive ({data.summary.total_pons - activePonCount})
            </label>

            <button
              type="button"
              onClick={expandAll}
              className="px-3 py-1.5 text-xs bg-[var(--ff-bg-secondary)] text-[var(--ff-text-secondary)] rounded hover:bg-[var(--ff-bg-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-accent)]"
            >
              Expand All
            </button>
            <button
              type="button"
              onClick={collapseAll}
              className="px-3 py-1.5 text-xs bg-[var(--ff-bg-secondary)] text-[var(--ff-text-secondary)] rounded hover:bg-[var(--ff-bg-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-accent)]"
            >
              Collapse All
            </button>
          </div>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-6 gap-3" role="list" aria-label="Stage summary">
          {BUILD_STAGES.map((stage) => (
            <div key={stage} role="listitem">
              <StageSummaryCell
                data={data.summary.stages[stage]}
                label={BUILD_STAGE_META[stage].label}
              />
            </div>
          ))}
        </div>
      </div>

      {/* ── Table ── */}
      <div className="bg-[var(--ff-card-bg)] rounded-lg border border-[var(--ff-border-light)] overflow-x-auto">
        <table className="w-full text-sm" aria-labelledby={titleId}>
          <thead>
            <tr className="border-b border-[var(--ff-border-light)]">
              {/* WCAG: scope="col" on all headers */}
              <th
                scope="col"
                className="px-3 py-3 text-left text-[var(--ff-text-secondary)] font-medium w-48"
              >
                Zone / PON
              </th>
              {BUILD_STAGES.map((stage) => (
                <th
                  key={stage}
                  scope="col"
                  className="px-3 py-3 text-center text-[var(--ff-text-secondary)] font-medium"
                >
                  {BUILD_STAGE_META[stage].label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredHierarchy.map((zone) => (
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

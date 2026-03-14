/**
 * PON Progress Tracker (Build > Progress)
 *
 * Working page for daily PON progress tracking across 4 categories:
 * CWC, Optical, Activation, Maintenance
 *
 * Replaces the manual spreadsheet tracking from:
 * - VF_Project_Tracker (PON Tracker sheet)
 * - Operations Targets (monthly targets)
 * - Johan's Optical Tracker (daily activity log)
 */

import { useState, useEffect, useCallback } from 'react';
import type { PonProgressResponse, ProgressCategory } from '@/types/pon-stages.types';
import { ProgressSummaryCards } from './ProgressSummaryCards';
import { DailyLogPanel } from './DailyLogPanel';
import { ZoneSection } from './ProgressTableRows';

interface PonProgressTrackerProps {
  projectId: string;
}

const CATEGORIES: ProgressCategory[] = ['cwc', 'optical', 'activation', 'maintenance'];
const CATEGORY_LABELS: Record<ProgressCategory, string> = {
  cwc: 'CWC', optical: 'Optical', activation: 'Activation', maintenance: 'Maintenance',
};

export function PonProgressTracker({ projectId }: PonProgressTrackerProps) {
  const [data, setData] = useState<PonProgressResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedZones, setExpandedZones] = useState<Set<number>>(new Set());
  const [logPanel, setLogPanel] = useState<{ ponStageId: string; ponLabel: string } | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/projects/${projectId}/pon-progress`, { credentials: 'include' });
      if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`);
      const json = await res.json();
      setData(json);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load progress');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const toggleZone = (zoneNo: number) => {
    setExpandedZones((prev) => {
      const next = new Set(prev);
      if (next.has(zoneNo)) next.delete(zoneNo);
      else next.add(zoneNo);
      return next;
    });
  };

  const expandAll = () => setExpandedZones(new Set(data?.zones.map((z) => z.zone_no) || []));
  const collapseAll = () => setExpandedZones(new Set());

  if (loading) {
    return (
      <div className="bg-[var(--ff-card-bg)] rounded-lg border border-[var(--ff-border-light)] p-8">
        <div className="flex items-center justify-center gap-3">
          <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-blue-500" />
          <span className="text-[var(--ff-text-secondary)]">Loading progress...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-[var(--ff-card-bg)] rounded-lg border border-red-500/30 p-6">
        <p className="text-red-400">{error}</p>
        <button type="button" onClick={fetchData} className="mt-3 px-4 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700">
          Retry
        </button>
      </div>
    );
  }

  if (!data || data.zones.length === 0) {
    return (
      <div className="bg-[var(--ff-card-bg)] rounded-lg border border-[var(--ff-border-light)] p-8 text-center">
        <p className="text-[var(--ff-text-secondary)]">No PON data available. Run a 1Map sync to populate.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ProgressSummaryCards summary={data.summary} />

      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">PON Progress</h3>
        <div className="flex items-center gap-2">
          <button type="button" onClick={expandAll} className="px-3 py-1.5 text-xs bg-[var(--ff-bg-secondary)] text-[var(--ff-text-secondary)] rounded hover:bg-[var(--ff-bg-tertiary)]">
            Expand All
          </button>
          <button type="button" onClick={collapseAll} className="px-3 py-1.5 text-xs bg-[var(--ff-bg-secondary)] text-[var(--ff-text-secondary)] rounded hover:bg-[var(--ff-bg-tertiary)]">
            Collapse All
          </button>
        </div>
      </div>

      <div className="bg-[var(--ff-card-bg)] rounded-lg border border-[var(--ff-border-light)] overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--ff-border-light)]">
              <th scope="col" className="px-3 py-3 text-left text-[var(--ff-text-secondary)] font-medium w-32">PON</th>
              <th scope="col" className="px-2 py-3 text-left text-[var(--ff-text-secondary)] font-medium w-36">Blockage</th>
              {CATEGORIES.map((cat) => (
                <th key={cat} scope="col" className="px-2 py-3 text-center text-[var(--ff-text-secondary)] font-medium">
                  {CATEGORY_LABELS[cat]}
                </th>
              ))}
              <th scope="col" className="px-2 py-3 text-center text-[var(--ff-text-secondary)] font-medium w-16">Log</th>
            </tr>
          </thead>
          <tbody>
            {data.zones.map((zone) => (
              <ZoneSection
                key={zone.zone_no}
                zone={zone}
                isExpanded={expandedZones.has(zone.zone_no)}
                onToggle={() => toggleZone(zone.zone_no)}
                projectId={projectId}
                onRefresh={fetchData}
                onOpenLog={(ponStageId, ponLabel) => setLogPanel({ ponStageId, ponLabel })}
              />
            ))}
          </tbody>
        </table>
      </div>

      {logPanel && (
        <DailyLogPanel
          projectId={projectId}
          ponStageId={logPanel.ponStageId}
          ponLabel={logPanel.ponLabel}
          onClose={() => setLogPanel(null)}
        />
      )}
    </div>
  );
}

export default PonProgressTracker;

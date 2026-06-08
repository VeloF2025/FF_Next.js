import { useState } from 'react';
import { ChevronDown, ChevronRight, Clock, Check } from 'lucide-react';
import { useRecentSubmissions } from '../hooks/useRecentSubmissions';
import { RecentLaneSection } from './RecentLaneSection';
import type { RecentDiscipline, RecentWindow } from '../types/works-qa.types';

interface Props {
  onDrill: (projectId: string, zoneNo: number | null, ponNo: number) => void;
}

const LANE_TITLES: Record<RecentDiscipline, string> = {
  civil: 'Civil (planting)',
  dome: 'Optical — Dome',
  main_joint: 'Main Joint',
};

const WINDOWS: { key: RecentWindow; label: string }[] = [
  { key: 'since_last', label: 'Since last opened' },
  { key: '3d', label: '3 days' },
  { key: '7d', label: '7 days' },
];

export function RecentSubmissionsPanel({ onDrill }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const { recent, error, isLoading, window, setWindow, markCaughtUp } = useRecentSubmissions();

  const totalReady = recent
    ? recent.lanes.civil.readyPoles + recent.lanes.dome.readyPoles + recent.lanes.main_joint.readyPoles
    : 0;

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/30">
      <div className="flex items-center justify-between flex-wrap gap-2 px-3 py-2">
        <button
          type="button"
          onClick={() => setCollapsed(c => !c)}
          aria-expanded={!collapsed}
          className="flex items-center gap-2 text-sm font-semibold text-zinc-100"
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          <Clock className="h-4 w-4 text-teal-400" />
          Recent submissions
          {!isLoading && <span className="text-xs font-normal text-teal-400">{totalReady} ready to QA</span>}
        </button>

        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-md border border-zinc-700 overflow-hidden" role="group" aria-label="Recent window">
            {WINDOWS.map(w => (
              <button
                key={w.key}
                type="button"
                aria-pressed={window === w.key}
                onClick={() => setWindow(w.key)}
                className={`px-2 py-1 text-xs transition-colors ${
                  window === w.key ? 'bg-teal-700 text-white' : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800'
                }`}
              >
                {w.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => void markCaughtUp()}
            title="Reset the 'since I last opened' marker to now"
            className="inline-flex items-center gap-1 px-2 py-1 text-xs text-zinc-400 hover:text-zinc-100 border border-zinc-700 rounded-md hover:bg-zinc-800 transition-colors"
          >
            <Check className="h-3 w-3" /> Mark caught up
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="px-3 pb-3 space-y-2">
          {recent?.asOf && (
            <p className="text-[11px] text-zinc-600">
              As of {new Date(recent.asOf).toLocaleString()} · reflects last QField sync
            </p>
          )}
          {error ? (
            <p className="text-xs text-red-400 py-2">Could not load recent submissions.</p>
          ) : isLoading || !recent ? (
            <p className="text-xs text-zinc-600 py-2">Loading…</p>
          ) : (
            (['civil', 'dome', 'main_joint'] as RecentDiscipline[]).map(d => (
              <RecentLaneSection
                key={d}
                title={LANE_TITLES[d]}
                lane={recent.lanes[d]}
                watermarkAt={recent.watermarkAt}
                onDrill={onDrill}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

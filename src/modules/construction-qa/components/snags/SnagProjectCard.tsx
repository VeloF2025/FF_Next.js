/**
 * SnagProjectCard — Dashboard card per project.
 * Shows project name, total snags, status breakdown, and latest report info.
 */

'use client';

import { AlertTriangle, ChevronRight } from 'lucide-react';
import type { SnagProjectStats } from '../../types/snag.types';

interface SnagProjectCardProps {
  stats: SnagProjectStats;
  onClick: () => void;
}

interface StatusBarProps {
  open: number;
  inProgress: number;
  pendingQa: number;
  resolved: number;
  verified: number;
  total: number;
}

function StatusBar({ open, inProgress, pendingQa, resolved, verified, total }: StatusBarProps) {
  if (total === 0) {
    return <div className="h-1.5 bg-zinc-800 rounded-full" />;
  }
  const openPct    = Math.round((open / total) * 100);
  const ipPct      = Math.round((inProgress / total) * 100);
  const pqaPct     = Math.round((pendingQa / total) * 100);
  const resPct     = Math.round((resolved / total) * 100);
  const verPct     = Math.round((verified / total) * 100);

  return (
    <div className="flex h-1.5 rounded-full overflow-hidden bg-zinc-800 gap-px">
      {openPct > 0    && <div className="bg-red-500"    style={{ width: `${openPct}%` }} />}
      {ipPct > 0      && <div className="bg-yellow-500" style={{ width: `${ipPct}%` }} />}
      {pqaPct > 0     && <div className="bg-orange-500" style={{ width: `${pqaPct}%` }} />}
      {resPct > 0     && <div className="bg-blue-500"   style={{ width: `${resPct}%` }} />}
      {verPct > 0     && <div className="bg-green-500"  style={{ width: `${verPct}%` }} />}
    </div>
  );
}

/** 🟢 WORKING: Dashboard project card */
export function SnagProjectCard({ stats, onClick }: SnagProjectCardProps) {
  const latestDate = stats.latest_report_date
    ? new Date(stats.latest_report_date).toLocaleDateString('en-ZA')
    : null;

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded-lg p-4 transition-colors group"
    >
      {/* Project name + arrow */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-orange-400 shrink-0" />
          <h3 className="text-sm font-semibold text-zinc-100 truncate">{stats.project_name}</h3>
        </div>
        <ChevronRight className="h-4 w-4 text-zinc-600 group-hover:text-zinc-400 transition-colors shrink-0" />
      </div>

      {/* Total count */}
      <div className="mb-3">
        <span className="text-2xl font-bold text-zinc-100">{stats.total}</span>
        <span className="text-xs text-zinc-500 ml-1">snags</span>
      </div>

      {/* Status bar */}
      <StatusBar
        open={stats.open + stats.assigned}
        inProgress={stats.in_progress}
        pendingQa={stats.pending_qa}
        resolved={stats.resolved}
        verified={stats.verified + stats.closed}
        total={stats.total}
      />

      {/* Status pills */}
      <div className="flex flex-wrap gap-1.5 mt-2.5">
        {stats.open > 0 && (
          <span className="text-xs bg-red-900/50 text-red-300 px-1.5 py-0.5 rounded">
            {stats.open} open
          </span>
        )}
        {stats.in_progress > 0 && (
          <span className="text-xs bg-yellow-900/50 text-yellow-300 px-1.5 py-0.5 rounded">
            {stats.in_progress} in progress
          </span>
        )}
        {stats.pending_qa > 0 && (
          <span className="text-xs bg-orange-900/50 text-orange-300 px-1.5 py-0.5 rounded">
            {stats.pending_qa} pending QA
          </span>
        )}
        {stats.resolved > 0 && (
          <span className="text-xs bg-blue-900/50 text-blue-300 px-1.5 py-0.5 rounded">
            {stats.resolved} resolved
          </span>
        )}
        {stats.verified > 0 && (
          <span className="text-xs bg-green-900/50 text-green-300 px-1.5 py-0.5 rounded">
            {stats.verified} verified
          </span>
        )}
      </div>

      {/* Latest report */}
      {stats.latest_report_number && (
        <p className="text-xs text-zinc-500 mt-2.5 border-t border-zinc-800 pt-2">
          Latest: {stats.latest_report_number}
          {latestDate && <span className="ml-1">— {latestDate}</span>}
        </p>
      )}
    </button>
  );
}

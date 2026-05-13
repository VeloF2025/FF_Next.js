import { Camera, ChevronRight } from 'lucide-react';
import type { WorksQAProjectStats } from '../types/works-qa.types';

interface WorksQAProjectCardProps {
  stats: WorksQAProjectStats;
  onClick: () => void;
}

function ProgressBar({ approved, ready, in_progress, empty, total }: {
  approved: number; ready: number; in_progress: number; empty: number; total: number;
}) {
  if (total === 0) return <div className="h-1.5 bg-zinc-800 rounded-full" />;
  const approvedPct = Math.round((approved / total) * 100);
  const readyPct = Math.round((ready / total) * 100);
  const ipPct = Math.round((in_progress / total) * 100);
  const emptyPct = Math.round((empty / total) * 100);
  return (
    <div className="flex h-1.5 rounded-full overflow-hidden bg-zinc-800 gap-px">
      {approvedPct > 0 && <div className="bg-green-500" style={{ width: `${approvedPct}%` }} />}
      {readyPct > 0 && <div className="bg-teal-500" style={{ width: `${readyPct}%` }} />}
      {ipPct > 0 && <div className="bg-yellow-500" style={{ width: `${ipPct}%` }} />}
      {emptyPct > 0 && <div className="bg-zinc-700" style={{ width: `${emptyPct}%` }} />}
    </div>
  );
}

export function WorksQAProjectCard({ stats, onClick }: WorksQAProjectCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded-lg p-4 transition-colors group"
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <Camera className="h-4 w-4 text-teal-400 shrink-0" />
          <h3 className="text-sm font-semibold text-zinc-100 truncate">{stats.project_name}</h3>
        </div>
        <ChevronRight className="h-4 w-4 text-zinc-600 group-hover:text-zinc-400 transition-colors shrink-0" />
      </div>

      <div className="mb-3">
        <span className="text-2xl font-bold text-zinc-100">{stats.total}</span>
        <span className="text-xs text-zinc-500 ml-1">poles</span>
      </div>

      <ProgressBar
        approved={stats.approved}
        ready={stats.ready}
        in_progress={stats.in_progress}
        empty={stats.empty}
        total={stats.total}
      />

      <div className="flex flex-wrap gap-1.5 mt-2.5">
        {stats.approved > 0 && (
          <span className="text-xs bg-green-900/50 text-green-300 px-1.5 py-0.5 rounded">
            {stats.approved} approved
          </span>
        )}
        {stats.ready > 0 && (
          <span className="text-xs bg-teal-900/50 text-teal-300 px-1.5 py-0.5 rounded">
            {stats.ready} ready
          </span>
        )}
        {stats.in_progress > 0 && (
          <span className="text-xs bg-yellow-900/50 text-yellow-300 px-1.5 py-0.5 rounded">
            {stats.in_progress} in progress
          </span>
        )}
        {stats.empty > 0 && (
          <span className="text-xs bg-zinc-800 text-zinc-400 px-1.5 py-0.5 rounded">
            {stats.empty} empty
          </span>
        )}
        {stats.pending_vlm > 0 && (
          <span className="text-xs bg-red-900/50 text-red-300 px-1.5 py-0.5 rounded">
            {stats.pending_vlm} VLM ⚠
          </span>
        )}
      </div>

      {stats.project_code && (
        <p className="text-xs text-zinc-500 mt-2.5 border-t border-zinc-800 pt-2">
          {stats.project_code}
        </p>
      )}
    </button>
  );
}

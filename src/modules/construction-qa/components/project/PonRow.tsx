/**
 * PON Row
 *
 * Single PON inside an expanded zone accordion.
 * Shows PON number, feature count, stage badge, discipline counts.
 * Click → select this PON to show its features.
 */

'use client';

import type { PonQaSummary } from '../../types/dashboard.types';

interface PonRowProps {
  pon: PonQaSummary;
  selected: boolean;
  onSelect: () => void;
}

const STAGE_COLORS: Record<string, string> = {
  not_started: 'bg-gray-600 text-gray-300',
  permissions: 'bg-purple-500/20 text-purple-400',
  poles: 'bg-blue-500/20 text-blue-400',
  cwc: 'bg-cyan-500/20 text-cyan-400',
  optical: 'bg-amber-500/20 text-amber-400',
  atp: 'bg-orange-500/20 text-orange-400',
  activation: 'bg-green-500/20 text-green-400',
  complete: 'bg-green-600/30 text-green-300',
};

export function PonRow({ pon, selected, onSelect }: PonRowProps) {
  const approvalPct = pon.total > 0 ? Math.round((pon.approved / pon.total) * 100) : 0;

  return (
    <button
      onClick={onSelect}
      className={`w-full flex items-center gap-3 px-4 py-2.5 pl-12 text-left transition-colors ${
        selected
          ? 'bg-blue-500/10 border-l-2 border-blue-500'
          : 'hover:bg-[var(--hover-bg)] border-l-2 border-transparent'
      }`}
    >
      <span className="text-sm font-medium text-gray-300 min-w-[50px]">
        P{pon.pon_no}
      </span>

      {/* Mini progress bar */}
      <div className="flex-1 max-w-[150px]">
        <div className="w-full h-1.5 bg-gray-700 rounded-full overflow-hidden flex">
          {pon.total > 0 && (
            <>
              <div
                className="h-full bg-green-500"
                style={{ width: `${approvalPct}%` }}
              />
              <div
                className="h-full bg-red-500"
                style={{ width: `${(pon.rejected / pon.total) * 100}%` }}
              />
            </>
          )}
        </div>
      </div>

      <span className="text-xs text-gray-400 min-w-[70px]">
        {pon.total} features
      </span>

      {/* Discipline counts */}
      <div className="flex items-center gap-2 text-xs text-gray-500">
        {pon.civil_count > 0 && <span>C:{pon.civil_count}</span>}
        {pon.optical_count > 0 && <span>O:{pon.optical_count}</span>}
        {pon.splicing_count > 0 && <span>S:{pon.splicing_count}</span>}
      </div>

      {/* Stage badge */}
      {pon.overall_stage && (
        <span className={`px-2 py-0.5 rounded text-xs font-medium ${STAGE_COLORS[pon.overall_stage] || 'bg-gray-600 text-gray-300'}`}>
          {pon.overall_stage.replace('_', ' ')}
        </span>
      )}
    </button>
  );
}

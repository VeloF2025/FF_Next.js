/**
 * Risk Matrix - 5x5 visual heatmap of likelihood vs severity
 */

import React from 'react';
import { LIKELIHOOD_SCALE, SEVERITY_SCALE } from '@/modules/health-safety/types/risk.types';

interface MatrixCell {
  likelihood: number;
  severity: number;
  count: number;
}

interface RiskMatrixProps {
  data: MatrixCell[];
  onCellClick?: (likelihood: number, severity: number) => void;
}

function getCellColor(l: number, s: number): string {
  const score = l * s;
  if (score >= 20) return 'bg-red-600 hover:bg-red-500';
  if (score >= 15) return 'bg-red-500 hover:bg-red-400';
  if (score >= 12) return 'bg-orange-500 hover:bg-orange-400';
  if (score >= 8) return 'bg-amber-500 hover:bg-amber-400';
  if (score >= 6) return 'bg-yellow-500 hover:bg-yellow-400';
  if (score >= 4) return 'bg-yellow-400 hover:bg-yellow-300';
  if (score >= 2) return 'bg-green-400 hover:bg-green-300';
  return 'bg-green-500 hover:bg-green-400';
}

export function RiskMatrix({ data, onCellClick }: RiskMatrixProps) {
  const countMap = new Map<string, number>();
  for (const cell of data) {
    countMap.set(`${cell.likelihood}-${cell.severity}`, cell.count);
  }

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[400px]">
        {/* Header row */}
        <div className="grid grid-cols-[80px_repeat(5,1fr)] gap-1 mb-1">
          <div className="text-[10px] text-[var(--ff-text-tertiary)] text-center" />
          {[1, 2, 3, 4, 5].map((s) => (
            <div key={s} className="text-[10px] text-[var(--ff-text-tertiary)] text-center px-1">
              <div className="font-medium">{s}</div>
              <div className="truncate">{SEVERITY_SCALE[s]!.label}</div>
            </div>
          ))}
        </div>

        {/* Severity label */}
        <div className="text-center text-xs font-medium text-[var(--ff-text-secondary)] mb-2">
          Severity →
        </div>

        {/* Matrix rows (top = highest likelihood) */}
        {[5, 4, 3, 2, 1].map((l) => (
          <div key={l} className="grid grid-cols-[80px_repeat(5,1fr)] gap-1 mb-1">
            <div className="text-[10px] text-[var(--ff-text-tertiary)] flex items-center justify-end pr-2">
              <div className="text-right">
                <div className="font-medium">{l}</div>
                <div className="truncate">{LIKELIHOOD_SCALE[l]!.label}</div>
              </div>
            </div>
            {[1, 2, 3, 4, 5].map((s) => {
              const count = countMap.get(`${l}-${s}`) || 0;
              const score = l * s;
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => onCellClick?.(l, s)}
                  className={`${getCellColor(l, s)} rounded-md h-12 flex flex-col items-center justify-center text-white font-medium transition-colors`}
                >
                  <span className="text-xs opacity-70">{score}</span>
                  {count > 0 && (
                    <span className="text-sm font-bold">{count}</span>
                  )}
                </button>
              );
            })}
          </div>
        ))}

        {/* Likelihood label */}
        <div className="text-center text-xs font-medium text-[var(--ff-text-secondary)] mt-1">
          ↑ Likelihood
        </div>
      </div>
    </div>
  );
}

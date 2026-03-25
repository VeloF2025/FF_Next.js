/**
 * SP Tracker Blockage Summary Component
 */

import type { ReactNode } from 'react';

interface SpPonTracker {
  blockage: string | null;
}

interface BlockageSectionProps {
  pons: SpPonTracker[];
}

export function BlockageSection({ pons }: BlockageSectionProps): ReactNode {
  const blockedPons = pons.filter((p) => p.blockage && p.blockage.trim().length > 0);
  const blockageMap = new Map<string, number>();

  for (const pon of blockedPons) {
    const reason = (pon.blockage || '').trim();
    blockageMap.set(reason, (blockageMap.get(reason) || 0) + 1);
  }

  const blockedPercent = pons.length > 0 ? (blockedPons.length / pons.length) * 100 : 0;
  const blockageAlert = blockedPercent > 20;

  return (
    <div
      className={`p-4 rounded-lg border ${
        blockageAlert
          ? 'bg-red-50 border-red-200'
          : 'bg-amber-50 border-amber-200'
      }`}
    >
      <div className="flex items-center gap-2 mb-3">
        <span className="font-medium text-gray-800">
          Blockages: {blockedPons.length} PON{blockedPons.length !== 1 ? 's' : ''}
        </span>
        {blockageAlert && (
          <span className="text-xs font-medium text-red-700">⚠️ {blockedPercent.toFixed(1)}% blocked</span>
        )}
      </div>

      {blockageMap.size > 0 ? (
        <ul className="space-y-1">
          {Array.from(blockageMap.entries())
            .sort((a, b) => b[1] - a[1])
            .map(([reason, count]) => (
              <li key={reason} className="text-sm text-gray-700">
                <span className="font-medium">{count}</span> — {reason}
              </li>
            ))}
        </ul>
      ) : (
        <span className="text-sm text-gray-600">No blockages reported</span>
      )}
    </div>
  );
}

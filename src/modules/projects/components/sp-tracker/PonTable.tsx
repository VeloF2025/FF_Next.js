/**
 * SP Tracker PON Table Component
 */

import type { ReactNode } from 'react';

interface SpPonTracker {
  zone_no: number;
}

interface PonTableProps {
  pons: SpPonTracker[];
  expandedZones: Set<number>;
  onToggleZone: (zone: number) => void;
}

export function PonTable({ pons, expandedZones, onToggleZone }: PonTableProps): ReactNode {
  const zoneGroups = new Map<number, SpPonTracker[]>();
  for (const pon of pons) {
    if (!zoneGroups.has(pon.zone_no)) {
      zoneGroups.set(pon.zone_no, []);
    }
    zoneGroups.get(pon.zone_no)!.push(pon);
  }

  const sortedZones = Array.from(zoneGroups.keys()).sort((a, b) => a - b);

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="bg-gray-50 dark:bg-slate-800 border-b border-gray-200 dark:border-slate-700">
            <th scope="col" className="px-4 py-2 text-left font-medium text-gray-700 dark:text-gray-300">Zone</th>
            <th scope="col" className="px-4 py-2 text-left font-medium text-gray-700 dark:text-gray-300">PON</th>
            <th scope="col" className="px-4 py-2 text-right font-medium text-gray-700 dark:text-gray-300">Poles</th>
            <th scope="col" className="px-4 py-2 text-right font-medium text-gray-700 dark:text-gray-300">Sign-ups</th>
            <th scope="col" className="px-4 py-2 text-center font-medium text-gray-700 dark:text-gray-300">CWC</th>
            <th scope="col" className="px-4 py-2 text-center font-medium text-gray-700 dark:text-gray-300">Optical</th>
            <th scope="col" className="px-4 py-2 text-right font-medium text-gray-700 dark:text-gray-300">Activated</th>
            <th scope="col" className="px-4 py-2 text-right font-medium text-gray-700 dark:text-gray-300">Available</th>
            <th scope="col" className="px-4 py-2 text-right font-medium text-gray-700 dark:text-gray-300">Take-up %</th>
            <th scope="col" className="px-4 py-2 text-left font-medium text-gray-700 dark:text-gray-300">Blockage</th>
          </tr>
        </thead>
        <tbody>
          {sortedZones.map((zone) => {
            const isExpanded = expandedZones.has(zone);
            const zonePons = zoneGroups.get(zone) || [];
            return (
              <tr key={`zone-${zone}`}>
                <td colSpan={10} className="p-0">
                  <button
                    type="button"
                    onClick={() => onToggleZone(zone)}
                    aria-expanded={isExpanded}
                    className="w-full px-4 py-2 text-left hover:bg-gray-50 dark:hover:bg-slate-700 font-medium text-gray-800 dark:text-gray-200 border-b border-gray-200 dark:border-slate-700"
                  >
                    <span className="mr-2">{isExpanded ? '▼' : '▶'}</span>
                    Zone {zone} ({zonePons.length} PON{zonePons.length !== 1 ? 's' : ''})
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

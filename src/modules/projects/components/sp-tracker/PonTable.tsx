/**
 * SP Tracker PON Table Component
 */

import type { ReactNode } from 'react';

interface SpPonTracker {
  id: string;
  zone_no: number;
  hld_pon: number;
  scope_poles: number | null;
  sign_ups: number | null;
  cwc_qa_approved: number;
  atp_qa_approved: number;
  activated: number | null;
  available: number | null;
  pct_recon: number | null;
  blockage: string | null;
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
            const zonePons = zoneGroups.get(zone) ?? [];
            return (
              <>
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
                {isExpanded &&
                  zonePons.map((pon) => {
                    const hasBlockage = pon.blockage && pon.blockage.trim().length > 0;
                    return (
                      <tr
                        key={pon.id}
                        className={`border-b border-gray-100 dark:border-slate-800 hover:bg-gray-50 dark:hover:bg-slate-800/50 ${hasBlockage ? 'bg-red-50/30 dark:bg-red-900/10' : ''}`}
                      >
                        <td className="px-4 py-1.5 text-gray-500 dark:text-gray-400">{zone}</td>
                        <td className="px-4 py-1.5 font-mono text-xs text-gray-800 dark:text-gray-200">{pon.hld_pon}</td>
                        <td className="px-4 py-1.5 text-right text-gray-700 dark:text-gray-300">{pon.scope_poles ?? '—'}</td>
                        <td className="px-4 py-1.5 text-right text-gray-700 dark:text-gray-300">{pon.sign_ups ?? '—'}</td>
                        <td className="px-4 py-1.5 text-center">
                          <span className={`inline-block w-2 h-2 rounded-full ${pon.cwc_qa_approved ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'}`} />
                        </td>
                        <td className="px-4 py-1.5 text-center">
                          <span className={`inline-block w-2 h-2 rounded-full ${pon.atp_qa_approved ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'}`} />
                        </td>
                        <td className="px-4 py-1.5 text-right text-gray-700 dark:text-gray-300">{pon.activated ?? '—'}</td>
                        <td className="px-4 py-1.5 text-right text-gray-700 dark:text-gray-300">{pon.available ?? '—'}</td>
                        <td className="px-4 py-1.5 text-right text-gray-700 dark:text-gray-300">
                          {pon.pct_recon != null ? `${Math.round(pon.pct_recon)}%` : '—'}
                        </td>
                        <td className="px-4 py-1.5 text-xs text-red-600 dark:text-red-400 max-w-xs truncate">
                          {pon.blockage ?? ''}
                        </td>
                      </tr>
                    );
                  })}
              </>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

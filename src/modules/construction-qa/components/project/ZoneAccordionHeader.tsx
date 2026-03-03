/**
 * Zone Accordion Header
 *
 * Collapsible zone row showing zone number, feature count, and approval progress.
 */

'use client';

import { ChevronDown, ChevronRight } from 'lucide-react';
import type { ZoneNode } from '../../types/dashboard.types';

interface ZoneAccordionHeaderProps {
  zone: ZoneNode;
  expanded: boolean;
  onToggle: () => void;
}

export function ZoneAccordionHeader({ zone, expanded, onToggle }: ZoneAccordionHeaderProps) {
  const approvalPct = zone.total > 0 ? Math.round((zone.approved / zone.total) * 100) : 0;

  return (
    <button
      onClick={onToggle}
      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[var(--hover-bg)] transition-colors text-left"
    >
      {expanded ? (
        <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />
      ) : (
        <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />
      )}

      <span className={`text-sm font-semibold min-w-[80px] ${zone.zone_no === -1 ? 'text-yellow-400' : 'text-white'}`}>
        {zone.zone_no === -1 ? 'Unassigned' : `Zone ${zone.zone_no}`}
      </span>

      {/* Mini progress bar */}
      <div className="flex-1 max-w-[200px]">
        <div className="w-full h-1.5 bg-gray-700 rounded-full overflow-hidden flex">
          {zone.total > 0 && (
            <>
              <div
                className="h-full bg-green-500"
                style={{ width: `${(zone.approved / zone.total) * 100}%` }}
              />
              <div
                className="h-full bg-red-500"
                style={{ width: `${(zone.rejected / zone.total) * 100}%` }}
              />
            </>
          )}
        </div>
      </div>

      <span className="text-xs text-gray-400 min-w-[100px]">
        {zone.total} features
      </span>

      <span className="text-xs text-gray-500 min-w-[80px]">
        {approvalPct}% approved
      </span>

      <span className="text-xs text-gray-500">
        {zone.pons.length} PONs
      </span>
    </button>
  );
}

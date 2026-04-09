/**
 * SnagZoneRow — Zone-level row in the SnagSummaryPage table.
 */

import { ChevronDown, ChevronRight } from 'lucide-react';
import type { ZoneNode } from '../../types/snag.types';
import { CountCell } from './SnagSummaryHelpers';

interface SnagZoneRowProps {
  zone: ZoneNode;
  projectId: string;
  isExpanded: boolean;
  onToggle: (projectId: string, zoneNo: number | null) => void;
  onNavigate: (projectId: string, zoneNo: number | null) => void;
}

export function SnagZoneRow({
  zone: z,
  projectId,
  isExpanded,
  onToggle,
  onNavigate,
}: SnagZoneRowProps) {
  return (
    <tr className="bg-[var(--ff-bg-tertiary)]/30 hover:bg-[var(--ff-bg-hover)] transition-colors">
      <td className="px-3 py-2 text-xs whitespace-nowrap pl-6">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onToggle(projectId, z.zoneNo)}
            className="flex-shrink-0 text-zinc-500 hover:text-zinc-300 transition-colors"
            aria-label={isExpanded ? 'Collapse zone' : 'Expand zone'}
          >
            {isExpanded
              ? <ChevronDown className="w-3.5 h-3.5" />
              : <ChevronRight className="w-3.5 h-3.5" />
            }
          </button>
          <button
            type="button"
            onClick={() => onNavigate(projectId, z.zoneNo)}
            className="text-blue-400 hover:text-blue-300 hover:underline text-left"
          >
            {z.label}
          </button>
        </div>
      </td>

      <td className="px-3 py-2 text-xs tabular-nums whitespace-nowrap text-right bg-zinc-100/5">
        <span className="font-medium text-zinc-200">{z.total}</span>
      </td>

      <CountCell value={z.open}        colorClass="text-red-300"    bgClass="bg-red-900/20" />
      <CountCell value={z.assigned}    colorClass="text-amber-300"  bgClass="bg-amber-900/20" />
      <CountCell value={z.in_progress} colorClass="text-amber-300"  bgClass="bg-amber-900/20" />
      <CountCell value={z.pending_qa}  colorClass="text-orange-300" bgClass="bg-orange-900/20" />
      <CountCell value={z.resolved}    colorClass="text-blue-300"   bgClass="bg-blue-900/20" />
      <CountCell value={z.verified}    colorClass="text-green-300"  bgClass="bg-green-900/20" />
      <CountCell value={z.closed}      colorClass="text-green-300"  bgClass="bg-green-900/20" />

      <td className="px-3 py-2 text-xs text-zinc-600 whitespace-nowrap">—</td>
    </tr>
  );
}

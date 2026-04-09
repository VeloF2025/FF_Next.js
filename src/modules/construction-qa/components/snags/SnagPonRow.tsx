/**
 * SnagPonRow — PON-level row in the SnagSummaryPage table.
 */

import type { PonNode } from '../../types/snag.types';
import { CountCell } from './SnagSummaryHelpers';

interface SnagPonRowProps {
  pon: PonNode;
  projectId: string;
  zoneNo: number | null;
  onNavigate: (projectId: string, zoneNo: number | null, ponNo: number | null) => void;
}

export function SnagPonRow({
  pon,
  projectId,
  zoneNo,
  onNavigate,
}: SnagPonRowProps) {
  return (
    <tr className="bg-[var(--ff-bg-tertiary)]/15 hover:bg-[var(--ff-bg-hover)] transition-colors">
      <td className="px-3 py-2 text-xs whitespace-nowrap pl-12">
        <div className="flex items-center gap-1">
          <span className="w-3.5 inline-block flex-shrink-0" />
          <button
            type="button"
            onClick={() => onNavigate(projectId, zoneNo, pon.ponNo)}
            className="text-blue-400 hover:text-blue-300 hover:underline text-left"
          >
            {pon.label}
          </button>
        </div>
      </td>

      <td className="px-3 py-2 text-xs tabular-nums whitespace-nowrap text-right bg-zinc-100/5">
        <span className="font-medium text-zinc-200">{pon.total}</span>
      </td>

      <CountCell value={pon.open}        colorClass="text-red-300"    bgClass="bg-red-900/20" />
      <CountCell value={pon.assigned}    colorClass="text-amber-300"  bgClass="bg-amber-900/20" />
      <CountCell value={pon.in_progress} colorClass="text-amber-300"  bgClass="bg-amber-900/20" />
      <CountCell value={pon.pending_qa}  colorClass="text-orange-300" bgClass="bg-orange-900/20" />
      <CountCell value={pon.resolved}    colorClass="text-blue-300"   bgClass="bg-blue-900/20" />
      <CountCell value={pon.verified}    colorClass="text-green-300"  bgClass="bg-green-900/20" />
      <CountCell value={pon.closed}      colorClass="text-green-300"  bgClass="bg-green-900/20" />

      <td className="px-3 py-2 text-xs text-zinc-600 whitespace-nowrap">—</td>
    </tr>
  );
}

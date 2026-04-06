/**
 * SnagProjectRow — Project-level row in the SnagSummaryPage table.
 */

import { ChevronDown, ChevronRight } from 'lucide-react';
import type { ProjectNode } from '../../types/snag.types';
import { CountCell, formatDate } from './SnagSummaryHelpers';

interface SnagProjectRowProps {
  project: ProjectNode;
  isExpanded: boolean;
  onToggle: (id: string) => void;
  onNavigate: (projectId: string) => void;
}

export function SnagProjectRow({
  project: p,
  isExpanded,
  onToggle,
  onNavigate,
}: SnagProjectRowProps) {
  return (
    <tr className="hover:bg-[var(--ff-bg-hover)] transition-colors">
      <td className="px-3 py-2 text-xs whitespace-nowrap max-w-[200px]">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onToggle(p.project_id)}
            className="flex-shrink-0 text-zinc-400 hover:text-zinc-200 transition-colors"
            aria-label={isExpanded ? 'Collapse project' : 'Expand project'}
          >
            {isExpanded
              ? <ChevronDown className="w-3.5 h-3.5" />
              : <ChevronRight className="w-3.5 h-3.5" />
            }
          </button>
          <button
            type="button"
            onClick={() => onNavigate(p.project_id)}
            className="text-blue-400 hover:text-blue-300 hover:underline text-left truncate max-w-[170px]"
          >
            {p.project_name}
          </button>
        </div>
      </td>

      {/* Total */}
      <td className="px-3 py-2 text-xs tabular-nums whitespace-nowrap text-right bg-zinc-100/5">
        <span className="font-medium text-zinc-200">{p.total}</span>
      </td>

      <CountCell value={p.open}        colorClass="text-red-300"   bgClass="bg-red-900/20" />
      <CountCell value={p.assigned}    colorClass="text-amber-300" bgClass="bg-amber-900/20" />
      <CountCell value={p.in_progress} colorClass="text-amber-300" bgClass="bg-amber-900/20" />
      <CountCell value={p.fixed}       colorClass="text-blue-300"  bgClass="bg-blue-900/20" />
      <CountCell value={p.verified}    colorClass="text-green-300" bgClass="bg-green-900/20" />
      <CountCell value={p.closed}      colorClass="text-green-300" bgClass="bg-green-900/20" />
      <CountCell value={p.reopened}    colorClass="text-red-300"   bgClass="bg-red-900/20" />

      {/* Latest TQR */}
      <td className="px-3 py-2 text-xs tabular-nums whitespace-nowrap">
        {p.latest_report_number ? (
          <span className="text-zinc-300 font-medium">{p.latest_report_number}</span>
        ) : (
          <span className="text-zinc-600">—</span>
        )}
        {p.latest_report_date && (
          <span className="text-zinc-400 ml-1.5">
            {formatDate(p.latest_report_date)}
          </span>
        )}
      </td>
    </tr>
  );
}

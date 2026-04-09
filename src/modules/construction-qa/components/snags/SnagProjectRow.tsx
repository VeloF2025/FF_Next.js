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
  onStatusClick?: (projectId: string, status: string) => void;
  activeStatus?: string | null;
}

const STATUS_COLUMNS = [
  { key: 'open',        color: 'text-red-300',    bg: 'bg-red-900/20' },
  { key: 'assigned',    color: 'text-amber-300',  bg: 'bg-amber-900/20' },
  { key: 'in_progress', color: 'text-amber-300',  bg: 'bg-amber-900/20' },
  { key: 'pending_qa',  color: 'text-orange-300', bg: 'bg-orange-900/20' },
  { key: 'resolved',    color: 'text-blue-300',   bg: 'bg-blue-900/20' },
  { key: 'verified',    color: 'text-green-300',  bg: 'bg-green-900/20' },
  { key: 'closed',      color: 'text-green-300',  bg: 'bg-green-900/20' },
] as const;

export function SnagProjectRow({
  project: p,
  isExpanded,
  onToggle,
  onNavigate,
  onStatusClick,
  activeStatus,
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

      {STATUS_COLUMNS.map(({ key, color, bg }) => (
        <CountCell
          key={key}
          value={p[key]}
          colorClass={color}
          bgClass={bg}
          onClick={p[key] > 0 && onStatusClick ? () => onStatusClick(p.project_id, key) : undefined}
          isActive={activeStatus === key}
        />
      ))}

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

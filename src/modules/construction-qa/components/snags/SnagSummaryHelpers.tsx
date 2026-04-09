/**
 * SnagSummaryHelpers — Shared sub-components and constants for SnagSummaryPage.
 */

// ============================================================
// Column count constant
// ============================================================

export const COL_COUNT = 10; // Project, Total, Open, Assigned, In Progress, Pending QA, Resolved, Verified, Closed, Latest TQR

// ============================================================
// CountCell
// ============================================================

export interface CountCellProps {
  value: number;
  colorClass: string;
  bgClass: string;
  onClick?: () => void;
  isActive?: boolean;
}

export function CountCell({ value, colorClass, bgClass, onClick, isActive }: CountCellProps) {
  if (value === 0) {
    return (
      <td className="px-3 py-2 text-xs tabular-nums text-zinc-500 whitespace-nowrap text-right">
        0
      </td>
    );
  }
  const clickable = !!onClick;
  const activeRing = isActive ? 'ring-2 ring-[var(--ff-primary-500)] ring-inset' : '';
  const hoverClass = clickable ? 'cursor-pointer hover:brightness-125 transition-all' : '';

  return (
    <td
      className={`px-3 py-2 text-xs tabular-nums whitespace-nowrap text-right ${bgClass} ${activeRing} ${hoverClass}`}
      onClick={onClick}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') onClick?.(); } : undefined}
    >
      <span className={`font-medium ${colorClass}`}>{value}</span>
    </td>
  );
}

// ============================================================
// SkeletonRow
// ============================================================

export function SkeletonRow({ cols }: { cols: number }) {
  return (
    <tr>
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="px-3 py-3">
          <div
            className="h-3 rounded bg-zinc-700 animate-pulse"
            style={{ width: `${60 + (i % 3) * 20}%` }}
          />
        </td>
      ))}
    </tr>
  );
}

// ============================================================
// Utility
// ============================================================

export function formatDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('en-ZA', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

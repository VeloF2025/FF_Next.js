/**
 * SnagSummaryHelpers — Shared sub-components and constants for SnagSummaryPage.
 */

// ============================================================
// Column count constant
// ============================================================

export const COL_COUNT = 10;

// ============================================================
// CountCell
// ============================================================

export interface CountCellProps {
  value: number;
  colorClass: string;
  bgClass: string;
}

export function CountCell({ value, colorClass, bgClass }: CountCellProps) {
  if (value === 0) {
    return (
      <td className="px-3 py-2 text-xs tabular-nums text-zinc-500 whitespace-nowrap text-right">
        0
      </td>
    );
  }
  return (
    <td className={`px-3 py-2 text-xs tabular-nums whitespace-nowrap text-right ${bgClass}`}>
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

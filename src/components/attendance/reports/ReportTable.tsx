/**
 * Pulse · Reports — result table component.
 *
 * Renders columnar rows with align/format hints from the per-report
 * `ReportColumn[]`. Loading and empty states handled here so the page
 * doesn't drown in conditional JSX.
 */

import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import type { ReportColumn } from '@/services/attendance/reports/types';
import { fmtCell } from './reportFormatters';

export function ReportTable({
  columns, rows, loading,
}: {
  columns: ReadonlyArray<ReportColumn>;
  rows: Array<Record<string, unknown>>;
  loading: boolean;
}) {
  return (
    <div className="overflow-x-auto border border-neutral-800 rounded">
      <table className="min-w-full text-sm">
        <thead className="bg-neutral-900 text-neutral-300">
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                className={`px-3 py-2 text-xs font-medium text-neutral-400 uppercase tracking-wide ${
                  c.align === 'right' ? 'text-right' : 'text-left'
                }`}
              >
                {c.label}
              </th>
            ))}
            {columns.length === 0 && <th scope="col" className="px-3 py-2" />}
          </tr>
        </thead>
        <tbody>
          {loading && rows.length === 0 && (
            <tr>
              <td colSpan={Math.max(1, columns.length)} className="px-3 py-10 text-center text-sm text-neutral-500">
                <LoadingSpinner />
              </td>
            </tr>
          )}
          {!loading && rows.length === 0 && (
            <tr>
              <td colSpan={Math.max(1, columns.length)} className="px-3 py-10 text-center text-sm text-neutral-500">
                No rows match — try widening the date range or removing filters.
              </td>
            </tr>
          )}
          {rows.map((row, idx) => (
            <tr key={idx} className="border-t border-neutral-800 hover:bg-neutral-900/50">
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={`px-3 py-2 whitespace-nowrap ${c.align === 'right' ? 'text-right tabular-nums' : ''}`}
                >
                  {fmtCell(row[c.key], c)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

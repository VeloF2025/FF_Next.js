/**
 * ForceCorrectResultsTable — shared table for preview + result steps of the
 * batch force-correct admin page. Extracted to keep the page under 300 lines.
 */

import type { ForceCorrectRowResult } from '@/types/field-stock';

export function ForceCorrectResultsTable({
  rows,
  mode,
}: {
  rows: ForceCorrectRowResult[];
  mode: 'preview' | 'result';
}) {
  const appliedLabel = mode === 'preview' ? 'Would change' : 'Applied';
  return (
    <div className="overflow-x-auto rounded-lg border border-[var(--ff-border-primary)]">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--ff-border-primary)] bg-neutral-900/60 text-left text-xs text-neutral-400 uppercase tracking-wide">
            <th className="px-4 py-2">Serial</th>
            <th className="px-4 py-2">Found</th>
            <th className="px-4 py-2">Changed fields</th>
            <th className="px-4 py-2">{appliedLabel}</th>
            <th className="px-4 py-2">Note</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.serialNumber} className="border-b border-[var(--ff-border-primary)]/50 last:border-0">
              <td className="px-4 py-2 font-mono text-[var(--ff-text-primary)]">{row.serialNumber}</td>
              <td className="px-4 py-2">
                {row.found
                  ? <span className="text-green-400">Yes</span>
                  : <span className="text-red-400">No</span>}
              </td>
              <td className="px-4 py-2 text-neutral-300">
                {row.changedFields.length > 0
                  ? row.changedFields.join(', ')
                  : <span className="text-neutral-500">—</span>}
              </td>
              <td className="px-4 py-2">
                {row.applied
                  ? <span className="text-amber-300">Yes</span>
                  : <span className="text-neutral-500">—</span>}
              </td>
              <td className="px-4 py-2 text-neutral-400">
                {row.error ?? (row.found && !row.applied ? 'No-op' : '')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

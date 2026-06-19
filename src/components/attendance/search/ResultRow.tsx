/**
 * ResultRow — a single attendance row in the Pulse · Search results table.
 *
 * Formatting helpers live in `./formatters.ts` (not re-exported here) to
 * keep this file component-only and satisfy `react-refresh/only-export-components`.
 */

import Link from 'next/link';
import { fmtHrs, fmtTime, fmtWageCents } from './formatters';
import type { SearchRow } from './types';

export function ResultRow({ row }: { row: SearchRow }) {
  return (
    <tr className="hover:bg-neutral-800/60">
      <td className="px-3 py-2 whitespace-nowrap font-mono text-xs text-neutral-300">
        {row.work_date}
      </td>
      <td className="px-3 py-2 whitespace-nowrap">
        <Link href={`/staff/${row.staff_id}?tab=attendance`} className="text-emerald-400 hover:text-emerald-300">
          {row.full_name}
        </Link>
        {row.employee_id && (
          <span className="ml-1 text-xs text-neutral-600">({row.employee_id})</span>
        )}
      </td>
      <td className="px-3 py-2 whitespace-nowrap text-neutral-300">{row.department ?? '—'}</td>
      <td className="px-3 py-2 whitespace-nowrap text-neutral-300">{row.primary_site_name ?? '—'}</td>
      <td className="px-3 py-2 whitespace-nowrap font-mono text-xs">{fmtTime(row.first_clock_in_at)}</td>
      <td className="px-3 py-2 whitespace-nowrap font-mono text-xs">{fmtTime(row.last_clock_out_at)}</td>
      <td className="px-3 py-2 whitespace-nowrap text-right tabular-nums">
        {fmtHrs(row.regular_hrs + row.overtime_hrs)}
      </td>
      <td className="px-3 py-2 whitespace-nowrap text-right tabular-nums">
        {row.overtime_hrs > 0
          ? <span className="text-amber-300">{fmtHrs(row.overtime_hrs)}</span>
          : '—'}
      </td>
      <td className="px-3 py-2 whitespace-nowrap text-right tabular-nums">
        {fmtWageCents(row.wage_amount_cents)}
      </td>
      <td className="px-3 py-2 whitespace-nowrap text-xs">
        {row.exceptions_count > 0 ? (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-900/40 text-amber-300">
            {row.exceptions_count} · {row.exception_kinds.slice(0, 2).join(', ')}
            {row.exception_kinds.length > 2 && ` +${row.exception_kinds.length - 2}`}
          </span>
        ) : (
          <span className="text-neutral-600">—</span>
        )}
      </td>
    </tr>
  );
}

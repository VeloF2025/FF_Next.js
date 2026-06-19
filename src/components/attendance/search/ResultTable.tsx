/**
 * ResultTable — results table and aggregate totals strip for Pulse · Search.
 *
 * Exports:
 *   - `TotalsStrip` — aggregate stat cards (rows, staff, hours, OT, wage, exceptions).
 *   - `ResultTable` — sortable results table with paginated rows.
 *
 * Individual row rendering is in `ResultRow.tsx`; formatting helpers in the same file.
 */

import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { ResultRow } from './ResultRow';
import { fmtHrs, fmtRand } from './formatters';
import type { SearchRow, SearchTotals, ScopeNote, SortField, SortDir } from './types';

// ---------------------------------------------------------------------------
// TotalsStrip
// ---------------------------------------------------------------------------

function Stat({ label, value, accent }: { label: string; value: string; accent?: 'amber' }) {
  const tone = accent === 'amber'
    ? 'border-amber-800/40 bg-amber-950/20'
    : 'border-neutral-800 bg-neutral-900';
  return (
    <div className={`rounded-xl border ${tone} px-3 py-2`}>
      <div className="text-xs text-neutral-500">{label}</div>
      <div className="text-base font-semibold text-neutral-100">{value}</div>
    </div>
  );
}

interface TotalsStripProps {
  totals: SearchTotals;
  scopeNote?: ScopeNote;
}

export function TotalsStrip({ totals, scopeNote }: TotalsStripProps) {
  return (
    <div className="mt-4 grid grid-cols-2 md:grid-cols-6 gap-3">
      <Stat label="Rows" value={totals.rowCount.toLocaleString('en-ZA')} />
      <Stat label="Staff" value={totals.distinctStaffCount.toLocaleString('en-ZA')} />
      <Stat label="Hours" value={fmtHrs(totals.totalRegularHrs + totals.totalOvertimeHrs)} />
      <Stat label="OT" value={fmtHrs(totals.totalOvertimeHrs)} accent="amber" />
      <Stat label="Wage" value={totals.totalWageCents > 0 ? fmtRand(totals.totalWageCents) : '—'} />
      <Stat
        label="Exceptions"
        value={totals.totalExceptionsCount.toLocaleString('en-ZA')}
        accent={totals.totalExceptionsCount > 0 ? 'amber' : undefined}
      />
      {scopeNote && (
        <div className="md:col-span-6 text-xs text-neutral-500">
          {scopeNote.kind === 'orgwide' && 'Scope: org-wide.'}
          {scopeNote.kind === 'scoped' &&
            `Scope: ${scopeNote.staffCount.toLocaleString('en-ZA')} staff in your supervisor chain.`}
          {scopeNote.kind === 'no_scope' && scopeNote.reason}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Table header helpers
// ---------------------------------------------------------------------------

function Th({ children, numeric }: { children?: React.ReactNode; numeric?: boolean }) {
  return (
    <th scope="col"
      className={`px-3 py-2 text-xs font-medium text-neutral-500 uppercase tracking-wide ${numeric ? 'text-right' : 'text-left'}`}>
      {children}
    </th>
  );
}

function SortableTh({ label, field, current, dir, onSort, numeric }: {
  label: string; field: SortField; current: SortField; dir: SortDir;
  onSort: (f: SortField) => void; numeric?: boolean;
}) {
  const active = current === field;
  return (
    <th scope="col"
      className={`px-3 py-2 text-xs font-medium text-neutral-500 uppercase tracking-wide ${numeric ? 'text-right' : 'text-left'}`}>
      <button type="button" onClick={() => onSort(field)}
        className={`inline-flex items-center gap-1 hover:text-neutral-300 ${active ? 'text-neutral-300' : ''}`}>
        <span>{label}</span>
        {active && <span className="text-[10px]">{dir === 'asc' ? '▲' : '▼'}</span>}
      </button>
    </th>
  );
}

// ---------------------------------------------------------------------------
// ResultTable
// ---------------------------------------------------------------------------

interface ResultTableProps {
  rows: SearchRow[];
  loading: boolean;
  emptyMessage: string | null;
  sortField: SortField;
  sortDir: SortDir;
  onSort: (f: SortField) => void;
}

export function ResultTable({ rows, loading, emptyMessage, sortField, sortDir, onSort }: ResultTableProps) {
  return (
    <div className="mt-4 overflow-x-auto bg-neutral-900 border border-neutral-800 rounded-xl">
      <table className="min-w-full text-sm">
        <thead className="bg-neutral-900">
          <tr>
            <SortableTh label="Date"   field="work_date"  current={sortField} dir={sortDir} onSort={onSort} />
            <SortableTh label="Staff"  field="full_name"  current={sortField} dir={sortDir} onSort={onSort} />
            <SortableTh label="Dept"   field="department" current={sortField} dir={sortDir} onSort={onSort} />
            <Th>Site</Th>
            <Th>Clock-in</Th>
            <Th>Clock-out</Th>
            <SortableTh label="Hours"  field="hours"    current={sortField} dir={sortDir} onSort={onSort} numeric />
            <SortableTh label="OT"     field="overtime" current={sortField} dir={sortDir} onSort={onSort} numeric />
            <Th numeric>Wage</Th>
            <Th>Exceptions</Th>
          </tr>
        </thead>
        <tbody className="bg-neutral-900 divide-y divide-neutral-800">
          {loading && rows.length === 0 && (
            <tr>
              <td colSpan={10} className="px-3 py-10 text-center text-sm text-neutral-500">
                <LoadingSpinner />
              </td>
            </tr>
          )}
          {!loading && rows.length === 0 && emptyMessage && (
            <tr>
              <td colSpan={10} className="px-3 py-10 text-center text-sm text-neutral-500">
                {emptyMessage}
              </td>
            </tr>
          )}
          {rows.map((r) => (
            <ResultRow key={`${r.staff_id}|${r.work_date}`} row={r} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

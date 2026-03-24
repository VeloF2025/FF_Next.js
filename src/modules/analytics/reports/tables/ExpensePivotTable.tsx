/**
 * ExpensePivotTable — Excel-style pivot grid for Expense Pivot report.
 * Rows: categories. Columns: year groups → months + year totals + grand total.
 */
'use client';

import type { PivotData } from '../expense-pivot/useExpensePivotData';

function fZAR(v: number) {
  if (v === 0) return '—';
  const abs = Math.abs(Math.round(v));
  const s = abs.toLocaleString('en-ZA').replace(/,/g, '\u00a0');
  return `${v < 0 ? '-' : ''}R\u00a0${s}`;
}

interface Props {
  pivot: PivotData;
}

export function ExpensePivotTable({ pivot }: Props) {
  const { months, yearGroups, rows, grandTotals } = pivot;
  const years = Object.keys(yearGroups).sort();

  const th = 'px-3 py-2.5 text-xs font-bold text-white uppercase tracking-wide whitespace-nowrap';

  return (
    <div className="overflow-x-auto rounded-lg border border-[var(--ff-border)]">
      <table className="min-w-max w-full text-sm border-collapse">
        <thead>
          {/* Year group spans */}
          <tr style={{ backgroundColor: '#1a3a4a' }}>
            <th className={`${th} text-left sticky left-0 z-20`} style={{ backgroundColor: '#1a3a4a', minWidth: 200 }} rowSpan={2}>
              Category
            </th>
            {years.map(yr => {
              const yrMonths = yearGroups[yr] ?? [];
              return (
                <th
                  key={yr}
                  colSpan={yrMonths.length + 1}
                  className={`${th} text-center border-l border-teal-700`}
                >
                  {yr}
                </th>
              );
            })}
            <th className={`${th} text-right`} rowSpan={2}>Grand Total</th>
          </tr>
          {/* Month labels */}
          <tr style={{ backgroundColor: '#122b38' }}>
            {years.map(yr => {
              const yrMonths = yearGroups[yr] ?? [];
              return [
                ...yrMonths.map(mk => (
                  <th key={mk} className="px-3 py-1.5 text-right text-xs font-medium text-[var(--ff-text-secondary)] whitespace-nowrap border-l border-[var(--ff-border)]">
                    {mk.split('-')[1]}
                  </th>
                )),
                <th key={`${yr}-total`} className="px-3 py-1.5 text-right text-xs font-semibold text-[var(--ff-text)] whitespace-nowrap border-l border-teal-700 bg-teal-900/30">
                  {yr} Total
                </th>,
              ];
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr key={row.category} className={idx % 2 === 0 ? 'bg-[var(--ff-bg)]' : 'bg-[var(--ff-surface)]/60'}>
              <td className="sticky left-0 z-10 px-3 py-2 font-medium text-[var(--ff-text)] bg-inherit border-r border-[var(--ff-border)] whitespace-nowrap max-w-xs truncate">
                {row.category}
              </td>
              {years.map(yr => {
                const yrMonths = yearGroups[yr] ?? [];
                return [
                  ...yrMonths.map(mk => (
                    <td key={mk} className="px-3 py-2 text-right tabular-nums text-[var(--ff-text-muted)] border-l border-[var(--ff-border)]">
                      {fZAR(row.monthly[mk] ?? 0)}
                    </td>
                  )),
                  <td key={`${yr}-total`} className="px-3 py-2 text-right tabular-nums font-semibold text-[var(--ff-text)] border-l border-teal-900 bg-teal-900/20">
                    {fZAR(row.yearTotals[yr] ?? 0)}
                  </td>,
                ];
              })}
              <td className="px-3 py-2 text-right tabular-nums font-bold text-white bg-[var(--ff-surface)]/50">
                {fZAR(row.grandTotal)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-[var(--ff-border)] font-bold" style={{ backgroundColor: '#1a3a4a' }}>
            <td className="sticky left-0 z-10 px-3 py-2.5 text-white bg-inherit border-r border-[var(--ff-border)]">
              Grand Total
            </td>
            {years.map(yr => {
              const yrMonths = yearGroups[yr] ?? [];
              return [
                ...yrMonths.map(mk => (
                  <td key={mk} className="px-3 py-2.5 text-right tabular-nums text-[var(--ff-text)] border-l border-[var(--ff-border)]">
                    {fZAR(grandTotals.monthly[mk] ?? 0)}
                  </td>
                )),
                <td key={`${yr}-total`} className="px-3 py-2.5 text-right tabular-nums text-white border-l border-teal-700 bg-teal-900/30">
                  {fZAR(grandTotals.yearTotals[yr] ?? 0)}
                </td>,
              ];
            })}
            <td className="px-3 py-2.5 text-right tabular-nums text-white bg-[var(--ff-surface)]/50">
              {fZAR(grandTotals.grandTotal)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

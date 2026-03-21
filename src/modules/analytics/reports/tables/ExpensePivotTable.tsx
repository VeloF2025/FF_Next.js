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
    <div className="overflow-x-auto rounded-lg border border-gray-700">
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
                  <th key={mk} className="px-3 py-1.5 text-right text-xs font-medium text-gray-300 whitespace-nowrap border-l border-gray-700">
                    {mk.split('-')[1]}
                  </th>
                )),
                <th key={`${yr}-total`} className="px-3 py-1.5 text-right text-xs font-semibold text-gray-200 whitespace-nowrap border-l border-teal-700 bg-teal-900/30">
                  {yr} Total
                </th>,
              ];
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr key={row.category} className={idx % 2 === 0 ? 'bg-gray-900' : 'bg-gray-800/60'}>
              <td className="sticky left-0 z-10 px-3 py-2 font-medium text-gray-200 bg-inherit border-r border-gray-700 whitespace-nowrap max-w-xs truncate">
                {row.category}
              </td>
              {years.map(yr => {
                const yrMonths = yearGroups[yr] ?? [];
                return [
                  ...yrMonths.map(mk => (
                    <td key={mk} className="px-3 py-2 text-right tabular-nums text-gray-400 border-l border-gray-800">
                      {fZAR(row.monthly[mk] ?? 0)}
                    </td>
                  )),
                  <td key={`${yr}-total`} className="px-3 py-2 text-right tabular-nums font-semibold text-gray-200 border-l border-teal-900 bg-teal-900/20">
                    {fZAR(row.yearTotals[yr] ?? 0)}
                  </td>,
                ];
              })}
              <td className="px-3 py-2 text-right tabular-nums font-bold text-white bg-gray-700/50">
                {fZAR(row.grandTotal)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-gray-500 font-bold" style={{ backgroundColor: '#1a3a4a' }}>
            <td className="sticky left-0 z-10 px-3 py-2.5 text-white bg-inherit border-r border-gray-600">
              Grand Total
            </td>
            {years.map(yr => {
              const yrMonths = yearGroups[yr] ?? [];
              return [
                ...yrMonths.map(mk => (
                  <td key={mk} className="px-3 py-2.5 text-right tabular-nums text-gray-100 border-l border-gray-700">
                    {fZAR(grandTotals.monthly[mk] ?? 0)}
                  </td>
                )),
                <td key={`${yr}-total`} className="px-3 py-2.5 text-right tabular-nums text-white border-l border-teal-700 bg-teal-900/30">
                  {fZAR(grandTotals.yearTotals[yr] ?? 0)}
                </td>,
              ];
            })}
            <td className="px-3 py-2.5 text-right tabular-nums text-white bg-gray-700/50">
              {fZAR(grandTotals.grandTotal)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

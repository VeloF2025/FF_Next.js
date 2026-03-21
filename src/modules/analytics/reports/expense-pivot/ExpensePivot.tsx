/**
 * ExpensePivot — Pivot table showing monthly expense breakdown by Category T2.
 * Mirrors the Excel pivot structure: rows = categories, columns = months + year totals.
 * Data sourced from the Shareholder Model Excel via SharePoint Graph API.
 */

'use client';

import { useState } from 'react';
import { Loader2, AlertCircle } from 'lucide-react';
import { useExpensePivotData, type PivotType } from './useExpensePivotData';

/** Formats a ZAR value: 0 → "—", otherwise "R 1 234" */
function formatZAR(val: number): string {
  if (val === 0) return '—';
  return `R ${val.toLocaleString('en-ZA', { maximumFractionDigits: 0 })}`;
}

const FILTER_OPTIONS: { label: string; value: PivotType }[] = [
  { label: 'Expense', value: 'Expense' },
  { label: 'Income', value: 'Income' },
  { label: 'All', value: 'All' },
];

// 🟢 WORKING: Expense pivot table with year grouping and month columns
export default function ExpensePivot() {
  const [type, setType] = useState<PivotType>('Expense');
  const { data, isLoading, error } = useExpensePivotData(type);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400">
        <Loader2 className="w-6 h-6 animate-spin mr-2" />
        Loading expense data&hellip;
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 text-red-400 p-4">
        <AlertCircle className="w-5 h-5 flex-shrink-0" />
        <span>{error.message}</span>
      </div>
    );
  }

  const pivot = data?.data;
  if (!pivot) return null;

  const { months, yearGroups, rows, grandTotals } = pivot;
  const years = Object.keys(yearGroups).sort();

  return (
    <div className="space-y-4">
      {/* Filter buttons */}
      <div className="flex items-center gap-2">
        {FILTER_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setType(opt.value)}
            className={`px-4 py-1.5 rounded text-sm font-medium transition-colors ${
              type === opt.value
                ? 'bg-blue-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            {opt.label}
          </button>
        ))}
        <span className="text-xs text-gray-500 ml-2">
          {rows.length} categories · {months.length} months
        </span>
      </div>

      {/* Scrollable pivot table */}
      <div className="overflow-x-auto rounded-lg border border-gray-700">
        <table className="min-w-max w-full text-sm text-gray-100 bg-gray-800">
          <thead>
            {/* Header row 1: Year group spans */}
            <tr className="bg-gray-700">
              <th
                className="sticky left-0 z-20 bg-gray-700 px-3 py-2 text-left font-semibold border-b border-gray-600 border-r border-gray-600"
                rowSpan={2}
              >
                Category T2
              </th>
              {years.map((year) => {
                const yearMonths = yearGroups[year] ?? [];
                // +1 for year total column
                const colSpan = yearMonths.length + 1;
                return (
                  <th
                    key={year}
                    colSpan={colSpan}
                    className="px-3 py-2 text-center font-bold border-b border-gray-600 border-r border-gray-600"
                  >
                    {year}
                  </th>
                );
              })}
              <th
                className="px-3 py-2 text-center font-bold border-b border-gray-600 bg-gray-700/50"
                rowSpan={2}
              >
                Grand Total
              </th>
            </tr>
            {/* Header row 2: Month labels + year total labels */}
            <tr className="bg-gray-700/50">
              {years.map((year) => {
                const yearMonths = yearGroups[year] ?? [];
                return yearMonths
                  .map((mk) => (
                    <th
                      key={mk}
                      className="px-3 py-1.5 text-right text-xs font-medium text-gray-300 border-b border-gray-600 whitespace-nowrap"
                    >
                      {mk.split('-')[1]}
                    </th>
                  ))
                  .concat(
                    <th
                      key={`${year}-total`}
                      className="px-3 py-1.5 text-right text-xs font-semibold text-gray-200 border-b border-gray-600 border-r border-gray-600 bg-gray-700/30 whitespace-nowrap"
                    >
                      {year} Total
                    </th>
                  );
              })}
            </tr>
          </thead>

          <tbody>
            {rows.map((row, idx) => (
              <tr
                key={row.category}
                className={idx % 2 === 0 ? 'bg-gray-800' : 'bg-gray-800/60'}
              >
                {/* Sticky category column */}
                <td className="sticky left-0 z-10 bg-inherit px-3 py-2 font-medium border-r border-gray-700 whitespace-nowrap max-w-xs truncate">
                  {row.category}
                </td>

                {years.map((year) => {
                  const yearMonths = yearGroups[year] ?? [];
                  return yearMonths
                    .map((mk) => (
                      <td key={mk} className="px-3 py-2 text-right tabular-nums text-gray-300">
                        {formatZAR(row.monthly[mk] ?? 0)}
                      </td>
                    ))
                    .concat(
                      <td
                        key={`${year}-total`}
                        className="px-3 py-2 text-right tabular-nums font-semibold text-gray-200 border-r border-gray-700 bg-gray-700/30"
                      >
                        {formatZAR(row.yearTotals[year] ?? 0)}
                      </td>
                    );
                })}

                {/* Grand total cell */}
                <td className="px-3 py-2 text-right tabular-nums font-bold text-white bg-gray-700/50">
                  {formatZAR(row.grandTotal)}
                </td>
              </tr>
            ))}
          </tbody>

          {/* Grand Total footer row */}
          <tfoot>
            <tr className="font-bold border-t-2 border-gray-500 bg-gray-700">
              <td className="sticky left-0 z-10 bg-gray-700 px-3 py-2 border-r border-gray-600">
                Grand Total
              </td>
              {years.map((year) => {
                const yearMonths = yearGroups[year] ?? [];
                return yearMonths
                  .map((mk) => (
                    <td key={mk} className="px-3 py-2 text-right tabular-nums text-gray-100">
                      {formatZAR(grandTotals.monthly[mk] ?? 0)}
                    </td>
                  ))
                  .concat(
                    <td
                      key={`${year}-total`}
                      className="px-3 py-2 text-right tabular-nums text-white border-r border-gray-600 bg-gray-700/30"
                    >
                      {formatZAR(grandTotals.yearTotals[year] ?? 0)}
                    </td>
                  );
              })}
              <td className="px-3 py-2 text-right tabular-nums text-white bg-gray-700/50">
                {formatZAR(grandTotals.grandTotal)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

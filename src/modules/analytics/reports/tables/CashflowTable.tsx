/**
 * CashflowTable — Data grid for the Cashflow Overview report.
 * Columns: Month | Cash In (R) | Cash Out (R) | Net (R) | Closing Balance (R)
 * Closing Balance = cumulative running sum of Net column.
 *
 * Actual / Forecast separator: dynamic — end of previous calendar month.
 * Today = Mar 21 2026 → last actual = Feb 2026, first forecast = Mar 2026.
 */
'use client';

import type { CashflowDataPoint } from '../revenue-overview/useRevenueData';

function fZAR(v: number) {
  if (!isFinite(v)) return '—';
  const abs = Math.abs(Math.round(v));
  const s = abs.toLocaleString('en-ZA').replace(/,/g, '\u00a0');
  return `${v < 0 ? '-' : ''}R\u00a0${s}`;
}

/**
 * Parse a month label like "Mar 2025" or "Sep 2025" into a comparable Date
 * (always set to the 1st of that month).
 */
function parseMonthLabel(label: string): Date | null {
  const MONTHS: Record<string, number> = {
    Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
    Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
  };
  const parts = label.trim().split(/\s+/);
  if (parts.length !== 2) return null;
  const mon = MONTHS[parts[0]];
  const yr = parseInt(parts[1], 10);
  if (mon === undefined || isNaN(yr)) return null;
  return new Date(yr, mon, 1);
}

/** Last day of the previous calendar month relative to today */
function lastActualDate(): Date {
  const now = new Date();
  // first day of current month, minus 1 day = last day of previous month
  return new Date(now.getFullYear(), now.getMonth(), 0);
}

interface Props {
  rows: CashflowDataPoint[];
}

export function CashflowTable({ rows }: Props) {
  const cutoff = lastActualDate(); // e.g. 28 Feb 2026

  const totals = rows.reduce(
    (acc, r) => ({ cashIn: acc.cashIn + r.cashIn, cashOut: acc.cashOut + r.cashOut, net: acc.net + r.net }),
    { cashIn: 0, cashOut: 0, net: 0 }
  );

  // Compute closing balance per row (cumulative running net)
  let running = 0;
  const rowsWithBalance = rows.map((r) => {
    running += r.net;
    const rowDate = parseMonthLabel(r.label);
    // A row is "actual" if its month-start is on or before the cutoff
    const isActual = rowDate !== null && rowDate <= cutoff;
    return { ...r, closingBalance: running, isActual, rowDate };
  });

  // Index of the first forecast row (used to insert the separator)
  const firstForecastIdx = rowsWithBalance.findIndex((r) => !r.isActual);

  const th = 'px-4 py-2.5 text-left text-xs font-bold text-white uppercase tracking-wide whitespace-nowrap';
  const thR = `${th} text-right`;

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-700">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr style={{ backgroundColor: '#1a3a4a' }}>
            <th className={th} style={{ minWidth: 120 }}>Month</th>
            <th className={thR}>Cash In (R)</th>
            <th className={thR}>Cash Out (R)</th>
            <th className={thR}>Net (R)</th>
            <th className={thR}>Closing Balance (R)</th>
          </tr>
        </thead>
        <tbody>
          {rowsWithBalance.map((r, i) => {
            const isSeparatorRow = firstForecastIdx !== -1 && i === firstForecastIdx;

            return (
              <>
                {/* Actual / Forecast separator — inserted before first forecast row */}
                {isSeparatorRow && (
                  <tr key={`separator-${i}`} style={{ backgroundColor: 'rgba(220,38,38,0.08)' }}>
                    <td
                      colSpan={5}
                      className="px-4 py-1 text-xs font-bold tracking-widest uppercase"
                      style={{
                        borderTop: '2px solid #ef4444',
                        borderBottom: '1px solid rgba(239,68,68,0.3)',
                        color: '#ef4444',
                        letterSpacing: '0.12em',
                      }}
                    >
                      <span className="opacity-70">← ACTUAL</span>
                      <span className="mx-3 opacity-40">|</span>
                      <span className="opacity-70">FORECAST →</span>
                    </td>
                  </tr>
                )}

                <tr
                  key={r.label}
                  className={i % 2 === 0 ? 'bg-gray-900' : 'bg-gray-800/60'}
                  style={isSeparatorRow ? { borderTop: '2px solid #ef4444' } : undefined}
                >
                  <td className="px-4 py-2 text-gray-200 font-medium">{r.label}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-gray-300">{fZAR(r.cashIn)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-gray-300">{fZAR(r.cashOut)}</td>
                  <td className={`px-4 py-2 text-right tabular-nums font-semibold ${r.net < 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                    {fZAR(r.net)}
                  </td>
                  <td className={`px-4 py-2 text-right tabular-nums font-bold ${r.closingBalance < 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                    {fZAR(r.closingBalance)}
                  </td>
                </tr>
              </>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-gray-500 font-bold" style={{ backgroundColor: '#1a3a4a' }}>
            <td className="px-4 py-2.5 text-white">Total</td>
            <td className="px-4 py-2.5 text-right tabular-nums text-white">{fZAR(totals.cashIn)}</td>
            <td className="px-4 py-2.5 text-right tabular-nums text-white">{fZAR(totals.cashOut)}</td>
            <td className={`px-4 py-2.5 text-right tabular-nums ${totals.net < 0 ? 'text-red-300' : 'text-emerald-300'}`}>
              {fZAR(totals.net)}
            </td>
            <td className={`px-4 py-2.5 text-right tabular-nums ${running < 0 ? 'text-red-300' : 'text-emerald-300'}`}>
              {fZAR(running)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

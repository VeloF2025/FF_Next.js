/**
 * CashflowTable — Data grid for the Cashflow Overview report.
 * Columns: Month | Cash In (R) | Cash Out (R) | Net (R) | Closing Balance (R)
 * Closing Balance = cumulative running sum of Net column.
 *
 * Actual / Forecast separator: dynamic — end of previous calendar month.
 * Forecast section is collapsible via +/− toggle on the separator row.
 */
'use client';

import { useState } from 'react';
import type { CashflowDataPoint } from '../revenue-overview/useRevenueData';

function fZAR(v: number) {
  if (!isFinite(v)) return '—';
  const abs = Math.abs(Math.round(v));
  const s = abs.toLocaleString('en-ZA').replace(/,/g, '\u00a0');
  return `${v < 0 ? '-' : ''}R\u00a0${s}`;
}

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

function lastActualDate(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 0);
}

interface Props {
  rows: CashflowDataPoint[];
}

export function CashflowTable({ rows }: Props) {
  const [forecastExpanded, setForecastExpanded] = useState(true);

  const cutoff = lastActualDate();

  const totals = rows.reduce(
    (acc, r) => ({ cashIn: acc.cashIn + r.cashIn, cashOut: acc.cashOut + r.cashOut, net: acc.net + r.net }),
    { cashIn: 0, cashOut: 0, net: 0 }
  );

  let running = 0;
  const rowsWithBalance = rows.map((r) => {
    running += r.net;
    const rowDate = parseMonthLabel(r.label);
    const isActual = rowDate !== null && rowDate <= cutoff;
    return { ...r, closingBalance: running, isActual };
  });

  const firstForecastIdx = rowsWithBalance.findIndex((r) => !r.isActual);
  const forecastCount = firstForecastIdx === -1 ? 0 : rowsWithBalance.length - firstForecastIdx;

  // Actuals subtotal (rows before separator)
  const actualRows = firstForecastIdx === -1 ? rowsWithBalance : rowsWithBalance.slice(0, firstForecastIdx);
  const actualTotals = actualRows.reduce(
    (acc, r) => ({ cashIn: acc.cashIn + r.cashIn, cashOut: acc.cashOut + r.cashOut, net: acc.net + r.net }),
    { cashIn: 0, cashOut: 0, net: 0 }
  );
  const actualClosing = actualRows.length > 0 ? actualRows[actualRows.length - 1].closingBalance : 0;

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
            const isForecast = !r.isActual;

            // Hide forecast rows when collapsed (but still render separator)
            if (isForecast && !isSeparatorRow && !forecastExpanded) return null;

            return (
              <>
                {/* Actuals subtotal row — inserted just before separator */}
                {isSeparatorRow && firstForecastIdx > 0 && (
                  <tr key="actual-total" style={{ backgroundColor: '#1a3a4a' }} className="border-t border-gray-600">
                    <td className="px-4 py-2.5 text-white font-bold text-sm">Total Actual</td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-bold text-white">{fZAR(actualTotals.cashIn)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-bold text-white">{fZAR(actualTotals.cashOut)}</td>
                    <td className={`px-4 py-2.5 text-right tabular-nums font-bold ${actualTotals.net < 0 ? 'text-red-300' : 'text-emerald-300'}`}>
                      {fZAR(actualTotals.net)}
                    </td>
                    <td className={`px-4 py-2.5 text-right tabular-nums font-bold ${actualClosing < 0 ? 'text-red-300' : 'text-emerald-300'}`}>
                      {fZAR(actualClosing)}
                    </td>
                  </tr>
                )}

                {/* Separator row with +/− toggle */}
                {isSeparatorRow && (
                  <tr key={`separator-${i}`} style={{ backgroundColor: 'rgba(255,255,255,0.03)' }}>
                    <td
                      colSpan={5}
                      className="py-1 text-xs font-semibold tracking-widest uppercase"
                      style={{
                        borderTop: '2px solid #1a3a4a',
                        borderBottom: '1px solid rgba(255,255,255,0.08)',
                        color: '#9CA3AF',
                        letterSpacing: '0.10em',
                        paddingLeft: 0,
                      }}
                    >
                      <button
                        onClick={() => setForecastExpanded((v) => !v)}
                        className="flex items-center gap-2 w-full px-4 py-0.5 hover:opacity-80 transition-opacity text-left"
                        title={forecastExpanded ? 'Collapse forecast' : 'Expand forecast'}
                      >
                        {/* +/− badge */}
                        <span
                          className="inline-flex items-center justify-center w-5 h-5 rounded text-xs font-bold flex-shrink-0"
                          style={{
                            backgroundColor: '#1a3a4a',
                            color: '#9CA3AF',
                            border: '1px solid rgba(255,255,255,0.15)',
                          }}
                        >
                          {forecastExpanded ? '−' : '+'}
                        </span>
                        <span className="opacity-60">← ACTUAL</span>
                        <span className="opacity-30 mx-1">|</span>
                        <span className="opacity-60">FORECAST →</span>
                        {!forecastExpanded && (
                          <span className="ml-2 opacity-40 text-xs normal-case tracking-normal">
                            ({forecastCount} months hidden)
                          </span>
                        )}
                      </button>
                    </td>
                  </tr>
                )}

                {/* Skip forecast data rows when collapsed */}
                {(!isForecast || forecastExpanded) && (
                  <tr
                    key={r.label}
                    className={i % 2 === 0 ? 'bg-gray-900' : 'bg-gray-800/60'}
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
                )}
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

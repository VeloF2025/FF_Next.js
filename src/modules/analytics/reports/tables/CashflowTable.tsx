/**
 * CashflowTable — Data grid for the Cashflow Overview report.
 * Columns: Month | Cash In (R) | Cash Out (R) | Net (R)
 */
'use client';

import type { CashflowDataPoint } from '../revenue-overview/useRevenueData';

function fZAR(v: number) {
  if (!isFinite(v)) return '—';
  const abs = Math.abs(Math.round(v));
  const s = abs.toLocaleString('en-ZA').replace(/,/g, '\u00a0');
  return `${v < 0 ? '-' : ''}R\u00a0${s}`;
}

interface Props {
  rows: CashflowDataPoint[];
}

export function CashflowTable({ rows }: Props) {
  const totals = rows.reduce(
    (acc, r) => ({ cashIn: acc.cashIn + r.cashIn, cashOut: acc.cashOut + r.cashOut, net: acc.net + r.net }),
    { cashIn: 0, cashOut: 0, net: 0 }
  );

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
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.label} className={i % 2 === 0 ? 'bg-gray-900' : 'bg-gray-800/60'}>
              <td className="px-4 py-2 text-gray-200 font-medium">{r.label}</td>
              <td className="px-4 py-2 text-right tabular-nums text-gray-300">{fZAR(r.cashIn)}</td>
              <td className="px-4 py-2 text-right tabular-nums text-gray-300">{fZAR(r.cashOut)}</td>
              <td className={`px-4 py-2 text-right tabular-nums font-semibold ${r.net < 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                {fZAR(r.net)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-gray-500 font-bold" style={{ backgroundColor: '#1a3a4a' }}>
            <td className="px-4 py-2.5 text-white">Total</td>
            <td className="px-4 py-2.5 text-right tabular-nums text-white">{fZAR(totals.cashIn)}</td>
            <td className="px-4 py-2.5 text-right tabular-nums text-white">{fZAR(totals.cashOut)}</td>
            <td className={`px-4 py-2.5 text-right tabular-nums ${totals.net < 0 ? 'text-red-300' : 'text-emerald-300'}`}>
              {fZAR(totals.net)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

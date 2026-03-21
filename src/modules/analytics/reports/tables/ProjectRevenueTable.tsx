/**
 * CostCentreRevenueTable — T1-only data grid for the Cost Centre Revenue report.
 * Columns: Cost Centre T1 | Revenue (R)
 * T2 grouping will be added once Lew specs it.
 */
'use client';

import type { CostCentreRevenueItem } from '../project-revenue/useProjectRevenueData';

function fZAR(v: number) {
  const abs = Math.abs(Math.round(v));
  const s = abs.toLocaleString('en-ZA').replace(/,/g, '\u00a0');
  return `R\u00a0${s}`;
}

interface Props {
  rows: CostCentreRevenueItem[];
}

// 🟢 WORKING: T1-only cost centre revenue table with grand total footer
export function CostCentreRevenueTable({ rows }: Props) {
  const grandTotal = rows.reduce((s, r) => s + r.revenue, 0);

  const th =
    'px-4 py-2.5 text-left text-xs font-bold text-white uppercase tracking-wide whitespace-nowrap';
  const thR = `${th} text-right`;

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-700">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr style={{ backgroundColor: '#1a3a4a' }}>
            <th className={th} style={{ minWidth: 220 }}>
              Cost Centre T1
            </th>
            <th className={thR} style={{ minWidth: 160 }}>
              Revenue (R)
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={`${row.tier1}-${i}`} className={i % 2 === 0 ? 'bg-gray-900' : 'bg-gray-800/60'}>
              <td className="px-4 py-2.5 text-gray-200">{row.tier1}</td>
              <td className="px-4 py-2.5 text-right tabular-nums text-gray-300">
                {fZAR(row.revenue)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-gray-500" style={{ backgroundColor: '#1a3a4a' }}>
            <td className="px-4 py-2.5 text-white font-bold">Grand Total</td>
            <td className="px-4 py-2.5 text-right tabular-nums text-white font-bold">
              {fZAR(grandTotal)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

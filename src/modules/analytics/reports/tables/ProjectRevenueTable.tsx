/**
 * CostCentreRevenueTable — Tiered data grid for the Cost Centre Revenue report.
 * Groups rows by Cost Centre T1, shows subtotals per tier1 and a grand total footer.
 * Columns: Cost Centre T1 | Cost Centre | Revenue (R)
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

interface Tier1Group {
  tier1: string;
  items: CostCentreRevenueItem[];
  subtotal: number;
}

function groupByTier1(rows: CostCentreRevenueItem[]): Tier1Group[] {
  const map = new Map<string, CostCentreRevenueItem[]>();
  for (const row of rows) {
    const existing = map.get(row.tier1);
    if (existing) {
      existing.push(row);
    } else {
      map.set(row.tier1, [row]);
    }
  }
  return Array.from(map.entries()).map(([tier1, items]) => ({
    tier1,
    items,
    subtotal: items.reduce((s, r) => s + r.revenue, 0),
  }));
}

// 🟢 WORKING: Tiered cost centre revenue table with subtotals
export function CostCentreRevenueTable({ rows }: Props) {
  const groups = groupByTier1(rows);
  const grandTotal = rows.reduce((s, r) => s + r.revenue, 0);

  const th = 'px-4 py-2.5 text-left text-xs font-bold text-white uppercase tracking-wide whitespace-nowrap';
  const thR = `${th} text-right`;

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-700">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr style={{ backgroundColor: '#1a3a4a' }}>
            <th className={th} style={{ minWidth: 180 }}>Cost Centre T1</th>
            <th className={th} style={{ minWidth: 200 }}>Cost Centre</th>
            <th className={thR} style={{ minWidth: 140 }}>Revenue (R)</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => (
            <>
              {/* Tier 1 header row */}
              <tr key={`t1-${group.tier1}`} style={{ backgroundColor: '#1a3a4a' }}>
                <td className="px-4 py-2.5 font-bold text-white" colSpan={2}>
                  {group.tier1}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums font-bold text-white">
                  {fZAR(group.subtotal)}
                </td>
              </tr>
              {/* Tier 2 detail rows */}
              {group.items.map((item, i) => (
                <tr
                  key={`t2-${group.tier1}-${item.tier2}-${i}`}
                  className={i % 2 === 0 ? 'bg-gray-900' : 'bg-gray-800/60'}
                >
                  <td className="px-4 py-2 text-gray-500 text-xs" />
                  <td className="px-4 py-2 pl-8 text-gray-200">{item.tier2}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-gray-300">
                    {fZAR(item.revenue)}
                  </td>
                </tr>
              ))}
            </>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-gray-500 font-bold" style={{ backgroundColor: '#1a3a4a' }}>
            <td className="px-4 py-2.5 text-white font-bold" colSpan={2}>Grand Total</td>
            <td className="px-4 py-2.5 text-right tabular-nums text-white font-bold">
              {fZAR(grandTotal)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

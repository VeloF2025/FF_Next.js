/**
 * CostCentreRevenueTable — Fibertime T1 row with expand/collapse project children.
 * T1 row is collapsible; child rows show per-project revenue.
 */
'use client';

import { useState } from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';
import type { CostCentreRevenueItem } from '../project-revenue/useProjectRevenueData';

function fZAR(v: number) {
  const abs = Math.abs(Math.round(v));
  const s = abs.toLocaleString('en-ZA').replace(/,/g, '\u00a0');
  return `R\u00a0${s}`;
}

interface Props {
  rows: CostCentreRevenueItem[];
}

// 🟢 WORKING: Fibertime expand/collapse table with per-project revenue breakdown
export function CostCentreRevenueTable({ rows }: Props) {
  const [expandedRows, setExpandedRows] = useState<Set<string>>(
    () => new Set(rows.length > 0 ? [rows[0].tier1] : [])
  );

  function toggleRow(tier1: string) {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(tier1)) {
        next.delete(tier1);
      } else {
        next.add(tier1);
      }
      return next;
    });
  }

  const grandTotal = rows.reduce((s, r) => s + r.revenue, 0);

  const th =
    'px-4 py-2.5 text-left text-xs font-bold text-white uppercase tracking-wide whitespace-nowrap';
  const thR = `${th} text-right`;

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-700">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr style={{ backgroundColor: '#1a3a4a' }}>
            <th className={th} style={{ minWidth: 260 }}>
              Cost Centre T1
            </th>
            <th className={thR} style={{ minWidth: 160 }}>
              Revenue (R)
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const isExpanded = expandedRows.has(row.tier1);
            return (
              <>
                {/* T1 header row — clickable */}
                <tr
                  key={`t1-${row.tier1}`}
                  onClick={() => toggleRow(row.tier1)}
                  className="cursor-pointer select-none"
                  style={{ backgroundColor: '#1a3a4a' }}
                >
                  <td className="px-4 py-2.5 text-white font-bold">
                    <span className="inline-flex items-center gap-2">
                      {isExpanded ? (
                        <ChevronDown className="w-4 h-4 flex-shrink-0 text-blue-400" />
                      ) : (
                        <ChevronRight className="w-4 h-4 flex-shrink-0 text-blue-400" />
                      )}
                      {row.tier1}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-white font-bold">
                    {fZAR(row.revenue)}
                  </td>
                </tr>

                {/* Child project rows */}
                {isExpanded &&
                  row.children.map((child, ci) => (
                    <tr
                      key={`child-${row.tier1}-${child.project}`}
                      className={ci % 2 === 0 ? 'bg-gray-900' : 'bg-gray-800/60'}
                    >
                      <td className="px-4 py-2 pl-8 text-gray-200 border-l-2 border-blue-500/40">
                        {child.project}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-gray-300">
                        {fZAR(child.revenue)}
                      </td>
                    </tr>
                  ))}
              </>
            );
          })}
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

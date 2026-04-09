/**
 * CostCentreRevenueTable — Shareholder-quality COS vs Revenue profitability table.
 * T1 row (Fibertime) is collapsible; child rows show per-project breakdown.
 * Columns: Cost Centre | Revenue | COS | Gross Profit | Margin %
 */
'use client';

import { useState } from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';
import type { CostCentreRevenueItem } from '../project-revenue/useProjectRevenueData';

function fZAR(v: number): string {
  const abs = Math.abs(Math.round(v));
  const s = abs.toLocaleString('en-ZA').replace(/,/g, '\u00a0');
  return `R\u00a0${s}`;
}

function fPct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

function marginColor(margin: number): string {
  if (margin > 0.2) return 'text-green-400';
  if (margin >= 0.1) return 'text-yellow-400';
  return 'text-red-400';
}

interface Props {
  rows: CostCentreRevenueItem[];
}

const TH_BASE = 'px-4 py-2.5 text-xs font-bold text-white uppercase tracking-wide whitespace-nowrap';
const TH_LEFT = `${TH_BASE} text-left`;
const TH_RIGHT = `${TH_BASE} text-right`;

// 🟢 WORKING: Cost Centre Profitability table — COS vs Revenue shareholder view
export function CostCentreRevenueTable({ rows }: Props) {
  const [expandedRows, setExpandedRows] = useState<Set<string>>(
    () => new Set(rows.length > 0 && rows[0] ? [rows[0].tier1] : [])
  );

  function toggleRow(tier1: string) {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(tier1)) next.delete(tier1);
      else next.add(tier1);
      return next;
    });
  }

  const grandRevenue = rows.reduce((s, r) => s + r.revenue, 0);
  const grandCos = rows.reduce((s, r) => s + r.cos, 0);
  const grandGP = grandRevenue - grandCos;
  const grandMargin = grandRevenue !== 0 ? grandGP / grandRevenue : 0;

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-700">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr style={{ backgroundColor: '#1a3a4a' }}>
            <th className={TH_LEFT} style={{ minWidth: 260 }}>
              Cost Centre
            </th>
            <th className={TH_RIGHT} style={{ minWidth: 160 }}>
              Revenue
            </th>
            <th className={TH_RIGHT} style={{ minWidth: 160 }}>
              COS
            </th>
            <th className={TH_RIGHT} style={{ minWidth: 160 }}>
              Gross Profit
            </th>
            <th className={TH_RIGHT} style={{ minWidth: 100 }}>
              Margin
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
                  <td className="px-4 py-2.5 text-right tabular-nums text-white font-bold">
                    {fZAR(row.cos)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-bold text-white">
                    {fZAR(row.grossProfit)}
                  </td>
                  <td
                    className={`px-4 py-2.5 text-right tabular-nums font-bold ${marginColor(row.margin)}`}
                  >
                    {fPct(row.margin)}
                  </td>
                </tr>

                {/* Child project rows */}
                {isExpanded &&
                  row.children.map((child: { project: string; revenue: number; cos: number; grossProfit: number; margin: number }, ci: number) => (
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
                      <td className="px-4 py-2 text-right tabular-nums text-gray-300">
                        {fZAR(child.cos)}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-gray-300">
                        {fZAR(child.grossProfit)}
                      </td>
                      <td
                        className={`px-4 py-2 text-right tabular-nums ${marginColor(child.margin)}`}
                      >
                        {fPct(child.margin)}
                      </td>
                    </tr>
                  ))}

                {/* T1 totals row */}
                {isExpanded && (
                  <tr
                    key={`totals-${row.tier1}`}
                    className="border-t border-gray-600"
                    style={{ backgroundColor: '#1a3a4a' }}
                  >
                    <td className="px-4 py-2.5 pl-8 text-white font-bold text-xs uppercase tracking-wide">
                      {row.tier1} Total
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-white font-bold">
                      {fZAR(row.revenue)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-white font-bold">
                      {fZAR(row.cos)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-bold text-white">
                      {fZAR(row.grossProfit)}
                    </td>
                    <td
                      className={`px-4 py-2.5 text-right tabular-nums font-bold ${marginColor(row.margin)}`}
                    >
                      {fPct(row.margin)}
                    </td>
                  </tr>
                )}
              </>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-gray-500" style={{ backgroundColor: '#1a3a4a' }}>
            <td className="px-4 py-2.5 text-white font-bold">Grand Total</td>
            <td className="px-4 py-2.5 text-right tabular-nums text-white font-bold">
              {fZAR(grandRevenue)}
            </td>
            <td className="px-4 py-2.5 text-right tabular-nums text-white font-bold">
              {fZAR(grandCos)}
            </td>
            <td className="px-4 py-2.5 text-right tabular-nums font-bold text-white">
              {fZAR(grandGP)}
            </td>
            <td
              className={`px-4 py-2.5 text-right tabular-nums font-bold ${marginColor(grandMargin)}`}
            >
              {fPct(grandMargin)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

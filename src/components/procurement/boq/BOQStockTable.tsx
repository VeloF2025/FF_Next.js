/**
 * BOQStockTable — Excel-style table for BOQ stock view
 */
import type { BOQStockRow } from '@/pages/api/procurement/boq-stock-view';

function fmt(n: number): string {
  return n.toLocaleString('en-ZA', { maximumFractionDigits: 0 });
}

function fmtCurrency(n: number): string {
  return `R ${n.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function sohColor(soh: number, planned: number): string {
  if (planned === 0) return 'text-zinc-400';
  const ratio = soh / planned;
  if (ratio < 0.2) return 'text-red-400 font-medium';
  if (ratio < 0.5) return 'text-amber-400 font-medium';
  return 'text-emerald-400';
}

interface BOQStockTableProps {
  rows: BOQStockRow[];
  loading: boolean;
}

export function BOQStockTable({ rows, loading }: BOQStockTableProps) {
  if (loading) {
    return (
      <div className="flex flex-col gap-1 p-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-8 rounded bg-zinc-800 animate-pulse" />
        ))}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-zinc-500">
        <p className="text-sm">No BOQ items found</p>
        <p className="text-xs mt-1">Adjust filters or upload a BOQ to get started</p>
      </div>
    );
  }

  // Totals row
  const totals = rows.reduce(
    (acc, r) => ({
      plannedQty: acc.plannedQty + r.plannedQty,
      orderedQty: acc.orderedQty + r.orderedQty,
      deliveredQty: acc.deliveredQty + r.deliveredQty,
      soh: acc.soh + r.soh,
      totalValue: acc.totalValue + r.boqRate * r.plannedQty,
    }),
    { plannedQty: 0, orderedQty: 0, deliveredQty: 0, soh: 0, totalValue: 0 }
  );

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="sticky top-0 z-10 bg-zinc-900 border-b border-zinc-700">
            <th className="text-left px-3 py-2.5 font-medium text-zinc-400 w-8">#</th>
            <th className="text-left px-3 py-2.5 font-medium text-zinc-400 w-36">Code</th>
            <th className="text-left px-3 py-2.5 font-medium text-zinc-400">Description</th>
            <th className="text-left px-3 py-2.5 font-medium text-zinc-400 w-28">Category</th>
            <th className="text-right px-3 py-2.5 font-medium text-zinc-400 w-16">UOM</th>
            <th className="text-right px-3 py-2.5 font-medium text-zinc-400 w-28">BOQ Rate</th>
            <th className="text-right px-3 py-2.5 font-medium text-zinc-400 w-24">Planned</th>
            <th className="text-right px-3 py-2.5 font-medium text-zinc-400 w-24">Ordered</th>
            <th className="text-right px-3 py-2.5 font-medium text-zinc-400 w-24">Delivered</th>
            <th className="text-right px-3 py-2.5 font-medium text-zinc-400 w-24">SOH</th>
            <th className="text-right px-3 py-2.5 font-medium text-zinc-400 w-32">Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr
              key={`${row.itemCode ?? row.name}-${idx}`}
              className={
                idx % 2 === 0
                  ? 'bg-zinc-900/40 hover:bg-zinc-800/60'
                  : 'bg-zinc-800/20 hover:bg-zinc-800/60'
              }
            >
              <td className="px-3 py-2 text-zinc-500">{idx + 1}</td>
              <td className="px-3 py-2 text-zinc-400 font-mono truncate max-w-[140px]" title={row.itemCode ?? ''}>
                {row.itemCode ?? '—'}
              </td>
              <td className="px-3 py-2 text-zinc-200 max-w-xs">
                <span className="line-clamp-1" title={row.name}>{row.name}</span>
              </td>
              <td className="px-3 py-2 text-zinc-400">{row.category}</td>
              <td className="px-3 py-2 text-right text-zinc-400">{row.uom}</td>
              <td className="px-3 py-2 text-right text-zinc-300">{fmtCurrency(row.boqRate)}</td>
              <td className="px-3 py-2 text-right text-zinc-300">{fmt(row.plannedQty)}</td>
              <td className="px-3 py-2 text-right text-zinc-300">{fmt(row.orderedQty)}</td>
              <td className="px-3 py-2 text-right text-zinc-300">{fmt(row.deliveredQty)}</td>
              <td className={`px-3 py-2 text-right ${sohColor(row.soh, row.plannedQty)}`}>
                {fmt(row.soh)}
              </td>
              <td className="px-3 py-2 text-right font-semibold text-zinc-200">
                {fmtCurrency(row.boqRate * row.plannedQty)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-zinc-700 bg-zinc-900">
            <td colSpan={6} className="px-3 py-2.5 text-xs font-bold text-zinc-300">
              TOTALS ({rows.length} items)
            </td>
            <td className="px-3 py-2.5 text-right font-bold text-zinc-200">{fmt(totals.plannedQty)}</td>
            <td className="px-3 py-2.5 text-right font-bold text-zinc-200">{fmt(totals.orderedQty)}</td>
            <td className="px-3 py-2.5 text-right font-bold text-zinc-200">{fmt(totals.deliveredQty)}</td>
            <td className="px-3 py-2.5 text-right font-bold text-zinc-200">{fmt(totals.soh)}</td>
            <td className="px-3 py-2.5 text-right font-bold text-white">{fmtCurrency(totals.totalValue)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

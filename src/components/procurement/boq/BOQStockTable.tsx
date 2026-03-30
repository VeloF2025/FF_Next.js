/**
 * BOQStockTable — BOQ stock view with paired QTY + Value columns
 */
import type { BOQStockRow } from '@/pages/api/procurement/boq-stock-view';

function fmt(n: number): string {
  return n.toLocaleString('en-ZA', { maximumFractionDigits: 0 });
}

function fmtCurrency(n: number): string {
  return `R ${n.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function sohColor(soh: number, planned: number): string {
  if (planned === 0) return 'text-muted-foreground';
  const ratio = soh / planned;
  if (ratio < 0.2) return 'text-red-500 font-medium';
  if (ratio < 0.5) return 'text-amber-500 font-medium';
  return 'text-emerald-500';
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
          <div key={i} className="h-8 rounded bg-muted animate-pulse" />
        ))}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <p className="text-sm">No BOQ items found</p>
        <p className="text-xs mt-1">Adjust filters or upload a BOQ to get started</p>
      </div>
    );
  }

  const totals = rows.reduce(
    (acc, r) => ({
      plannedQty: acc.plannedQty + r.plannedQty,
      plannedValue: acc.plannedValue + r.boqRate * r.plannedQty,
      orderedQty: acc.orderedQty + r.orderedQty,
      orderedValue: acc.orderedValue + r.boqRate * r.orderedQty,
      deliveredQty: acc.deliveredQty + r.deliveredQty,
      deliveredValue: acc.deliveredValue + r.boqRate * r.deliveredQty,
      sohQty: acc.sohQty + r.soh,
      sohValue: acc.sohValue + r.boqRate * r.soh,
    }),
    {
      plannedQty: 0, plannedValue: 0,
      orderedQty: 0, orderedValue: 0,
      deliveredQty: 0, deliveredValue: 0,
      sohQty: 0, sohValue: 0,
    }
  );

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="bg-muted/50 border-b border-border">
              <th className="text-left px-3 py-2.5 font-medium text-muted-foreground w-8">#</th>
              <th className="text-left px-3 py-2.5 font-medium text-muted-foreground w-36">Code</th>
              <th className="text-left px-3 py-2.5 font-medium text-muted-foreground">Description</th>
              <th className="text-left px-3 py-2.5 font-medium text-muted-foreground w-28">Category</th>
              <th className="text-right px-3 py-2.5 font-medium text-muted-foreground w-16">UOM</th>
              <th className="text-right px-3 py-2.5 font-medium text-muted-foreground w-28 border-r border-border">BOQ Rate</th>
              <th className="text-right px-3 py-2.5 font-medium text-muted-foreground w-24">Planned QTY</th>
              <th className="text-right px-3 py-2.5 font-medium text-muted-foreground w-32 border-r border-border">Planned Value</th>
              <th className="text-right px-3 py-2.5 font-medium text-muted-foreground w-24">Ordered QTY</th>
              <th className="text-right px-3 py-2.5 font-medium text-muted-foreground w-32 border-r border-border">Ordered Value</th>
              <th className="text-right px-3 py-2.5 font-medium text-muted-foreground w-24">Delivered QTY</th>
              <th className="text-right px-3 py-2.5 font-medium text-muted-foreground w-32 border-r border-border">Delivered Value</th>
              <th className="text-right px-3 py-2.5 font-medium text-muted-foreground w-24">SOH QTY</th>
              <th className="text-right px-3 py-2.5 font-medium text-muted-foreground w-32">SOH Value</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr
                key={`${row.itemCode ?? row.name}-${idx}`}
                className={
                  idx % 2 === 0
                    ? 'bg-background hover:bg-muted/50'
                    : 'bg-muted/30 hover:bg-muted/50'
                }
              >
                <td className="px-3 py-2 text-muted-foreground">{idx + 1}</td>
                <td className="px-3 py-2 text-muted-foreground font-mono truncate max-w-[140px]" title={row.itemCode ?? ''}>
                  {row.itemCode ?? '—'}
                </td>
                <td className="px-3 py-2 text-foreground max-w-xs">
                  <span className="line-clamp-1" title={row.name}>{row.name}</span>
                </td>
                <td className="px-3 py-2 text-muted-foreground">{row.category}</td>
                <td className="px-3 py-2 text-right text-muted-foreground">{row.uom}</td>
                <td className="px-3 py-2 text-right text-foreground border-r border-border">{fmtCurrency(row.boqRate)}</td>
                <td className="px-3 py-2 text-right text-foreground">{fmt(row.plannedQty)}</td>
                <td className="px-3 py-2 text-right text-foreground border-r border-border">{fmtCurrency(row.boqRate * row.plannedQty)}</td>
                <td className="px-3 py-2 text-right text-foreground">{fmt(row.orderedQty)}</td>
                <td className="px-3 py-2 text-right text-foreground border-r border-border">{fmtCurrency(row.boqRate * row.orderedQty)}</td>
                <td className="px-3 py-2 text-right text-foreground">{fmt(row.deliveredQty)}</td>
                <td className="px-3 py-2 text-right text-foreground border-r border-border">{fmtCurrency(row.boqRate * row.deliveredQty)}</td>
                <td className={`px-3 py-2 text-right ${sohColor(row.soh, row.plannedQty)}`}>
                  {fmt(row.soh)}
                </td>
                <td className="px-3 py-2 text-right text-foreground">{fmtCurrency(row.boqRate * row.soh)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-border bg-muted/50">
              <td colSpan={6} className="px-3 py-2.5 text-xs font-semibold text-foreground border-r border-border">
                TOTALS ({rows.length} items)
              </td>
              <td className="px-3 py-2.5 text-right font-semibold text-foreground">{fmt(totals.plannedQty)}</td>
              <td className="px-3 py-2.5 text-right font-semibold text-foreground border-r border-border">{fmtCurrency(totals.plannedValue)}</td>
              <td className="px-3 py-2.5 text-right font-semibold text-foreground">{fmt(totals.orderedQty)}</td>
              <td className="px-3 py-2.5 text-right font-semibold text-foreground border-r border-border">{fmtCurrency(totals.orderedValue)}</td>
              <td className="px-3 py-2.5 text-right font-semibold text-foreground">{fmt(totals.deliveredQty)}</td>
              <td className="px-3 py-2.5 text-right font-semibold text-foreground border-r border-border">{fmtCurrency(totals.deliveredValue)}</td>
              <td className="px-3 py-2.5 text-right font-semibold text-foreground">{fmt(totals.sohQty)}</td>
              <td className="px-3 py-2.5 text-right font-semibold text-foreground">{fmtCurrency(totals.sohValue)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

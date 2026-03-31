/**
 * SOHAuditTable — Warehouse matrix table for SOH audit data
 */
import type { SOHAuditEntry } from '@/pages/api/procurement/soh-audit/versions';
import type { SOHWarehouse } from '@/pages/api/procurement/soh-audit/warehouses';

function fmt(n: number): string {
  return n > 0 ? n.toLocaleString('en-ZA', { maximumFractionDigits: 0 }) : '—';
}

interface SOHAuditTableProps {
  entries: SOHAuditEntry[];
  warehouses: SOHWarehouse[];
  loading: boolean;
}

export function SOHAuditTable({ entries, warehouses, loading }: SOHAuditTableProps) {
  if (loading) {
    return (
      <div className="flex flex-col gap-1 p-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-8 rounded bg-muted animate-pulse" />
        ))}
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
        <p className="text-sm font-medium">No audit data yet</p>
        <p className="text-xs opacity-60">Download the template, populate it, and import to get started</p>
      </div>
    );
  }

  // Totals per warehouse
  const totals: Record<string, number> = {};
  for (const wh of warehouses) {
    totals[wh.name] = entries.reduce((acc, e) => acc + (e.quantities[wh.name] ?? 0), 0);
  }

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <div className="overflow-auto max-h-[calc(100vh-320px)]">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="sticky top-0 z-10 bg-muted/50 border-b border-border">
              <th className="text-left px-3 py-2.5 font-medium text-muted-foreground w-8">#</th>
              <th className="text-left px-3 py-2.5 font-medium text-muted-foreground w-32">Code</th>
              <th className="text-left px-3 py-2.5 font-medium text-muted-foreground">Description</th>
              <th className="text-left px-3 py-2.5 font-medium text-muted-foreground w-28">Category</th>
              <th className="text-right px-3 py-2.5 font-medium text-muted-foreground w-12 border-r border-border">UOM</th>
              {warehouses.map((wh, i) => (
                <th
                  key={wh.id}
                  className={`text-right px-3 py-2.5 font-medium text-muted-foreground w-28 ${i < warehouses.length - 1 ? 'border-r border-border' : ''}`}
                >
                  {wh.name}
                </th>
              ))}
              <th className="text-left px-3 py-2.5 font-medium text-muted-foreground w-40">Notes</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry, idx) => (
              <tr
                key={entry.id}
                className={idx % 2 === 0 ? 'bg-background hover:bg-muted/50' : 'bg-muted/30 hover:bg-muted/50'}
              >
                <td className="px-3 py-2 text-muted-foreground">{idx + 1}</td>
                <td className="px-3 py-2 text-muted-foreground font-mono truncate max-w-[128px]" title={entry.item_code ?? ''}>
                  {entry.item_code ?? '—'}
                </td>
                <td className="px-3 py-2 text-foreground max-w-xs">
                  <span className="line-clamp-1" title={entry.item_name}>{entry.item_name}</span>
                </td>
                <td className="px-3 py-2 text-muted-foreground">{entry.category}</td>
                <td className="px-3 py-2 text-right text-muted-foreground border-r border-border">{entry.uom}</td>
                {warehouses.map((wh, i) => {
                  const qty = entry.quantities[wh.name] ?? 0;
                  return (
                    <td
                      key={wh.id}
                      className={`px-3 py-2 text-right ${qty > 0 ? 'text-foreground' : 'text-muted-foreground/40'} ${i < warehouses.length - 1 ? 'border-r border-border' : ''}`}
                    >
                      {fmt(qty)}
                    </td>
                  );
                })}
                <td className="px-3 py-2 text-muted-foreground text-xs">{entry.notes ?? ''}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-border bg-muted/50">
              <td colSpan={5} className="px-3 py-2.5 text-xs font-semibold text-foreground border-r border-border">
                TOTALS ({entries.length} items)
              </td>
              {warehouses.map((wh, i) => (
                <td
                  key={wh.id}
                  className={`px-3 py-2.5 text-right font-semibold text-foreground ${i < warehouses.length - 1 ? 'border-r border-border' : ''}`}
                >
                  {fmt(totals[wh.name] ?? 0)}
                </td>
              ))}
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

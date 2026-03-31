/**
 * BOQStockTable — Financial-grade table matching FibreFlow report styling
 * Clean light theme with column group headers, bold totals, subtle banding
 */
import type { BOQStockRow } from '@/pages/api/procurement/boq-stock-view';

function fmt(n: number): string {
  if (n === 0) return '—';
  return n.toLocaleString('en-ZA', { maximumFractionDigits: 0 });
}

function fmtR(n: number): string {
  if (n === 0) return '—';
  return `R ${n.toLocaleString('en-ZA', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function sohBg(soh: number, planned: number): string {
  if (planned === 0) return '';
  const ratio = soh / planned;
  if (ratio < 0.2) return 'text-red-600 font-semibold';
  if (ratio < 0.5) return 'text-amber-600 font-semibold';
  return 'text-emerald-700 font-semibold';
}

interface BOQStockTableProps {
  rows: BOQStockRow[];
  loading: boolean;
}

export function BOQStockTable({ rows, loading }: BOQStockTableProps) {
  if (loading) {
    return (
      <div className="flex flex-col gap-0.5 p-4 bg-white rounded-lg border border-gray-200">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className={`h-9 rounded ${i === 0 ? 'bg-gray-200' : 'bg-gray-100'} animate-pulse`} />
        ))}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 bg-white rounded-lg border border-gray-200 text-gray-400">
        <p className="text-sm font-medium">No BOQ items found</p>
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
    { plannedQty: 0, plannedValue: 0, orderedQty: 0, orderedValue: 0, deliveredQty: 0, deliveredValue: 0, sohQty: 0, sohValue: 0 }
  );

  // Shared cell classes
  const th = 'text-right px-3 py-2 text-[11px] font-semibold text-gray-600 bg-gray-50 border-b border-gray-200 whitespace-nowrap';
  const thLeft = 'text-left px-3 py-2 text-[11px] font-semibold text-gray-600 bg-gray-50 border-b border-gray-200 whitespace-nowrap';
  const thGroup = 'text-center px-3 py-1.5 text-[10px] font-bold tracking-widest uppercase text-white border-b border-gray-300';
  const td = 'text-right px-3 py-2.5 text-xs text-gray-700 whitespace-nowrap';
  const tdLeft = 'text-left px-3 py-2.5 text-xs text-gray-700';
  const tdFoot = 'text-right px-3 py-2.5 text-xs font-bold text-gray-900 whitespace-nowrap';
  const divider = 'border-l border-gray-200';

  return (
    <div className="rounded-lg overflow-hidden border border-gray-200 shadow-sm">
      <div className="overflow-auto max-h-[calc(100vh-280px)]">
        <table className="w-full text-xs border-collapse bg-white">
          <thead className="sticky top-0 z-10">
            {/* Group header row */}
            <tr>
              <th colSpan={6} className={`${thGroup} bg-[#1e2433] border-r border-gray-600`} />
              <th colSpan={2} className={`${thGroup} bg-[#1a3a5c] border-r border-gray-600`}>Planned</th>
              <th colSpan={2} className={`${thGroup} bg-[#1a3a2c] border-r border-gray-600`}>Ordered</th>
              <th colSpan={2} className={`${thGroup} bg-[#2d2a1a] border-r border-gray-600`}>Delivered</th>
              <th colSpan={2} className={`${thGroup} bg-[#2a1a3a]`}>SOH</th>
            </tr>
            {/* Column labels */}
            <tr className="bg-gray-50">
              <th className={`${thLeft} w-8`}>#</th>
              <th className={`${thLeft} w-36`}>Code</th>
              <th className={`${thLeft} min-w-[200px]`}>Description</th>
              <th className={`${thLeft} w-28`}>Category</th>
              <th className={`${th} w-12`}>UOM</th>
              <th className={`${th} w-28 border-r border-gray-300`}>BOQ Rate</th>
              <th className={`${th} w-24`}>QTY</th>
              <th className={`${th} w-32 border-r border-gray-300`}>Value</th>
              <th className={`${th} w-24`}>QTY</th>
              <th className={`${th} w-32 border-r border-gray-300`}>Value</th>
              <th className={`${th} w-24`}>QTY</th>
              <th className={`${th} w-32 border-r border-gray-300`}>Value</th>
              <th className={`${th} w-24`}>QTY</th>
              <th className={`${th} w-32`}>Value</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => {
              const even = idx % 2 === 0;
              const bg = even ? 'bg-white' : 'bg-gray-50/60';
              return (
                <tr key={`${row.itemCode ?? row.name}-${idx}`} className={`${bg} hover:bg-blue-50/40 transition-colors`}>
                  <td className={`${tdLeft} text-gray-400 w-8`}>{idx + 1}</td>
                  <td className={`${tdLeft} text-gray-500 font-mono truncate max-w-[140px]`} title={row.itemCode ?? ''}>
                    {row.itemCode ?? '—'}
                  </td>
                  <td className={`${tdLeft} max-w-xs`}>
                    <span className="line-clamp-1" title={row.name}>{row.name}</span>
                  </td>
                  <td className={`${tdLeft} text-gray-500`}>{row.category}</td>
                  <td className={`${td} text-gray-500`}>{row.uom}</td>
                  <td className={`${td} text-gray-800 border-r border-gray-200`}>{fmtR(row.boqRate)}</td>
                  <td className={`${td} text-gray-800`}>{fmt(row.plannedQty)}</td>
                  <td className={`${td} text-gray-800 border-r border-gray-200`}>{fmtR(row.boqRate * row.plannedQty)}</td>
                  <td className={`${td} text-gray-800`}>{fmt(row.orderedQty)}</td>
                  <td className={`${td} text-gray-800 border-r border-gray-200`}>{fmtR(row.boqRate * row.orderedQty)}</td>
                  <td className={`${td} text-gray-800`}>{fmt(row.deliveredQty)}</td>
                  <td className={`${td} text-gray-800 border-r border-gray-200`}>{fmtR(row.boqRate * row.deliveredQty)}</td>
                  <td className={`${td} ${sohBg(row.soh, row.plannedQty)}`}>{fmt(row.soh)}</td>
                  <td className={`${td} text-gray-800`}>{fmtR(row.boqRate * row.soh)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="bg-gray-100 border-t-2 border-gray-300">
              <td colSpan={6} className="px-3 py-2.5 text-xs font-bold text-gray-900 border-r border-gray-300">
                TOTALS — {rows.length} items
              </td>
              <td className={tdFoot}>{fmt(totals.plannedQty)}</td>
              <td className={`${tdFoot} border-r border-gray-300`}>{fmtR(totals.plannedValue)}</td>
              <td className={tdFoot}>{fmt(totals.orderedQty)}</td>
              <td className={`${tdFoot} border-r border-gray-300`}>{fmtR(totals.orderedValue)}</td>
              <td className={tdFoot}>{fmt(totals.deliveredQty)}</td>
              <td className={`${tdFoot} border-r border-gray-300`}>{fmtR(totals.deliveredValue)}</td>
              <td className={tdFoot}>{fmt(totals.sohQty)}</td>
              <td className={tdFoot}>{fmtR(totals.sohValue)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

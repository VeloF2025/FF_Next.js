/**
 * BOQStockTable — Dark-themed financial table matching FibreFlow design system
 * Colours: --ff-bg-primary (#0f172a) / --ff-bg-secondary (#1e293b) / --ff-primary-500 (#3b82f6)
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

function sohColor(soh: number, planned: number): string {
  if (planned === 0) return 'text-slate-400';
  const ratio = soh / planned;
  if (ratio < 0.2) return 'text-red-400 font-semibold';
  if (ratio < 0.5) return 'text-amber-400 font-semibold';
  return 'text-emerald-400 font-semibold';
}

interface BOQStockTableProps {
  rows: BOQStockRow[];
  loading: boolean;
}

export function BOQStockTable({ rows, loading }: BOQStockTableProps) {
  if (loading) {
    return (
      <div className="flex flex-col gap-0.5 p-4 rounded-lg border border-[var(--ff-border-light)]" style={{ background: 'var(--ff-bg-secondary)' }}>
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="h-9 rounded animate-pulse" style={{ background: i === 0 ? 'var(--ff-bg-tertiary)' : 'var(--ff-bg-primary)' }} />
        ))}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 rounded-lg border border-[var(--ff-border-light)] text-[var(--ff-text-tertiary)]" style={{ background: 'var(--ff-bg-secondary)' }}>
        <p className="text-sm font-medium">No BOQ items found</p>
        <p className="text-xs mt-1 opacity-60">Adjust filters or upload a BOQ to get started</p>
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

  return (
    <div className="rounded-lg overflow-hidden border border-[var(--ff-border-light)]" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.4)' }}>
      <div className="overflow-auto max-h-[calc(100vh-280px)]">
        <table className="w-full text-xs border-collapse">

          <thead className="sticky top-0 z-10">
            {/* Group header row */}
            <tr>
              {/* Item columns — no group label */}
              <th colSpan={6}
                style={{ background: '#0c1424', borderBottom: '1px solid #1e293b', borderRight: '1px solid #334155' }}
                className="px-3 py-1.5" />
              {/* Planned */}
              <th colSpan={2}
                style={{ background: '#1a3a5c', borderBottom: '1px solid #1e293b', borderRight: '1px solid #334155' }}
                className="text-center px-3 py-1.5 text-[10px] font-bold tracking-widest uppercase text-blue-300">
                Planned
              </th>
              {/* Ordered */}
              <th colSpan={2}
                style={{ background: '#1a3a2c', borderBottom: '1px solid #1e293b', borderRight: '1px solid #334155' }}
                className="text-center px-3 py-1.5 text-[10px] font-bold tracking-widest uppercase text-emerald-300">
                Ordered
              </th>
              {/* Delivered */}
              <th colSpan={2}
                style={{ background: '#2d2a1a', borderBottom: '1px solid #1e293b', borderRight: '1px solid #334155' }}
                className="text-center px-3 py-1.5 text-[10px] font-bold tracking-widest uppercase text-amber-300">
                Delivered
              </th>
              {/* SOH */}
              <th colSpan={2}
                style={{ background: '#2a1a3a', borderBottom: '1px solid #1e293b' }}
                className="text-center px-3 py-1.5 text-[10px] font-bold tracking-widest uppercase text-purple-300">
                SOH
              </th>
            </tr>

            {/* Column labels */}
            <tr style={{ background: '#0f172a', borderBottom: '2px solid #1e3a8a' }}>
              <th className="text-left px-3 py-2.5 text-[11px] font-semibold text-slate-400 w-8">#</th>
              <th className="text-left px-3 py-2.5 text-[11px] font-semibold text-slate-400 w-36 whitespace-nowrap">Code</th>
              <th className="text-left px-3 py-2.5 text-[11px] font-semibold text-slate-400 min-w-[200px]">Description</th>
              <th className="text-left px-3 py-2.5 text-[11px] font-semibold text-slate-400 w-28 whitespace-nowrap">Category</th>
              <th className="text-right px-3 py-2.5 text-[11px] font-semibold text-slate-400 w-12">UOM</th>
              <th className="text-right px-3 py-2.5 text-[11px] font-semibold text-slate-400 w-28 whitespace-nowrap" style={{ borderRight: '1px solid #334155' }}>BOQ Rate</th>
              <th className="text-right px-3 py-2.5 text-[11px] font-semibold text-blue-400 w-24">QTY</th>
              <th className="text-right px-3 py-2.5 text-[11px] font-semibold text-blue-400 w-32 whitespace-nowrap" style={{ borderRight: '1px solid #334155' }}>Value</th>
              <th className="text-right px-3 py-2.5 text-[11px] font-semibold text-emerald-400 w-24">QTY</th>
              <th className="text-right px-3 py-2.5 text-[11px] font-semibold text-emerald-400 w-32 whitespace-nowrap" style={{ borderRight: '1px solid #334155' }}>Value</th>
              <th className="text-right px-3 py-2.5 text-[11px] font-semibold text-amber-400 w-24">QTY</th>
              <th className="text-right px-3 py-2.5 text-[11px] font-semibold text-amber-400 w-32 whitespace-nowrap" style={{ borderRight: '1px solid #334155' }}>Value</th>
              <th className="text-right px-3 py-2.5 text-[11px] font-semibold text-purple-400 w-24">QTY</th>
              <th className="text-right px-3 py-2.5 text-[11px] font-semibold text-purple-400 w-32 whitespace-nowrap">Value</th>
            </tr>
          </thead>

          <tbody>
            {rows.map((row, idx) => {
              const even = idx % 2 === 0;
              return (
                <tr
                  key={`${row.itemCode ?? row.name}-${idx}`}
                  style={{
                    background: even ? '#0d1424' : '#1e293b',
                    borderBottom: '1px solid #1e293b',
                  }}
                  className="hover:bg-blue-950/40 transition-colors"
                  onMouseEnter={e => (e.currentTarget.style.background = '#1a2744')}
                  onMouseLeave={e => (e.currentTarget.style.background = even ? '#0d1424' : '#1e293b')}
                >
                  <td className="px-3 py-2.5 text-slate-500 text-[11px]">{idx + 1}</td>
                  <td className="px-3 py-2.5 text-slate-400 font-mono text-[11px] truncate max-w-[140px]" title={row.itemCode ?? ''}>
                    {row.itemCode ?? '—'}
                  </td>
                  <td className="px-3 py-2.5 text-slate-200 max-w-xs">
                    <span className="line-clamp-1" title={row.name}>{row.name}</span>
                  </td>
                  <td className="px-3 py-2.5 text-slate-400">{row.category}</td>
                  <td className="px-3 py-2.5 text-right text-slate-400">{row.uom}</td>
                  <td className="px-3 py-2.5 text-right text-slate-300" style={{ borderRight: '1px solid #1e293b' }}>{fmtR(row.boqRate)}</td>
                  <td className="px-3 py-2.5 text-right text-slate-200">{fmt(row.plannedQty)}</td>
                  <td className="px-3 py-2.5 text-right text-slate-300" style={{ borderRight: '1px solid #1e293b' }}>{fmtR(row.boqRate * row.plannedQty)}</td>
                  <td className="px-3 py-2.5 text-right text-slate-200">{fmt(row.orderedQty)}</td>
                  <td className="px-3 py-2.5 text-right text-slate-300" style={{ borderRight: '1px solid #1e293b' }}>{fmtR(row.boqRate * row.orderedQty)}</td>
                  <td className="px-3 py-2.5 text-right text-slate-200">{fmt(row.deliveredQty)}</td>
                  <td className="px-3 py-2.5 text-right text-slate-300" style={{ borderRight: '1px solid #1e293b' }}>{fmtR(row.boqRate * row.deliveredQty)}</td>
                  <td className={`px-3 py-2.5 text-right ${sohColor(row.soh, row.plannedQty)}`}>{fmt(row.soh)}</td>
                  <td className="px-3 py-2.5 text-right text-slate-300">{fmtR(row.boqRate * row.soh)}</td>
                </tr>
              );
            })}
          </tbody>

          <tfoot>
            <tr style={{ background: '#0c1424', borderTop: '2px solid #1e3a8a' }}>
              <td colSpan={6} className="px-3 py-3 text-xs font-bold text-slate-200" style={{ borderRight: '1px solid #334155' }}>
                TOTALS — {rows.length} items
              </td>
              <td className="px-3 py-3 text-right text-xs font-bold text-blue-300">{fmt(totals.plannedQty)}</td>
              <td className="px-3 py-3 text-right text-xs font-bold text-blue-300" style={{ borderRight: '1px solid #334155' }}>{fmtR(totals.plannedValue)}</td>
              <td className="px-3 py-3 text-right text-xs font-bold text-emerald-300">{fmt(totals.orderedQty)}</td>
              <td className="px-3 py-3 text-right text-xs font-bold text-emerald-300" style={{ borderRight: '1px solid #334155' }}>{fmtR(totals.orderedValue)}</td>
              <td className="px-3 py-3 text-right text-xs font-bold text-amber-300">{fmt(totals.deliveredQty)}</td>
              <td className="px-3 py-3 text-right text-xs font-bold text-amber-300" style={{ borderRight: '1px solid #334155' }}>{fmtR(totals.deliveredValue)}</td>
              <td className="px-3 py-3 text-right text-xs font-bold text-purple-300">{fmt(totals.sohQty)}</td>
              <td className="px-3 py-3 text-right text-xs font-bold text-purple-300">{fmtR(totals.sohValue)}</td>
            </tr>
          </tfoot>

        </table>
      </div>
    </div>
  );
}

'use client';

import type { PonRow } from '../types';
import { ColumnFilter } from './ColumnFilter';

const COLS = [
  { key: 'zone_no', label: 'Zone', type: 'number', width: 60 },
  { key: 'hld_pon', label: 'HLD PON', type: 'number', width: 80 },
  { key: 'z_pon', label: 'Z-PON', type: 'number', width: 70 },
  { key: 'olt_port', label: 'OLT Port', type: 'text', width: 90 },
  { key: 'scope_poles', label: 'Scope Poles', type: 'number', width: 90 },
  { key: 'scope_drops', label: 'Scope Drops', type: 'number', width: 90 },
  { key: 'pole_permission', label: 'Pole Permission', type: 'date', width: 130 },
  { key: 'poles_planted', label: 'Poles Planted', type: 'number', width: 100 },
  { key: 'cwc_poles_date', label: 'CWC Poles', type: 'date', width: 110 },
  { key: 'cwc_stringing_date', label: 'CWC Stringing', type: 'date', width: 120 },
  { key: 'ready_for_optical', label: 'Ready Optical', type: 'date', width: 120 },
  { key: 'cwc_qa', label: 'CWC QA', type: 'checkbox', width: 70 },
  { key: 'optical_splicing_date', label: 'Opt. Splicing', type: 'date', width: 120 },
  { key: 'optical_submitted_date', label: 'Opt. Submitted', type: 'date', width: 125 },
  { key: 'optical_activated_date', label: 'ATP', type: 'date', width: 125 },
  { key: 'atp_qa', label: 'ATP QA', type: 'checkbox', width: 70 },
  { key: 'sign_ups', label: 'Sign-ups', type: 'number', width: 80 },
  { key: 'homes_po', label: 'Homes PO', type: 'number', width: 85 },
  { key: 'homes_recon', label: 'Homes Recon', type: 'number', width: 100 },
  { key: 'activated', label: 'Activated', type: 'number', width: 85 },
  { key: 'available', label: 'Available', type: 'number', width: 85 },
  { key: 'blockage', label: 'Blockage', type: 'text', width: 200 },
] as const;

const NUMERIC_KEYS = COLS.filter((c) => c.type === 'number').map((c) => c.key);

interface Props {
  rows: PonRow[];
  editMode: boolean;
  onChange: (rows: PonRow[]) => void;
  filters: Record<string, Set<string>>;
  onFiltersChange: (filters: Record<string, Set<string>>) => void;
}

function sumCol(rows: PonRow[], key: string): number {
  return rows.reduce((acc, r) => acc + (Number((r as unknown as Record<string, unknown>)[key]) || 0), 0);
}

export function PonTrackerTable({ rows, editMode, onChange, filters, onFiltersChange }: Props) {
  function updateCell(idx: number, key: string, value: unknown) {
    const next = rows.map((r, i) => (i === idx ? { ...r, [key]: value } : r));
    onChange(next);
  }

  // Filter visible rows based on active filters
  const visibleRows = rows.filter((row) =>
    COLS.every((col) => {
      const f = filters[col.key];
      if (!f || f.size === 0) return true;
      const val = String((row as unknown as Record<string, unknown>)[col.key] ?? '');
      return !f.has(val);
    })
  );

  return (
    <div className="overflow-x-auto rounded border border-slate-700">
      <table className="text-xs border-collapse" style={{ minWidth: COLS.reduce((a, c) => a + c.width, 0) }}>
        <thead className="sticky top-0 z-10 bg-slate-800 text-slate-300">
          <tr>
            {COLS.map((c) => {
              const frozen = ['zone_no','hld_pon','z_pon'] as const;
              const offsets: Record<string, number> = { zone_no: 0, hld_pon: 60, z_pon: 140 };
              const isFrozen = (frozen as readonly string[]).includes(c.key);
              return (
                <th
                  key={c.key}
                  style={{ width: c.width, minWidth: c.width, ...(isFrozen ? { left: offsets[c.key] } : {}) }}
                  className={`px-2 py-2 text-left font-medium border-b border-slate-700 whitespace-nowrap ${isFrozen ? 'sticky z-20 bg-slate-800' : ''}`}
                >
                  <div className="flex items-center gap-1">
                    {c.label}
                    <ColumnFilter
                      column={c.label}
                      values={[...new Set(rows.map((r) => String((r as unknown as Record<string, unknown>)[c.key] ?? '')))].sort()}
                      selected={filters[c.key] ?? new Set()}
                      onChange={(sel) => onFiltersChange({ ...filters, [c.key]: sel })}
                    />
                  </div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {visibleRows.map((row, _visIdx) => {
            const idx = rows.indexOf(row);
            return (
            <tr
              key={row.id}
              className={`border-b border-slate-800 hover:bg-slate-800/50 ${row.blockage ? 'border-l-2 border-l-amber-500' : ''}`}
            >
              {COLS.map((col) => {
                const val = (row as unknown as Record<string, unknown>)[col.key];
                if (!editMode) {
                  if (col.type === 'checkbox') {
                    return (
                      <td key={col.key} className="px-2 py-1 text-center">
                        <span className={`inline-block w-3 h-3 rounded-full ${val ? 'bg-green-500' : 'bg-slate-600'}`} />
                      </td>
                    );
                  }
                  const isFrozenCell = (['zone_no','hld_pon','z_pon'] as const).includes(col.key as 'zone_no'|'hld_pon'|'z_pon');
                  const frozenOffsets: Record<string, number> = { zone_no: 0, hld_pon: 60, z_pon: 140 };
                  return (
                    <td key={col.key}
                      style={isFrozenCell ? { left: frozenOffsets[col.key] } : {}}
                      className={`px-2 py-1 text-slate-300 truncate max-w-[200px] ${isFrozenCell ? 'sticky z-10 bg-slate-900' : ''}`}
                      title={String(val ?? '')}>
                      {val != null && val !== '' ? String(val) : '—'}
                    </td>
                  );
                }
                if (col.type === 'checkbox') {
                  return (
                    <td key={col.key} className="px-2 py-1 text-center">
                      <input
                        type="checkbox"
                        checked={Boolean(val)}
                        onChange={(e) => updateCell(idx, col.key, e.target.checked)}
                        className="w-4 h-4 accent-green-500"
                      />
                    </td>
                  );
                }
                return (
                  <td key={col.key} className="px-1 py-0.5">
                    <input
                      type={col.type}
                      value={val != null ? String(val) : ''}
                      onChange={(e) =>
                        updateCell(idx, col.key, col.type === 'number' ? (e.target.value === '' ? null : Number(e.target.value)) : e.target.value)
                      }
                      className="w-full bg-slate-900 border border-slate-600 rounded px-1 py-0.5 text-slate-200 focus:outline-none focus:border-blue-500"
                      style={{ minWidth: col.width - 8 }}
                    />
                  </td>
                );
              })}
            </tr>
          );
          })}
        </tbody>
        {rows.length > 0 && (
          <tfoot className="bg-slate-800 font-semibold text-slate-300 sticky bottom-0">
            <tr>
              {COLS.map((col) => (
                <td key={col.key} className="px-2 py-1 border-t border-slate-700">
                  {NUMERIC_KEYS.includes(col.key as typeof NUMERIC_KEYS[number])
                    ? (() => { const total = sumCol(rows, col.key); return total !== 0 ? total : '—'; })()
                    : col.key === 'zone_no'
                    ? 'TOTAL'
                    : ''}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
      {rows.length === 0 && (
        <div className="py-12 text-center text-slate-500">
          No rows yet.{editMode ? ' Click "Add Row" to start.' : ' Enable Edit mode to add rows.'}
        </div>
      )}
    </div>
  );
}

import type { NextPage } from 'next';
import { useEffect, useMemo, useState } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';

interface SummaryRow {
  snapshot_date: string;
  source_tab: string;
  sites: number;
  lines: number;
  total_qty: number;
  total_value: number;
}
interface DetailRow {
  item_code: string;
  item_name: string | null;
  category: string | null;
  site_label: string;
  warehouse_code: string | null;
  quantity: number;
  unit_cost: number | null;
  line_value: number | null;
  in_ff_catalog: boolean;
}

const fmtInt = (n: number) => Math.round(n).toLocaleString('en-ZA').replace(/,/g, ' ');
const fmtRand = (n: number) => (n ? `R ${fmtInt(n)}` : '—');
const fmtDate = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('en-ZA', {
    day: 'numeric', month: 'short', year: 'numeric',
  });

interface PivotItem {
  item_code: string;
  item_name: string | null;
  category: string | null;
  in_ff_catalog: boolean;
  bySite: Record<string, number>;
  total: number;
}

function buildPivot(rows: DetailRow[]): { items: PivotItem[]; sites: string[] } {
  const siteSet = new Set<string>();
  const map = new Map<string, PivotItem>();
  for (const r of rows) {
    siteSet.add(r.site_label);
    let it = map.get(r.item_code);
    if (!it) {
      it = {
        item_code: r.item_code, item_name: r.item_name, category: r.category,
        in_ff_catalog: r.in_ff_catalog, bySite: {}, total: 0,
      };
      map.set(r.item_code, it);
    }
    it.bySite[r.site_label] = (it.bySite[r.site_label] || 0) + r.quantity;
    it.total += r.quantity;
  }
  const sites = [...siteSet].sort();
  const items = [...map.values()].sort(
    (a, b) =>
      (a.category || '~').localeCompare(b.category || '~') ||
      a.item_code.localeCompare(b.item_code)
  );
  return { items, sites };
}

const StockSnapshotsPage: NextPage = () => {
  const [summary, setSummary] = useState<SummaryRow[]>([]);
  const [selected, setSelected] = useState<{ date: string; source: string } | null>(null);
  const [rows, setRows] = useState<DetailRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/procurement/stock-snapshots')
      .then((r) => r.json())
      .then((j) => {
        if (!j.success) throw new Error(j.error?.message || 'Load failed');
        const s: SummaryRow[] = j.data.summary;
        setSummary(s);
        if (s[0]) setSelected({ date: s[0].snapshot_date, source: s[0].source_tab });
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selected) return;
    setDetailLoading(true);
    const url = `/api/procurement/stock-snapshots?date=${selected.date}&source=${encodeURIComponent(selected.source)}`;
    fetch(url)
      .then((r) => r.json())
      .then((j) => {
        if (!j.success) throw new Error(j.error?.message || 'Load failed');
        setRows(j.data.rows);
      })
      .catch((e) => setError(e.message))
      .finally(() => setDetailLoading(false));
  }, [selected]);

  const { items, sites } = useMemo(() => buildPivot(rows), [rows]);
  const active = summary.find(
    (s) => selected && s.snapshot_date === selected.date && s.source_tab === selected.source
  );

  return (
    <AppLayout>
      <div className="p-4 space-y-4">
        <div>
          <h1 className="text-xl font-semibold text-[var(--ff-text-primary)]">
            Physical Stock Takes — History
          </h1>
          <p className="text-sm text-[var(--ff-text-tertiary)]">
            Weekly physical counts imported from the SharePoint workbook. Reference only —
            these snapshots never change live stock levels.
          </p>
        </div>

        {error && (
          <div className="p-3 bg-red-500/10 border border-red-500/30 rounded text-sm text-red-400">
            {error}
          </div>
        )}
        {loading && <div className="text-sm text-[var(--ff-text-tertiary)]">Loading…</div>}

        {/* Snapshot timeline (selector doubles as the qty/value trend) */}
        {!loading && (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {summary.map((s) => {
              const isSel = active === s;
              return (
                <button
                  key={`${s.snapshot_date}-${s.source_tab}`}
                  onClick={() => setSelected({ date: s.snapshot_date, source: s.source_tab })}
                  className={`shrink-0 text-left px-3 py-2 rounded border min-w-[9rem] transition-colors ${
                    isSel
                      ? 'border-blue-500 bg-blue-500/10'
                      : 'border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)] hover:bg-[var(--ff-bg-hover)]'
                  }`}
                >
                  <div className="text-sm font-medium text-[var(--ff-text-primary)]">
                    {fmtDate(s.snapshot_date)}
                  </div>
                  <div className="text-xs text-[var(--ff-text-tertiary)] truncate">
                    {s.source_tab.replace(/S(ite)?s? Stock Take/i, '').trim() || s.source_tab}
                  </div>
                  <div className="mt-1 text-xs tabular-nums text-[var(--ff-text-secondary)]">
                    {fmtInt(s.total_qty)} units
                  </div>
                  <div className="text-xs tabular-nums text-[var(--ff-text-tertiary)]">
                    {fmtRand(s.total_value)}
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* Summary cards for the selected snapshot */}
        {active && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              ['Date', fmtDate(active.snapshot_date)],
              ['Sites counted', String(active.sites)],
              ['On-hand units', fmtInt(active.total_qty)],
              ['Counted value', fmtRand(active.total_value)],
            ].map(([label, val]) => (
              <div
                key={label}
                className="p-3 rounded border border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)]"
              >
                <div className="text-xs uppercase tracking-wide text-[var(--ff-text-tertiary)]">
                  {label}
                </div>
                <div className="text-lg font-semibold tabular-nums text-[var(--ff-text-primary)]">
                  {val}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Pivot: items × sites */}
        {detailLoading && (
          <div className="text-sm text-[var(--ff-text-tertiary)]">Loading count…</div>
        )}
        {!detailLoading && active && (
          <div className="overflow-x-auto border border-[var(--ff-border-light)] rounded">
            <table className="min-w-full text-sm">
              <thead className="bg-[var(--ff-bg-tertiary)]">
                <tr className="text-[var(--ff-text-tertiary)]">
                  <th className="text-left font-medium px-3 py-2 sticky left-0 bg-[var(--ff-bg-tertiary)]">
                    Item
                  </th>
                  {sites.map((s) => (
                    <th key={s} className="text-right font-medium px-3 py-2 whitespace-nowrap">
                      {s}
                    </th>
                  ))}
                  <th className="text-right font-medium px-3 py-2">Total</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr
                    key={it.item_code}
                    className="border-t border-[var(--ff-border-light)] hover:bg-[var(--ff-bg-hover)]"
                  >
                    <td className="px-3 py-1.5 sticky left-0 bg-[var(--ff-bg-secondary)]">
                      <div className="font-medium text-[var(--ff-text-primary)] whitespace-nowrap">
                        {it.item_code}
                        {!it.in_ff_catalog && (
                          <span className="ml-2 text-xs text-amber-400">not in catalog</span>
                        )}
                      </div>
                      <div className="text-xs text-[var(--ff-text-tertiary)] truncate max-w-[22rem]">
                        {it.item_name || ''}
                      </div>
                    </td>
                    {sites.map((s) => (
                      <td
                        key={s}
                        className="px-3 py-1.5 text-right tabular-nums text-[var(--ff-text-secondary)]"
                      >
                        {it.bySite[s] ? fmtInt(it.bySite[s]) : ''}
                      </td>
                    ))}
                    <td className="px-3 py-1.5 text-right tabular-nums font-semibold text-[var(--ff-text-primary)]">
                      {fmtInt(it.total)}
                    </td>
                  </tr>
                ))}
                {items.length === 0 && (
                  <tr>
                    <td
                      colSpan={sites.length + 2}
                      className="px-3 py-6 text-center text-[var(--ff-text-tertiary)]"
                    >
                      No counts recorded for this snapshot.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppLayout>
  );
};

export default StockSnapshotsPage;

export const getServerSideProps = async () => ({ props: {} });

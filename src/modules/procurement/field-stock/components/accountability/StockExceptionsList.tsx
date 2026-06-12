/**
 * StockExceptionsList Component
 * Held serials cross-checked against OES/WA activations, classified as exceptions.
 * Grouped/sorted by holder with a class badge, project + class filters and search.
 * The holder name opens the holder-detail drawer (via onSelectHolder).
 */

'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, Search, Filter, ShieldAlert, Clock } from 'lucide-react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import type { StockException, ExceptionClass } from '../../hooks/useStockExceptions';

interface Props {
  exceptions: StockException[];
  loading?: boolean;
  /** Open the holder-detail drawer for the given holder. */
  onSelectHolder?: (holderId: string) => void;
}

const CLASS_META: Record<ExceptionClass, { label: string; cls: string; title: string }> = {
  cross_dr_conflict: {
    label: 'Cross-DR',
    cls: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
    title: 'Activated under a different DR than where it was WhatsApp-scanned',
  },
  installed_not_cleared: {
    label: 'Installed, not cleared',
    cls: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
    title: 'Has OES/WA activation evidence but is still held — should have been consumed',
  },
  aged_no_evidence: {
    label: 'Aged, no evidence',
    cls: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
    title: 'Held 30+ days with no activation evidence — recovery candidate',
  },
  recent_no_evidence: {
    label: 'Recent',
    cls: 'bg-gray-100 text-gray-600 dark:bg-gray-700/60 dark:text-gray-300',
    title: 'Held <30 days, no evidence yet — normal in-field stock',
  },
};

function StatCard({ icon, value, label }: { icon: React.ReactNode; value: number; label: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 dark:border-gray-700 dark:bg-gray-800">
      <div className="flex items-center gap-3">
        <div className="rounded-lg p-2">{icon}</div>
        <div>
          <p className="text-2xl font-bold text-foreground">{value}</p>
          <p className="text-sm text-muted-foreground">{label}</p>
        </div>
      </div>
    </div>
  );
}

export function StockExceptionsList({ exceptions, loading, onSelectHolder }: Props) {
  const [search, setSearch] = useState('');
  const [classFilter, setClassFilter] = useState<'all' | ExceptionClass>('all');
  const [projectFilter, setProjectFilter] = useState<string>('all');

  const projects = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of exceptions) {
      const key = e.project_id ?? 'unassigned';
      if (!map.has(key)) map.set(key, e.project_name ?? 'Unassigned');
    }
    return Array.from(map, ([id, name]) => ({ id, name }));
  }, [exceptions]);

  const filtered = exceptions.filter((e) => {
    if (classFilter !== 'all' && e.exception_class !== classFilter) return false;
    if (projectFilter !== 'all' && (e.project_id ?? 'unassigned') !== projectFilter) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return e.holder_name.toLowerCase().includes(q) || e.serial_number.toLowerCase().includes(q);
  });

  if (loading) return <LoadingSpinner className="py-12" size="lg" label="" />;

  const crossDr = exceptions.filter((e) => e.exception_class === 'cross_dr_conflict').length;
  const aged = exceptions.filter((e) => e.exception_class === 'aged_no_evidence').length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input type="text" placeholder="Search holder or serial..." value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-border bg-card py-2 pl-10 pr-4 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white" />
        </div>
        <div className="relative">
          <Filter className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <select value={classFilter} onChange={(e) => setClassFilter(e.target.value as typeof classFilter)}
            className="appearance-none rounded-lg border border-border bg-card py-2 pl-10 pr-8 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white">
            <option value="all">All Classes</option>
            <option value="cross_dr_conflict">Cross-DR</option>
            <option value="installed_not_cleared">Installed, not cleared</option>
            <option value="aged_no_evidence">Aged, no evidence</option>
            <option value="recent_no_evidence">Recent</option>
          </select>
        </div>
        {projects.length > 1 && (
          <select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)}
            className="appearance-none rounded-lg border border-border bg-card py-2 px-4 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white">
            <option value="all">All Projects</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard icon={<AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />} value={exceptions.length} label="Total Exceptions" />
        <StatCard icon={<ShieldAlert className="h-5 w-5 text-red-600 dark:text-red-400" />} value={crossDr} label="Cross-DR Conflicts" />
        <StatCard icon={<Clock className="h-5 w-5 text-orange-600 dark:text-orange-400" />} value={aged} label="Aged, No Evidence" />
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-8 text-center dark:border-gray-700 dark:bg-gray-800">
          <AlertTriangle className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-2 text-sm font-medium text-foreground">No exceptions found</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {search || classFilter !== 'all' || projectFilter !== 'all'
              ? 'Try adjusting your filters'
              : 'Held stock with activation mismatches will appear here'}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-input">
              <tr>
                {(['Holder', 'Class', 'Serial', 'Item', 'Project', 'DR', 'Aged'] as const).map((col) => (
                  <th key={col} className={`px-4 py-3 text-xs font-medium tracking-wide text-muted-foreground ${col === 'Aged' ? 'text-right' : 'text-left'}`}>{col}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white dark:divide-gray-700 dark:bg-gray-900">
              {filtered.map((e) => {
                const meta = CLASS_META[e.exception_class];
                return (
                  <tr key={e.serial_id} className="hover:bg-accent">
                    <td className="whitespace-nowrap px-4 py-3">
                      {onSelectHolder
                        ? <button onClick={() => onSelectHolder(e.holder_id)}
                            className="font-medium text-blue-600 hover:underline dark:text-blue-400" title="View holder detail">{e.holder_name}</button>
                        : <span className="font-medium text-foreground">{e.holder_name}</span>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${meta.cls}`} title={meta.title}>{meta.label}</span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-foreground">{e.serial_number}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-muted-foreground">{e.item_code ?? '-'}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm">
                      {e.project_name
                        ? <span className="text-foreground">{e.project_name}</span>
                        : <span className="italic text-muted-foreground">Unassigned</span>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">
                      {e.oes_drop ?? e.wa_drop ?? '-'}
                      {e.exception_class === 'cross_dr_conflict' && e.wa_drop && e.oes_drop && (
                        <span className="ml-1 text-red-600 dark:text-red-400">(WA {e.wa_drop} ≠ OES {e.oes_drop})</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      <span className={`text-sm font-medium ${e.held_days > 30 ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground'}`}>{e.held_days}d</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

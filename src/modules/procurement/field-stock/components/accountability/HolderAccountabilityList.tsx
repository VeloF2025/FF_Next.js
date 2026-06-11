/**
 * HolderAccountabilityList Component
 * Displays holder-centric stock accountability (Sprint D custody model)
 */

'use client';

import { useState } from 'react';
import { Users, Search, Filter, AlertTriangle, Ban, CheckCircle } from 'lucide-react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import type { HolderAccountability } from '../../hooks/useHolderAccountability';

interface Props {
  holders: HolderAccountability[];
  loading?: boolean;
  onBlock?: (holderId: string, reason: string) => Promise<void>;
  onUnblock?: (holderId: string) => Promise<void>;
}

const TYPE_LABEL: Record<HolderAccountability['holder_type'], string> = {
  staff: 'Staff', contractor: 'Contractor', external_person: 'External',
};
const TYPE_CLS: Record<HolderAccountability['holder_type'], string> = {
  staff: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  contractor: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
  external_person: 'bg-gray-100 text-gray-700 dark:bg-gray-700/60 dark:text-gray-300',
};

/**
 * Compact days-held aging cell: three bucket counts (0-7 / 8-30 / 30+) with the
 * 30+ band styled as a warning, plus the oldest-held age in days underneath.
 */
function AgingCell({ h }: { h: HolderAccountability }) {
  const total = h.held_age_0_7 + h.held_age_8_30 + h.held_age_31_plus;
  if (total === 0) return <span className="text-sm text-muted-foreground">-</span>;
  return (
    <div className="flex flex-col items-center gap-0.5">
      <div className="flex items-center gap-1 text-xs font-medium">
        <span className="rounded bg-green-100 px-1.5 py-0.5 text-green-800 dark:bg-green-900/30 dark:text-green-300" title="Held 0–7 days">{h.held_age_0_7}</span>
        <span className={`rounded px-1.5 py-0.5 ${h.held_age_8_30 > 0 ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300' : 'bg-gray-100 text-gray-500 dark:bg-gray-700/50 dark:text-gray-400'}`} title="Held 8–30 days">{h.held_age_8_30}</span>
        <span className={`rounded px-1.5 py-0.5 ${h.held_age_31_plus > 0 ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300' : 'bg-gray-100 text-gray-500 dark:bg-gray-700/50 dark:text-gray-400'}`} title="Held 30+ days">{h.held_age_31_plus}</span>
      </div>
      <span className={`text-[10px] ${h.oldest_held_days > 30 ? 'text-red-600 dark:text-red-400 font-medium' : 'text-muted-foreground'}`}>
        oldest {h.oldest_held_days}d
      </span>
    </div>
  );
}

function StatCard({ icon, value, label }: { icon: React.ReactNode; value: number; label: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 dark:border-gray-700 dark:bg-gray-800">
      <div className="flex items-center gap-3">
        <div className="rounded-lg p-2">{icon}</div>
        <div><p className="text-2xl font-bold text-foreground">{value}</p>
          <p className="text-sm text-muted-foreground">{label}</p></div>
      </div>
    </div>
  );
}

export function HolderAccountabilityList({ holders, loading, onBlock, onUnblock }: Props) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'blocked' | 'unaccounted'>('all');
  const [blockReason, setBlockReason] = useState('');
  const [blockingId, setBlockingId] = useState<string | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);

  const filtered = holders.filter((h) => {
    if (filter === 'blocked' && !h.is_blocked) return false;
    if (filter === 'unaccounted' && h.unaccounted_count <= 0) return false;
    return !search || h.name.toLowerCase().includes(search.toLowerCase());
  });

  async function doBlock(holderId: string) {
    if (!onBlock) return;
    setActionId(holderId);
    try { await onBlock(holderId, blockReason.trim()); }
    finally { setBlockReason(''); setBlockingId(null); setActionId(null); }
  }

  async function doUnblock(holderId: string) {
    if (!onUnblock) return;
    setActionId(holderId);
    try { await onUnblock(holderId); }
    finally { setActionId(null); }
  }

  if (loading) return <LoadingSpinner className="py-12" size="lg" label="" />;

  const blockedCount = holders.filter((h) => h.is_blocked).length;
  const warnCount = holders.filter((h) => h.unaccounted_count > 0).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input type="text" placeholder="Search holders..." value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-border bg-card py-2 pl-10 pr-4 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white" />
        </div>
        <div className="relative">
          <Filter className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}
            className="appearance-none rounded-lg border border-border bg-card py-2 pl-10 pr-8 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white">
            <option value="all">All Holders</option>
            <option value="blocked">Blocked Only</option>
            <option value="unaccounted">With Unaccounted Stock</option>
          </select>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard icon={<Users className="h-5 w-5 text-blue-600 dark:text-blue-400" />} value={holders.length} label="Total Holders" />
        <StatCard icon={<Ban className="h-5 w-5 text-red-600 dark:text-red-400" />} value={blockedCount} label="Blocked" />
        <StatCard icon={<AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />} value={warnCount} label="With Unaccounted" />
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-8 text-center dark:border-gray-700 dark:bg-gray-800">
          <Users className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-2 text-sm font-medium text-foreground">No holders found</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {search || filter !== 'all' ? 'Try adjusting your filters' : 'Holder accountability records will appear here'}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-input">
              <tr>
                {(['Holder', 'Status', 'Held Value', 'Aging', 'Unaccounted', 'Actions'] as const).map((col) => (
                  <th key={col} className={`px-4 py-3 text-xs font-medium tracking-wide text-muted-foreground ${col === 'Holder' ? 'text-left' : col === 'Status' || col === 'Aging' ? 'text-center' : 'text-right'}`}>{col}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white dark:divide-gray-700 dark:bg-gray-900">
              {filtered.map((h) => (
                <tr key={h.holder_id} className="hover:bg-accent">
                  <td className="whitespace-nowrap px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-foreground">{h.name}</span>
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${TYPE_CLS[h.holder_type]}`}>{TYPE_LABEL[h.holder_type]}</span>
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-center">
                    {h.is_blocked
                      ? <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-800 dark:bg-red-900/30 dark:text-red-300"><Ban className="h-3 w-3" /> Blocked</span>
                      : h.unaccounted_count > 0
                        ? <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"><AlertTriangle className="h-3 w-3" /> Warning</span>
                        : <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900/30 dark:text-green-300"><CheckCircle className="h-3 w-3" /> Good</span>}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right text-sm text-muted-foreground">R{(h.held_value ?? 0).toFixed(2)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-center"><AgingCell h={h} /></td>
                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    {h.unaccounted_count > 0
                      ? <span className="text-sm font-medium text-red-600 dark:text-red-400">{h.unaccounted_count}</span>
                      : <span className="text-sm text-muted-foreground">-</span>}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      {h.is_blocked
                        ? onUnblock && <button onClick={() => doUnblock(h.holder_id)} disabled={actionId === h.holder_id}
                            className="rounded p-1 text-green-400 hover:bg-green-100 hover:text-green-600 dark:hover:bg-green-900/30 disabled:opacity-50" title="Unblock holder"><CheckCircle className="h-4 w-4" /></button>
                        : onBlock && (blockingId === h.holder_id
                            ? <div className="flex items-center gap-1">
                                <input type="text" placeholder="Reason (optional)" value={blockReason}
                                  onChange={(e) => setBlockReason(e.target.value)}
                                  className="rounded border border-border bg-card px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-700 dark:text-white" />
                                <button onClick={() => doBlock(h.holder_id)} disabled={actionId === h.holder_id}
                                  className="rounded bg-red-600 px-2 py-1 text-xs text-white hover:bg-red-700 disabled:opacity-50">Confirm</button>
                                <button onClick={() => { setBlockingId(null); setBlockReason(''); }}
                                  className="rounded px-2 py-1 text-xs text-muted-foreground hover:text-foreground">Cancel</button>
                              </div>
                            : <button onClick={() => setBlockingId(h.holder_id)}
                                className="rounded p-1 text-red-400 hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-900/30" title="Block holder"><Ban className="h-4 w-4" /></button>)}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

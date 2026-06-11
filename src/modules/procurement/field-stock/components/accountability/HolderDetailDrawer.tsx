/**
 * HolderDetailDrawer
 * Right-side drawer that surfaces a single holder's accountability detail:
 * per-project breakdown (Unassigned for NULL project), days-held aging buckets
 * (30+ styled as a warning), oldest-held age, and the custody + serial lists.
 *
 * Data comes from useHolderDetail (the detail GET endpoint). Opens when
 * `holderId` is non-null; `fallbackName` shows in the header before the fetch
 * resolves.
 */

'use client';

import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Ban, AlertTriangle, CheckCircle, FolderOpen, Package, Hash } from 'lucide-react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { useHolderDetail, type HolderDetail } from '../../hooks/useHolderDetail';

interface Props {
  holderId: string | null;
  fallbackName?: string;
  onClose: () => void;
}

const rand = (v: number) => `R${(v ?? 0).toFixed(2)}`;

function StatusBadge({ d }: { d: HolderDetail }) {
  if (d.is_blocked) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-800 dark:bg-red-900/30 dark:text-red-300">
        <Ban className="h-3 w-3" /> Blocked
      </span>
    );
  }
  if (d.unaccounted_count > 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
        <AlertTriangle className="h-3 w-3" /> {d.unaccounted_count} unaccounted
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900/30 dark:text-green-300">
      <CheckCircle className="h-3 w-3" /> Good
    </span>
  );
}

function AgingBuckets({ d }: { d: HolderDetail }) {
  const cell = (label: string, value: number, cls: string) => (
    <div className={`flex flex-col items-center rounded-lg border px-3 py-2 ${cls}`}>
      <span className="text-lg font-bold leading-none">{value}</span>
      <span className="mt-1 text-[10px] uppercase tracking-wide opacity-80">{label}</span>
    </div>
  );
  return (
    <div className="grid grid-cols-3 gap-2">
      {cell('0–7 days', d.held_age_0_7, 'border-green-200 bg-green-50 text-green-800 dark:border-green-900/40 dark:bg-green-900/20 dark:text-green-300')}
      {cell('8–30 days', d.held_age_8_30, d.held_age_8_30 > 0 ? 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-300' : 'border-border bg-card text-muted-foreground')}
      {cell('30+ days', d.held_age_31_plus, d.held_age_31_plus > 0 ? 'border-red-200 bg-red-50 text-red-800 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-300' : 'border-border bg-card text-muted-foreground')}
    </div>
  );
}

function Section({ icon, title, count, children }: { icon: React.ReactNode; title: string; count?: number; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
        {icon} {title}
        {count !== undefined && <span className="text-xs font-normal text-muted-foreground">({count})</span>}
      </h3>
      {children}
    </div>
  );
}

function DetailBody({ d }: { d: HolderDetail }) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-border bg-card p-3 dark:border-gray-700 dark:bg-gray-800">
          <p className="text-xs text-muted-foreground">Held Value</p>
          <p className="text-xl font-bold text-foreground">{rand(d.held_value)}</p>
          <p className="text-xs text-muted-foreground">{d.held_count} unit{d.held_count === 1 ? '' : 's'}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-3 dark:border-gray-700 dark:bg-gray-800">
          <p className="text-xs text-muted-foreground">Oldest Held</p>
          <p className={`text-xl font-bold ${d.oldest_held_days > 30 ? 'text-red-600 dark:text-red-400' : 'text-foreground'}`}>
            {d.oldest_held_days}d
          </p>
          <p className="text-xs text-muted-foreground">days in custody</p>
        </div>
      </div>

      <Section icon={<AlertTriangle className="h-4 w-4 text-amber-500" />} title="Days-Held Aging">
        <AgingBuckets d={d} />
      </Section>

      <Section icon={<FolderOpen className="h-4 w-4 text-blue-500" />} title="By Project" count={d.projectBreakdown.length}>
        {d.projectBreakdown.length === 0 ? (
          <p className="text-sm text-muted-foreground">No held serial stock attributed to projects.</p>
        ) : (
          <div className="divide-y divide-border overflow-hidden rounded-lg border border-border dark:divide-gray-700">
            {d.projectBreakdown.map((p) => (
              <div key={p.project_id ?? 'unassigned'} className="flex items-center justify-between px-3 py-2 text-sm">
                <span className={`font-medium ${p.project_id ? 'text-foreground' : 'italic text-muted-foreground'}`}>
                  {p.project_name ?? 'Unassigned'}
                </span>
                <span className="text-muted-foreground">{p.held_count} · {rand(p.held_value)}</span>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section icon={<Package className="h-4 w-4 text-purple-500" />} title="Custody Items" count={d.custody.length}>
        {d.custody.length === 0 ? (
          <p className="text-sm text-muted-foreground">No bulk items in custody.</p>
        ) : (
          <div className="divide-y divide-border overflow-hidden rounded-lg border border-border dark:divide-gray-700">
            {d.custody.map((c) => (
              <div key={`${c.stock_item_id}-${c.lot_number ?? ''}`} className="flex items-center justify-between px-3 py-2 text-sm">
                <span className="text-foreground">
                  {c.item_name ?? c.item_code ?? c.stock_item_id}
                  {c.lot_number && <span className="ml-1 text-xs text-muted-foreground">· {c.lot_number}</span>}
                </span>
                <span className="text-muted-foreground">{c.quantity} · {rand(c.total_value)}</span>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section icon={<Hash className="h-4 w-4 text-teal-500" />} title="Serials" count={d.serials.length}>
        {d.serials.length === 0 ? (
          <p className="text-sm text-muted-foreground">No serials attributed to this holder.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {d.serials.map((s) => (
              <span key={s.id} className="inline-flex items-center gap-1 rounded border border-border bg-card px-2 py-0.5 font-mono text-xs text-foreground dark:border-gray-700 dark:bg-gray-800">
                {s.serial_number}
                {s.status && <span className="text-[10px] text-muted-foreground">{s.status}</span>}
              </span>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

export function HolderDetailDrawer({ holderId, fallbackName, onClose }: Props) {
  const { detail, loading, error } = useHolderDetail(holderId);

  useEffect(() => {
    if (!holderId) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [holderId, onClose]);

  if (!holderId || typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Holder detail">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <div className="relative flex h-full w-full max-w-md flex-col bg-white shadow-xl dark:bg-gray-900">
        <div className="flex items-center justify-between border-b border-border px-5 py-4 dark:border-gray-700">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold text-foreground">{detail?.name ?? fallbackName ?? 'Holder'}</h2>
            {detail && <div className="mt-1"><StatusBadge d={detail} /></div>}
          </div>
          <button onClick={onClose} className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading && <LoadingSpinner className="py-12" size="lg" label="" />}
          {error && !loading && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">{error}</p>
          )}
          {detail && !loading && <DetailBody d={detail} />}
        </div>
      </div>
    </div>,
    document.body
  );
}

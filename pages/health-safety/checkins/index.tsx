/**
 * Daily H&S Check-In board
 * /health-safety/checkins
 *
 * The blocked workers sort to the top, because they are the only rows that
 * need someone to act. The "clocked in, no check-in" count is shown as
 * prominently as the check-in count: a count of declarations on its own cannot
 * distinguish "everyone complied" from "only the diligent ones bothered".
 */

import type { NextPage } from 'next';
import { useState } from 'react';
import Head from 'next/head';
import useSWR from 'swr';
import { AppLayout } from '@/components/layout/AppLayout';
import { ModulePage } from '@/components/module-page';
import { healthSafetyConfig } from '@/modules/navigation';
import { ShieldCheck, UserX } from 'lucide-react';
import { CheckinBoardRow, type CheckinRow } from '@/modules/health-safety/components/checkin/CheckinBoardRow';

const fetcher = (url: string) =>
  fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error(String(r.status));
    return r.json();
  });


function CheckinsContent() {
  const [clearanceFilter, setClearanceFilter] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const params = new URLSearchParams();
  if (clearanceFilter) params.set('clearance', clearanceFilter);

  const { data, mutate, error, isLoading } = useSWR(
    `/api/health-safety/checkins?${params}`,
    fetcher,
    { refreshInterval: 60000 }
  );
  const rows: CheckinRow[] = data?.data?.checkins ?? [];
  const stats = data?.data?.stats ?? {};
  const missing = data?.data?.clocked_in_without_checkin ?? [];

  async function clear(row: CheckinRow) {
    const note = prompt(`Why are you clearing ${row.worker_name}?`);
    if (!note || !note.trim()) return; // a bare override is unauditable
    setBusyId(row.id);
    setActionError(null);
    try {
      const res = await fetch(`/api/health-safety/checkins/${row.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ clearance_note: note.trim() }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        setActionError(json?.error?.message ?? 'Could not clear that check-in.');
        return;
      }
      mutate();
    } catch {
      setActionError('Network error clearing that check-in.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">Daily H&amp;S Check-In</h1>
        <p className="text-sm text-[var(--ff-text-secondary)]">
          {data?.data?.checkin_date ?? 'today'} · {stats.total ?? 0} check-in
          {stats.total === 1 ? '' : 's'} · {stats.blocked ?? 0} blocked · {stats.hazards ?? 0} hazard
          {stats.hazards === 1 ? '' : 's'}
        </p>
      </div>

      {actionError && (
        <div className="p-3 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg text-sm">
          {actionError}
        </div>
      )}

      {/* The compliance gap, given equal weight to the compliance count. */}
      {missing.length > 0 && (
        <div className="flex items-start gap-3 p-4 rounded-lg border border-amber-500/40 bg-amber-50 dark:bg-amber-900/20">
          <UserX className="w-5 h-5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="font-medium text-amber-800 dark:text-amber-300">
              {missing.length} clocked in today without an H&amp;S check-in
            </p>
            <p className="text-sm text-amber-700 dark:text-amber-400 mt-1">
              {missing.map((m: { worker_name: string }) => m.worker_name).join(', ')}
            </p>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {[
          { v: '', label: 'All' },
          { v: 'blocked', label: 'Blocked' },
          { v: 'cleared', label: 'Cleared' },
          { v: 'cleared_by_override', label: 'Overridden' },
        ].map((f) => (
          <button
            key={f.v || 'all'}
            onClick={() => setClearanceFilter(f.v)}
            className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
              clearanceFilter === f.v
                ? 'bg-[var(--ff-primary-500)] text-white border-[var(--ff-primary-500)]'
                : 'bg-[var(--ff-bg-secondary)] text-[var(--ff-text-secondary)] border-[var(--ff-border-light)]'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 bg-[var(--ff-bg-tertiary)] rounded-lg animate-pulse" />
          ))}
        </div>
      ) : error ? (
        <div className="p-8 text-center bg-red-50 dark:bg-red-900/20 rounded-lg text-red-600 dark:text-red-400">
          Failed to load check-ins
        </div>
      ) : rows.length === 0 ? (
        <div className="text-center py-12 bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)]">
          <ShieldCheck className="w-12 h-12 mx-auto mb-4 text-[var(--ff-text-tertiary)]" />
          <p className="text-[var(--ff-text-secondary)]">No check-ins recorded for this day</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--ff-border-light)]">
          <table className="w-full text-sm">
            <thead className="bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)]">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Worker</th>
                <th className="text-left px-4 py-2 font-medium">Scope</th>
                <th className="text-left px-4 py-2 font-medium">Status</th>
                <th className="text-left px-4 py-2 font-medium">Findings</th>
                <th className="text-right px-4 py-2 font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <CheckinBoardRow
                  key={r.id}
                  row={r}
                  busy={busyId === r.id}
                  onClear={() => clear(r)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const CheckinsPage: NextPage = () => (
  <AppLayout>
    <Head>
      <title>Daily H&amp;S Check-In | FibreFlow</title>
    </Head>
    <ModulePage config={healthSafetyConfig}>
      <CheckinsContent />
    </ModulePage>
  </AppLayout>
);

export const getServerSideProps = async () => ({ props: {} });

export default CheckinsPage;

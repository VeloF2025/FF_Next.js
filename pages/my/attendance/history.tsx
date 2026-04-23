/**
 * /my/attendance/history — last 14 entries.
 *
 * Simple timeline. No edits from here — corrections UI lands in PR1c.
 */

import React from 'react';
import { NextPage } from 'next';
import { useRouter } from 'next/router';
import { Clock, Edit3 } from 'lucide-react';

import {
  ApiError,
  ClockEntry,
  getHistory,
  getSession,
} from '@/modules/attendance/portal/client/api';
import { MyPortalShell } from '@/modules/attendance/portal/client/MyPortalShell';

const MyHistoryPage: NextPage & { getLayout?: (page: React.ReactElement) => React.ReactElement } = () => {
  const router = useRouter();

  const [staffName, setStaffName] = React.useState<string | null>(null);
  const [entries, setEntries] = React.useState<ClockEntry[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const sess = await getSession();
        if (cancelled) return;
        if (!sess.session) {
          await router.replace('/my');
          return;
        }
        setStaffName(sess.profile?.name ?? null);
        const hist = await getHistory(14);
        if (cancelled) return;
        setEntries(hist.entries);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          await router.replace('/my');
          return;
        }
        setError(err instanceof Error ? err.message : 'Could not load history.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <MyPortalShell title="History" staffName={staffName}>
      {error && (
        <div role="alert" className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-800 mb-3">
          {error}
        </div>
      )}

      {!entries && !error && (
        <div className="flex items-center justify-center py-16 text-sm text-gray-500">
          Loading…
        </div>
      )}

      {entries && entries.length === 0 && (
        <div className="text-center text-sm text-gray-500 py-10">
          No shifts recorded yet.
        </div>
      )}

      {entries && entries.length > 0 && (
        <ul className="space-y-2">
          {entries.map((e) => (
            <li
              key={e.entryId}
              className="rounded-2xl bg-white border border-gray-200 p-4 flex items-center justify-between"
            >
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-full bg-blue-50 text-blue-700 flex items-center justify-center flex-shrink-0">
                  <Clock className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-sm font-semibold">{formatWorkDate(e.workDate)}</div>
                  <div className="text-xs text-gray-500">
                    {formatTime(e.clockInAt)}{' '}
                    {e.clockOutAt ? `→ ${formatTime(e.clockOutAt)}` : '(open)'}
                  </div>
                  <StatusBadge status={e.status} />
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <div className="text-right">
                  <div className="text-sm font-semibold text-gray-900">
                    {e.durationMs != null ? formatDuration(e.durationMs) : '—'}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    router.push(
                      `/my/attendance/corrections/new?entry_id=${encodeURIComponent(e.entryId)}`
                    )
                  }
                  aria-label="Request correction for this shift"
                  title="Request correction"
                  className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-gray-500 hover:text-blue-700 hover:bg-blue-50 transition"
                >
                  <Edit3 className="w-4 h-4" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </MyPortalShell>
  );
};

function StatusBadge({ status }: { status: ClockEntry['status'] }) {
  const style: Record<ClockEntry['status'], string> = {
    open: 'bg-green-50 text-green-700 border-green-200',
    closed: 'bg-gray-50 text-gray-600 border-gray-200',
    auto_closed: 'bg-yellow-50 text-yellow-800 border-yellow-200',
    disputed: 'bg-red-50 text-red-700 border-red-200',
    manual: 'bg-purple-50 text-purple-700 border-purple-200',
  };
  const label: Record<ClockEntry['status'], string> = {
    open: 'On shift',
    closed: 'Complete',
    auto_closed: 'Auto-closed',
    disputed: 'Disputed',
    manual: 'Manual',
  };
  return (
    <span className={`inline-block mt-1 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide border rounded-full ${style[status]}`}>
      {label[status]}
    </span>
  );
}

function formatWorkDate(yyyyMmDd: string): string {
  try {
    const [y, m, d] = yyyyMmDd.split('-').map(Number);
    if (!y || !m || !d) return yyyyMmDd;
    const date = new Date(Date.UTC(y, m - 1, d));
    return date.toLocaleDateString('en-ZA', {
      weekday: 'short',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    });
  } catch {
    return yyyyMmDd;
  }
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('en-ZA', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Africa/Johannesburg',
    });
  } catch {
    return iso;
  }
}

function formatDuration(ms: number): string {
  const totalMinutes = Math.max(0, Math.floor(ms / 60_000));
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return h > 0 ? `${h}h ${m.toString().padStart(2, '0')}m` : `${m}m`;
}

MyHistoryPage.getLayout = (page: React.ReactElement) => page;

export default MyHistoryPage;

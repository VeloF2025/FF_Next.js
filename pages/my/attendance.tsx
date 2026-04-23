/**
 * /my/attendance — portal home.
 *
 * Shows whichever CTA is appropriate given server state:
 *   - If there is an open entry (status='open' in the most recent history row)
 *     → "Clock out" with elapsed time.
 *   - Otherwise → "Clock in".
 *
 * We don't compute "today's hours" from open-entry arithmetic on the client —
 * that's done server-side and will surface via the daily summary API in PR1b.
 * For now the weekly total is a todo placeholder.
 *
 * Session check happens on mount: if /api/my/session returns `session: null`,
 * we redirect back to /my. Any other error surfaces as an inline banner.
 */

import React from 'react';
import { NextPage } from 'next';
import { useRouter } from 'next/router';
import { Clock, Edit3, History as HistoryIcon, MapPin } from 'lucide-react';

import {
  ApiError,
  ClockEntry,
  getHistory,
  getSession,
  SessionResponse,
} from '@/modules/attendance/portal/client/api';
import { MyPortalShell } from '@/modules/attendance/portal/client/MyPortalShell';

const MyAttendancePage: NextPage & { getLayout?: (page: React.ReactElement) => React.ReactElement } = () => {
  const router = useRouter();

  const [session, setSession] = React.useState<SessionResponse | null>(null);
  const [entries, setEntries] = React.useState<ClockEntry[] | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);

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
        setSession(sess);
        // Fetch just the last handful — enough to see "today's entry" status.
        const hist = await getHistory(5);
        if (cancelled) return;
        setEntries(hist.entries);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) {
          await router.replace('/my');
          return;
        }
        setLoadError(err instanceof Error ? err.message : 'Could not load your attendance.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  const openEntry = entries?.find((e) => e.status === 'open') ?? null;

  return (
    <MyPortalShell
      title="Attendance"
      staffName={session?.profile?.name ?? null}
    >
      {loadError && (
        <div role="alert" className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-800 mb-4">
          {loadError}
        </div>
      )}

      {!session && !loadError && (
        <div className="flex items-center justify-center py-16 text-sm text-gray-500">
          Loading…
        </div>
      )}

      {session?.profile && (
        <>
          <div className="mb-5">
            <h1 className="text-2xl font-semibold">
              Hi, {firstName(session.profile.name)} 👋
            </h1>
            <p className="mt-1 text-sm text-gray-500">
              {openEntry
                ? 'You are clocked in. Tap below when you are ready to finish your shift.'
                : 'Ready to start your shift?'}
            </p>
          </div>

          <div className="rounded-2xl bg-white border border-gray-200 shadow-sm p-5 mb-4">
            {openEntry ? (
              <OpenEntryCard
                entry={openEntry}
                onClockOut={() => router.push('/my/attendance/clock?action=out')}
              />
            ) : (
              <ClosedEntryCard
                onClockIn={() => router.push('/my/attendance/clock?action=in')}
              />
            )}
          </div>

          <RecentList entries={entries ?? []} />

          <div className="mt-4">
            <button
              type="button"
              onClick={() => router.push('/my/attendance/corrections')}
              className="w-full flex items-center justify-between rounded-2xl bg-white border border-gray-200 shadow-sm p-4 text-left hover:border-gray-300 transition"
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center">
                  <Edit3 className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-sm font-medium text-gray-900">
                    My corrections
                  </div>
                  <div className="text-xs text-gray-500">
                    Track pending submissions or cancel one
                  </div>
                </div>
              </div>
              <span className="text-xs text-blue-600 font-medium">Open →</span>
            </button>
          </div>
        </>
      )}
    </MyPortalShell>
  );
};

function firstName(fullName: string): string {
  const trimmed = fullName.trim();
  if (!trimmed) return 'there';
  return trimmed.split(/\s+/)[0] ?? 'there';
}

function OpenEntryCard({
  entry,
  onClockOut,
}: {
  entry: ClockEntry;
  onClockOut: () => void;
}) {
  const [elapsed, setElapsed] = React.useState(() => Date.now() - new Date(entry.clockInAt).getTime());

  React.useEffect(() => {
    const id = window.setInterval(() => {
      setElapsed(Date.now() - new Date(entry.clockInAt).getTime());
    }, 30_000);
    return () => window.clearInterval(id);
  }, [entry.clockInAt]);

  return (
    <>
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-full bg-green-100 text-green-700 flex items-center justify-center">
          <Clock className="w-5 h-5" />
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-green-700 font-semibold">On shift</div>
          <div className="text-sm text-gray-600">
            Since {formatTime(entry.clockInAt)} · {formatDuration(elapsed)}
          </div>
        </div>
      </div>
      <button
        type="button"
        onClick={onClockOut}
        className="w-full py-4 rounded-xl bg-orange-600 hover:bg-orange-700 text-white text-lg font-bold shadow-sm"
      >
        Clock out
      </button>
    </>
  );
}

function ClosedEntryCard({ onClockIn }: { onClockIn: () => void }) {
  return (
    <>
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center">
          <Clock className="w-5 h-5" />
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-blue-700 font-semibold">Off shift</div>
          <div className="text-sm text-gray-600">No active entry</div>
        </div>
      </div>
      <button
        type="button"
        onClick={onClockIn}
        className="w-full py-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-lg font-bold shadow-sm"
      >
        Clock in
      </button>
    </>
  );
}

function RecentList({ entries }: { entries: ClockEntry[] }) {
  if (entries.length === 0) {
    return (
      <div className="text-center text-sm text-gray-500 py-6">
        No recent shifts.
      </div>
    );
  }
  return (
    <div>
      <h2 className="text-sm font-semibold text-gray-700 px-1 mb-2 flex items-center gap-2">
        <HistoryIcon className="w-4 h-4" />
        Recent shifts
      </h2>
      <ul className="rounded-2xl bg-white border border-gray-200 divide-y divide-gray-100 overflow-hidden">
        {entries.slice(0, 3).map((e) => (
          <li key={e.entryId} className="p-3 flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">{formatWorkDate(e.workDate)}</div>
              <div className="text-xs text-gray-500 flex items-center gap-1">
                <MapPin className="w-3 h-3" />
                {formatTime(e.clockInAt)}{' '}
                {e.clockOutAt ? `→ ${formatTime(e.clockOutAt)}` : '(open)'}
              </div>
            </div>
            <div className="text-sm text-gray-700 font-medium">
              {e.durationMs != null ? formatDuration(e.durationMs) : '—'}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
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

function formatWorkDate(yyyyMmDd: string): string {
  try {
    // yyyy-MM-dd → "Mon 20 Apr"
    const [y, m, d] = yyyyMmDd.split('-').map(Number);
    if (!y || !m || !d) return yyyyMmDd;
    const date = new Date(Date.UTC(y, m - 1, d));
    return date.toLocaleDateString('en-ZA', {
      weekday: 'short',
      day: '2-digit',
      month: 'short',
      timeZone: 'UTC',
    });
  } catch {
    return yyyyMmDd;
  }
}

function formatDuration(ms: number): string {
  const totalMinutes = Math.max(0, Math.floor(ms / 60_000));
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return h > 0 ? `${h}h ${m.toString().padStart(2, '0')}m` : `${m}m`;
}

MyAttendancePage.getLayout = (page: React.ReactElement) => page;

export default MyAttendancePage;

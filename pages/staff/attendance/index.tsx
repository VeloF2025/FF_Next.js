/**
 * /staff/attendance — supervisor roster.
 *
 * One row per active staff member with today's attendance state:
 *   on-shift / clocked-out / absent / exception.
 *
 * Backed by `GET /api/staff/attendance-roster?date=YYYY-MM-DD` which is
 * RBAC-gated on `people.staff.attendance.manage` — this page is the UI
 * surface for that endpoint. Individual staff drill-down still goes
 * through /staff/[id]?tab=attendance.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Clock, Users } from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { AttendanceNav } from '@/components/attendance/AttendanceNav';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { log } from '@/lib/logger';

interface RosterEntry {
  staffId: string;
  name: string;
  phone: string | null;
  homeSiteName: string | null;
  entryId: string | null;
  clockInAt: string | null;
  clockOutAt: string | null;
  siteName: string | null;
  status: string | null;
  openExceptionCount: number;
  category: 'on_shift' | 'clocked_out' | 'absent' | 'exception';
}

interface RosterSummary {
  total: number;
  onShift: number;
  clockedOut: number;
  absent: number;
  exceptions: number;
}

function todayInSast(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Johannesburg',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

type FilterCategory = 'all' | RosterEntry['category'];

export default function StaffAttendanceRosterPage() {
  const [workDate, setWorkDate] = useState<string>(todayInSast());
  const [roster, setRoster] = useState<RosterEntry[] | null>(null);
  const [summary, setSummary] = useState<RosterSummary | null>(null);
  const [filter, setFilter] = useState<FilterCategory>('all');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const res = await fetch(`/api/staff/attendance-roster?date=${workDate}`, {
          credentials: 'include',
        });
        const body = (await res.json()) as {
          success: boolean;
          data?: { roster: RosterEntry[]; summary: RosterSummary; workDate: string };
          error?: { message: string };
        };
        if (cancelled) return;
        if (!res.ok || !body.success || !body.data) {
          setError(body.error?.message ?? 'Could not load the roster.');
          return;
        }
        setRoster(body.data.roster);
        setSummary(body.data.summary);
      } catch (err) {
        if (cancelled) return;
        log.error('StaffAttendanceRoster fetch failed', err instanceof Error ? { message: err.message } : { err });
        setError('Network error loading the roster.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [workDate]);

  const filtered = useMemo(() => {
    if (!roster) return [];
    return filter === 'all' ? roster : roster.filter((r) => r.category === filter);
  }, [roster, filter]);

  return (
    <AppLayout>
      <AttendanceNav />
      <div className="px-6 py-6 max-w-6xl mx-auto">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <div>
            <h1 className="text-2xl font-semibold">Attendance roster</h1>
            <p className="text-sm text-neutral-400">Who is on shift, who is out, who needs review.</p>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <span className="text-neutral-400">Date</span>
            <input
              type="date"
              value={workDate}
              onChange={(e) => setWorkDate(e.target.value)}
              className="bg-neutral-900 border border-neutral-700 rounded px-3 py-2 text-sm focus:border-emerald-600 focus:outline-none"
            />
          </label>
        </div>

        {summary && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            <SummaryCard label="On shift" count={summary.onShift} filter="on_shift" current={filter} onClick={setFilter} />
            <SummaryCard label="Clocked out" count={summary.clockedOut} filter="clocked_out" current={filter} onClick={setFilter} />
            <SummaryCard label="Absent" count={summary.absent} filter="absent" current={filter} onClick={setFilter} />
            <SummaryCard label="Exceptions" count={summary.exceptions} filter="exception" current={filter} onClick={setFilter} highlight />
          </div>
        )}

        {filter !== 'all' && (
          <button
            type="button"
            onClick={() => setFilter('all')}
            className="mb-3 text-xs font-medium text-emerald-400 hover:text-emerald-300"
          >
            Clear filter · show all
          </button>
        )}

        {error && (
          <div role="alert" className="rounded border border-red-800 bg-red-950/30 px-4 py-3 text-sm text-red-200 mb-4 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <div>{error}</div>
          </div>
        )}

        {loading && !roster && <LoadingSpinner />}

        {roster && !loading && (
          <div className="overflow-x-auto border border-neutral-800 rounded">
            <table className="min-w-full text-sm">
              <thead className="bg-neutral-900 text-neutral-300">
                <tr>
                  <Th>Staff</Th>
                  <Th>Status</Th>
                  <Th>Clock in</Th>
                  <Th>Clock out</Th>
                  <Th>Site</Th>
                  <Th>Exceptions</Th>
                  <Th></Th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <RosterRow key={r.staffId} entry={r} />
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-3 py-10 text-center text-sm text-neutral-500">
                      No staff match this filter.
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
}

function SummaryCard({
  label,
  count,
  filter,
  current,
  onClick,
  highlight,
}: {
  label: string;
  count: number;
  filter: FilterCategory;
  current: FilterCategory;
  onClick: (f: FilterCategory) => void;
  highlight?: boolean;
}) {
  const active = current === filter;
  const base = 'rounded-xl border px-4 py-3 text-left transition-colors';
  const colour = highlight
    ? active
      ? 'bg-amber-900/40 border-amber-600 text-amber-200'
      : 'bg-amber-950/20 border-amber-800/40 text-amber-300 hover:bg-amber-900/30'
    : active
    ? 'bg-emerald-900/30 border-emerald-700 text-emerald-200'
    : 'bg-neutral-900 border-neutral-800 hover:bg-neutral-800/60';
  return (
    <button type="button" onClick={() => onClick(filter)} className={`${base} ${colour}`}>
      <div className="text-xs uppercase tracking-wide opacity-80">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{count}</div>
    </button>
  );
}

function RosterRow({ entry }: { entry: RosterEntry }) {
  return (
    <tr className="border-t border-neutral-800 hover:bg-neutral-900/50">
      <Td>
        <Link href={`/staff/${entry.staffId}?tab=attendance`} className="text-emerald-400 hover:text-emerald-300 font-medium">
          {entry.name}
        </Link>
        {entry.phone && (
          <div className="text-xs text-neutral-500">{entry.phone}</div>
        )}
      </Td>
      <Td><CategoryBadge category={entry.category} /></Td>
      <Td>{entry.clockInAt ? formatTime(entry.clockInAt) : '—'}</Td>
      <Td>{entry.clockOutAt ? formatTime(entry.clockOutAt) : (entry.category === 'on_shift' ? <span className="text-emerald-300 text-xs">(live)</span> : '—')}</Td>
      <Td>{entry.siteName ?? entry.homeSiteName ?? '—'}</Td>
      <Td>
        {entry.openExceptionCount > 0 ? (
          <span className="inline-flex items-center gap-1 text-amber-300">
            <AlertTriangle className="w-3 h-3" />
            {entry.openExceptionCount}
          </span>
        ) : '—'}
      </Td>
      <Td>
        <Link href={`/staff/${entry.staffId}?tab=attendance`} className="text-xs font-medium text-emerald-400 hover:text-emerald-300">
          View
        </Link>
      </Td>
    </tr>
  );
}

function CategoryBadge({ category }: { category: RosterEntry['category'] }) {
  const map: Record<RosterEntry['category'], { label: string; cls: string; icon: React.ReactNode }> = {
    on_shift: { label: 'On shift', cls: 'bg-emerald-950/40 text-emerald-300 border-emerald-800/60', icon: <Clock className="w-3 h-3" /> },
    clocked_out: { label: 'Clocked out', cls: 'bg-neutral-900 text-neutral-400 border-neutral-700', icon: <Clock className="w-3 h-3" /> },
    absent: { label: 'Absent', cls: 'bg-red-950/40 text-red-300 border-red-800/60', icon: <Users className="w-3 h-3" /> },
    exception: { label: 'Exception', cls: 'bg-amber-950/40 text-amber-300 border-amber-800/60', icon: <AlertTriangle className="w-3 h-3" /> },
  };
  const { label, cls, icon } = map[category];
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide border rounded-full ${cls}`}>
      {icon}
      {label}
    </span>
  );
}

function Th({ children }: { children?: React.ReactNode }) {
  return <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-neutral-400">{children}</th>;
}
function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-3 py-2 align-top">{children}</td>;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-ZA', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Africa/Johannesburg',
  });
}

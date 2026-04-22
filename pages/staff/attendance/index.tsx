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
            <h1 className="text-2xl font-semibold text-gray-900">Attendance roster</h1>
            <p className="text-sm text-gray-500">Who is on shift, who is out, who needs review.</p>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <span className="text-gray-600">Date</span>
            <input
              type="date"
              value={workDate}
              onChange={(e) => setWorkDate(e.target.value)}
              className="px-3 py-2 rounded-lg border border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none"
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
            className="mb-3 text-xs font-medium text-blue-600 hover:text-blue-700"
          >
            Clear filter · show all
          </button>
        )}

        {error && (
          <div role="alert" className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-800 mb-4">
            {error}
          </div>
        )}

        {loading && !roster && <LoadingSpinner />}

        {roster && !loading && (
          <div className="overflow-x-auto bg-white border border-gray-200 rounded-xl">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50">
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
              <tbody className="bg-white divide-y divide-gray-100">
                {filtered.map((r) => (
                  <RosterRow key={r.staffId} entry={r} />
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-3 py-10 text-center text-sm text-gray-500">
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
    ? active ? 'bg-yellow-100 border-yellow-400' : 'bg-yellow-50 border-yellow-200 hover:bg-yellow-100'
    : active ? 'bg-blue-50 border-blue-400' : 'bg-white border-gray-200 hover:bg-gray-50';
  return (
    <button type="button" onClick={() => onClick(filter)} className={`${base} ${colour}`}>
      <div className="text-xs uppercase tracking-wide text-gray-500">{label}</div>
      <div className="text-2xl font-semibold text-gray-900">{count}</div>
    </button>
  );
}

function RosterRow({ entry }: { entry: RosterEntry }) {
  return (
    <tr className="hover:bg-gray-50">
      <Td>
        <Link href={`/staff/${entry.staffId}?tab=attendance`} className="text-blue-600 hover:text-blue-700 font-medium">
          {entry.name}
        </Link>
        {entry.phone && (
          <div className="text-xs text-gray-500">{entry.phone}</div>
        )}
      </Td>
      <Td><CategoryBadge category={entry.category} /></Td>
      <Td>{entry.clockInAt ? formatTime(entry.clockInAt) : '—'}</Td>
      <Td>{entry.clockOutAt ? formatTime(entry.clockOutAt) : (entry.category === 'on_shift' ? <span className="text-green-700 text-xs">(live)</span> : '—')}</Td>
      <Td>{entry.siteName ?? entry.homeSiteName ?? '—'}</Td>
      <Td>
        {entry.openExceptionCount > 0 ? (
          <span className="inline-flex items-center gap-1 text-yellow-800">
            <AlertTriangle className="w-3 h-3" />
            {entry.openExceptionCount}
          </span>
        ) : '—'}
      </Td>
      <Td>
        <Link href={`/staff/${entry.staffId}?tab=attendance`} className="text-xs font-medium text-blue-600 hover:text-blue-700">
          View
        </Link>
      </Td>
    </tr>
  );
}

function CategoryBadge({ category }: { category: RosterEntry['category'] }) {
  const map: Record<RosterEntry['category'], { label: string; cls: string; icon: React.ReactNode }> = {
    on_shift: { label: 'On shift', cls: 'bg-green-50 text-green-700 border-green-200', icon: <Clock className="w-3 h-3" /> },
    clocked_out: { label: 'Clocked out', cls: 'bg-gray-50 text-gray-600 border-gray-200', icon: <Clock className="w-3 h-3" /> },
    absent: { label: 'Absent', cls: 'bg-red-50 text-red-700 border-red-200', icon: <Users className="w-3 h-3" /> },
    exception: { label: 'Exception', cls: 'bg-yellow-50 text-yellow-800 border-yellow-200', icon: <AlertTriangle className="w-3 h-3" /> },
  };
  const { label, cls, icon } = map[category];
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide border rounded-full ${cls}`}>
      {icon}
      {label}
    </span>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-600">{children}</th>;
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

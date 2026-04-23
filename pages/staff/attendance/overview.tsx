/**
 * /staff/attendance/overview — exec dashboard.
 *
 * Single page pulling everything together: weekly hour totals, mismatch
 * trend, pending corrections queue size, top overtime this week, and
 * Cartrack coverage for the window. All from one /api/staff/attendance-
 * overview round-trip so the page renders in one hop.
 *
 * Scope-aware: super_admin / admin see the whole org; others see only
 * their supervised staff. The API handles the scope narrowing (#1405
 * helper) so the UI is policy-free.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  Clock,
  RefreshCcw,
  TrendingUp,
  Users,
} from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { AttendanceNav } from '@/components/attendance/AttendanceNav';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { log } from '@/lib/logger';

interface WeekTotals {
  weekStart: string;
  regularHrs: number;
  overtimeHrs: number;
  sundayHrs: number;
  holidayHrs: number;
  nightHrs: number;
  wageAmount: number | null;
  exceptionsCount: number;
  mismatchCount: number;
}

interface TopOt {
  staffId: string;
  fullName: string;
  overtimeHrs: number;
}

interface CartrackCoverage {
  match: number;
  mismatch: number;
  no_data: number;
  vehicle_not_mapped: number;
  device_gps_off: number;
  total: number;
  matchPct: number | null;
}

interface OverviewData {
  weeks: WeekTotals[];
  pendingCorrections: number;
  openExceptions: number;
  topOvertimeStaff: TopOt[];
  cartrackCoverage: CartrackCoverage;
  generatedAt: string;
}

function fmtHrs(n: number): string {
  return n > 0 ? n.toFixed(2) : '—';
}

function fmtR(rands: number | null): string {
  if (rands == null) return '—';
  return `R ${rands.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtWeek(yyyyMmDd: string): string {
  try {
    const [y, m, d] = yyyyMmDd.split('-').map(Number);
    if (!y || !m || !d) return yyyyMmDd;
    const date = new Date(Date.UTC(y, m - 1, d));
    return date.toLocaleDateString('en-ZA', {
      day: '2-digit',
      month: 'short',
      timeZone: 'UTC',
    });
  } catch {
    return yyyyMmDd;
  }
}

export default function StaffAttendanceOverviewPage() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [weeks, setWeeks] = useState(4);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/staff/attendance-overview?weeks=${weeks}`, {
        credentials: 'same-origin',
      });
      if (!res.ok) {
        let body: unknown = {};
        try {
          body = await res.json();
        } catch {
          /* non-JSON — keep body empty */
        }
        const msg =
          (body as { error?: { message?: string } })?.error?.message ??
          `HTTP ${res.status}`;
        throw new Error(msg);
      }
      const body = (await res.json()) as { success: true; data: OverviewData };
      setData(body.data);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      log.error('[attendance-overview] load failed', { error: message });
    } finally {
      setLoading(false);
    }
  }, [weeks]);

  useEffect(() => {
    load();
  }, [load]);

  const cov = data?.cartrackCoverage;

  return (
    <AppLayout>
      <AttendanceNav />
      <div className="p-6 space-y-6">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Attendance Overview</h1>
            <p className="text-sm text-neutral-400">
              Aggregated hours, corrections queue, mismatch trend, and
              Cartrack coverage for your supervised staff.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={weeks}
              onChange={(e) => setWeeks(Number(e.target.value))}
              className="bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-sm"
              aria-label="Weeks of history"
            >
              {[4, 8, 12].map((w) => (
                <option key={w} value={w}>
                  {w} weeks
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={load}
              disabled={loading}
              className="inline-flex items-center gap-1 bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-sm hover:border-neutral-600 disabled:opacity-50"
            >
              <RefreshCcw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </header>

        {error && (
          <div className="rounded border border-red-800 bg-red-950/30 p-3 text-sm text-red-200 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <div>{error}</div>
          </div>
        )}

        {loading && !data && (
          <div className="flex items-center gap-2 text-neutral-400 text-sm">
            <LoadingSpinner /> Loading…
          </div>
        )}

        {data && (
          <>
            {/* Top-line KPI tiles */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <KpiTile
                icon={<Clock className="w-4 h-4" />}
                label="Pending corrections"
                value={data.pendingCorrections.toString()}
                href="/staff/attendance/corrections?status=pending"
                accent="amber"
              />
              <KpiTile
                icon={<AlertTriangle className="w-4 h-4" />}
                label="Open exceptions"
                value={data.openExceptions.toString()}
                accent="red"
              />
              <KpiTile
                icon={<TrendingUp className="w-4 h-4" />}
                label="Cartrack match"
                value={cov?.matchPct != null ? `${cov.matchPct}%` : '—'}
                sublabel={cov ? `${cov.match} / ${cov.total} verified` : undefined}
                accent="emerald"
              />
              <KpiTile
                icon={<Users className="w-4 h-4" />}
                label="Top OT staff this week"
                value={data.topOvertimeStaff.length.toString()}
                sublabel="See breakdown below"
                accent="sky"
              />
            </div>

            {/* Weekly totals table */}
            <section>
              <h2 className="text-sm font-semibold text-neutral-300 mb-2">
                Weekly totals
              </h2>
              <div className="overflow-x-auto border border-neutral-800 rounded">
                <table className="min-w-full text-sm">
                  <thead className="bg-neutral-900 text-neutral-300">
                    <tr>
                      <th className="text-left px-3 py-2">Week</th>
                      <th className="text-right px-3 py-2">Regular</th>
                      <th className="text-right px-3 py-2">OT</th>
                      <th className="text-right px-3 py-2">Sunday</th>
                      <th className="text-right px-3 py-2">Holiday</th>
                      <th className="text-right px-3 py-2">Night</th>
                      <th className="text-right px-3 py-2">Wage</th>
                      <th className="text-right px-3 py-2">Exceptions</th>
                      <th className="text-right px-3 py-2">GPS mismatch</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.weeks.length === 0 && (
                      <tr>
                        <td colSpan={9} className="text-center py-6 text-neutral-500">
                          No summaries yet for this window.
                        </td>
                      </tr>
                    )}
                    {data.weeks.map((w) => (
                      <tr
                        key={w.weekStart}
                        className="border-t border-neutral-800 hover:bg-neutral-900/50"
                      >
                        <td className="px-3 py-2 font-medium">{fmtWeek(w.weekStart)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmtHrs(w.regularHrs)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-amber-300">
                          {fmtHrs(w.overtimeHrs)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmtHrs(w.sundayHrs)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmtHrs(w.holidayHrs)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmtHrs(w.nightHrs)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmtR(w.wageAmount)}</td>
                        <td
                          className={`px-3 py-2 text-right tabular-nums ${
                            w.exceptionsCount > 0 ? 'text-red-300' : 'text-neutral-500'
                          }`}
                        >
                          {w.exceptionsCount || '—'}
                        </td>
                        <td
                          className={`px-3 py-2 text-right tabular-nums ${
                            w.mismatchCount > 0 ? 'text-amber-300' : 'text-neutral-500'
                          }`}
                        >
                          {w.mismatchCount || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {/* Top overtime + Cartrack coverage */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <section>
                <h2 className="text-sm font-semibold text-neutral-300 mb-2">
                  Top overtime — this week
                </h2>
                <div className="border border-neutral-800 rounded">
                  {data.topOvertimeStaff.length === 0 ? (
                    <div className="text-center py-6 text-sm text-neutral-500">
                      No OT logged this week yet.
                    </div>
                  ) : (
                    <ul className="divide-y divide-neutral-800">
                      {data.topOvertimeStaff.map((s, idx) => (
                        <li
                          key={s.staffId}
                          className="flex items-center justify-between px-3 py-2"
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-mono text-neutral-500 w-5">
                              #{idx + 1}
                            </span>
                            <span className="text-sm">{s.fullName}</span>
                          </div>
                          <span className="text-sm font-semibold tabular-nums text-amber-300">
                            {s.overtimeHrs.toFixed(2)} h
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </section>

              <section>
                <h2 className="text-sm font-semibold text-neutral-300 mb-2">
                  Cartrack coverage — last {weeks} weeks
                </h2>
                {cov && (
                  <div className="border border-neutral-800 rounded p-3 text-sm space-y-1">
                    <CoverageRow label="Match" value={cov.match} tone="emerald" />
                    <CoverageRow label="Mismatch" value={cov.mismatch} tone="amber" />
                    <CoverageRow label="No data" value={cov.no_data} tone="neutral" />
                    <CoverageRow
                      label="Device GPS off"
                      value={cov.device_gps_off}
                      tone="sky"
                    />
                    <CoverageRow
                      label="Vehicle not mapped"
                      value={cov.vehicle_not_mapped}
                      tone="neutral"
                    />
                    <div className="pt-2 mt-2 border-t border-neutral-800 flex justify-between">
                      <span className="text-neutral-400">Total verified</span>
                      <span className="tabular-nums font-medium">{cov.total}</span>
                    </div>
                  </div>
                )}
              </section>
            </div>

            <p className="text-xs text-neutral-500">
              Generated {new Date(data.generatedAt).toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg' })}
            </p>
          </>
        )}
      </div>
    </AppLayout>
  );
}

function KpiTile({
  icon,
  label,
  value,
  sublabel,
  href,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sublabel?: string;
  href?: string;
  accent: 'amber' | 'red' | 'emerald' | 'sky';
}) {
  const tone = {
    amber: 'bg-amber-950/20 border-amber-800/40 text-amber-300',
    red: 'bg-red-950/20 border-red-800/40 text-red-300',
    emerald: 'bg-emerald-950/20 border-emerald-800/40 text-emerald-300',
    sky: 'bg-sky-950/20 border-sky-800/40 text-sky-300',
  }[accent];
  const inner = (
    <div className={`rounded-xl border p-3 ${tone}`}>
      <div className="flex items-center gap-2 text-xs uppercase tracking-wide opacity-80">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold text-white tabular-nums">
        {value}
      </div>
      {sublabel && <div className="mt-0.5 text-xs text-neutral-400">{sublabel}</div>}
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

function CoverageRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'emerald' | 'amber' | 'neutral' | 'sky';
}) {
  const textTone = {
    emerald: 'text-emerald-300',
    amber: 'text-amber-300',
    neutral: 'text-neutral-400',
    sky: 'text-sky-300',
  }[tone];
  return (
    <div className="flex justify-between">
      <span className="text-neutral-400">{label}</span>
      <span className={`tabular-nums ${textTone}`}>{value}</span>
    </div>
  );
}

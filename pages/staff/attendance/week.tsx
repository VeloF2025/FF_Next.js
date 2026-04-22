/**
 * /staff/attendance/week — weekly attendance totals + payroll export.
 *
 * Per-staff weekly hour buckets (regular/OT/Sun/holiday/night) with a CSV
 * or XLSX download. Week picker enforces Monday-start; friendly auto-snap
 * redirects other days to the Monday of that ISO week.
 *
 * Backed by `GET /api/staff/attendance-week` (daily_summaries aggregation).
 * Download button hits `/api/staff/attendance-export`.
 *
 * Rendering is split into `src/components/attendance/WeekSummaryTable.tsx`
 * so this page stays under the 200-line component cap.
 */

import { useEffect, useMemo, useState } from 'react';
import { Download, Calendar, AlertTriangle } from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { AttendanceNav } from '@/components/attendance/AttendanceNav';
import {
  Metric,
  WeekSummaryTable,
  type StaffWeekRow,
} from '@/components/attendance/WeekSummaryTable';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { log } from '@/lib/logger';

interface WeekPayload {
  weekStart: string;
  weekEnd: string;
  staff: StaffWeekRow[];
  totals: {
    regularHrs: number;
    overtimeHrs: number;
    sundayHrs: number;
    holidayHrs: number;
    nightHrs: number;
    exceptionsCount: number;
    staffCount: number;
  };
}

function todayInSast(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Johannesburg',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function thisWeekMonday(): string {
  const today = todayInSast();
  const d = new Date(`${today}T00:00:00Z`);
  const dow = d.getUTCDay();
  const deltaToMon = dow === 0 ? -6 : 1 - dow;
  d.setUTCDate(d.getUTCDate() + deltaToMon);
  return d.toISOString().slice(0, 10);
}

function parseApiError(body: unknown, status: number): string {
  // apiResponse serialises errors as { error: { code, message, details } }.
  // A naïve `body.error` stringifies to '[object Object]' on the banner;
  // dig into `.message`, fall back to the status code.
  const e = (body as { error?: { message?: string } | string } | null)?.error;
  if (typeof e === 'string') return e;
  return e?.message ?? `HTTP ${status}`;
}

export default function StaffAttendanceWeekPage() {
  const [weekStart, setWeekStart] = useState<string>(thisWeekMonday());
  const [payload, setPayload] = useState<WeekPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [exportBusy, setExportBusy] = useState<'csv' | 'xlsx' | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/staff/attendance-week?week_start=${encodeURIComponent(weekStart)}`,
          { credentials: 'same-origin' }
        );
        if (!res.ok) {
          let body: unknown = {};
          try {
            body = await res.json();
          } catch (parseErr) {
            log.warn('[staff-attendance-week] non-JSON error body', {
              status: res.status,
              err: parseErr instanceof Error ? parseErr.message : String(parseErr),
            });
          }
          throw new Error(parseApiError(body, res.status));
        }
        const body = (await res.json()) as { success: true; data: WeekPayload };
        if (!cancelled) setPayload(body.data);
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : String(err);
          setError(message);
          log.error('[staff-attendance-week] load failed', { weekStart, error: message });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [weekStart]);

  const days: string[] = useMemo(() => {
    const out: string[] = [];
    const d = new Date(`${weekStart}T00:00:00Z`);
    for (let i = 0; i < 7; i++) {
      out.push(d.toISOString().slice(0, 10));
      d.setUTCDate(d.getUTCDate() + 1);
    }
    return out;
  }, [weekStart]);

  async function handleDownload(format: 'csv' | 'xlsx') {
    setExportBusy(format);
    try {
      const res = await fetch(
        `/api/staff/attendance-export?week_start=${encodeURIComponent(
          weekStart
        )}&format=${format}`,
        { credentials: 'same-origin' }
      );
      if (!res.ok) {
        let body: unknown = {};
        try {
          body = await res.json();
        } catch (parseErr) {
          log.warn('[staff-attendance-week] non-JSON export error body', {
            status: res.status,
            err: parseErr instanceof Error ? parseErr.message : String(parseErr),
          });
        }
        throw new Error(parseApiError(body, res.status));
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `attendance-week-${weekStart}.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(`Export failed: ${message}`);
      log.error('[staff-attendance-week] export failed', { format, weekStart, error: message });
    } finally {
      setExportBusy(null);
    }
  }

  function handleWeekChange(ymd: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return;
    const dow = new Date(`${ymd}T00:00:00Z`).getUTCDay();
    if (dow !== 1) {
      // Snap to Monday silently — friendlier than a validation error when
      // the picker yields Wednesday.
      const d = new Date(`${ymd}T00:00:00Z`);
      const delta = dow === 0 ? -6 : 1 - dow;
      d.setUTCDate(d.getUTCDate() + delta);
      setWeekStart(d.toISOString().slice(0, 10));
      return;
    }
    setWeekStart(ymd);
  }

  return (
    <AppLayout>
      <AttendanceNav />
      <div className="p-6 space-y-4">
        <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Weekly Attendance</h1>
            <p className="text-sm text-neutral-400">
              Payroll week {weekStart} — {days[6]}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 text-sm text-neutral-300">
              <Calendar className="w-4 h-4" />
              <input
                type="date"
                value={weekStart}
                onChange={(e) => handleWeekChange(e.target.value)}
                className="bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-sm"
                aria-label="Week-start (auto-snaps to Monday)"
              />
            </label>
            <button
              type="button"
              onClick={() => handleDownload('csv')}
              disabled={exportBusy !== null}
              className="flex items-center gap-2 px-3 py-1 rounded border border-neutral-700 bg-neutral-900 hover:bg-neutral-800 disabled:opacity-50 text-sm"
            >
              <Download className="w-4 h-4" />
              {exportBusy === 'csv' ? 'Generating…' : 'CSV'}
            </button>
            <button
              type="button"
              onClick={() => handleDownload('xlsx')}
              disabled={exportBusy !== null}
              className="flex items-center gap-2 px-3 py-1 rounded border border-emerald-700 bg-emerald-900/40 hover:bg-emerald-800/60 disabled:opacity-50 text-sm"
            >
              <Download className="w-4 h-4" />
              {exportBusy === 'xlsx' ? 'Generating…' : 'XLSX'}
            </button>
          </div>
        </header>

        {error && (
          <div className="rounded border border-red-800 bg-red-950/30 p-3 text-sm text-red-200 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5" />
            <div>{error}</div>
          </div>
        )}

        {loading && (
          <div className="flex items-center gap-2 text-neutral-400 text-sm">
            <LoadingSpinner /> Loading week totals…
          </div>
        )}

        {!loading && payload && (
          <>
            <section className="grid grid-cols-2 md:grid-cols-6 gap-2 text-sm">
              <Metric label="Staff" value={String(payload.totals.staffCount)} />
              <Metric label="Regular" value={`${payload.totals.regularHrs.toFixed(1)}h`} />
              <Metric label="Overtime" value={`${payload.totals.overtimeHrs.toFixed(1)}h`} />
              <Metric label="Sunday" value={`${payload.totals.sundayHrs.toFixed(1)}h`} />
              <Metric label="Holiday" value={`${payload.totals.holidayHrs.toFixed(1)}h`} />
              <Metric
                label="Exceptions"
                value={String(payload.totals.exceptionsCount)}
                flag={payload.totals.exceptionsCount > 0}
              />
            </section>

            <WeekSummaryTable staff={payload.staff} days={days} />
          </>
        )}
      </div>
    </AppLayout>
  );
}

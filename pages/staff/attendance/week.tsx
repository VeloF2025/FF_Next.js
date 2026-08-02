import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Calendar, Download, Lock } from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { AttendanceNav } from '@/components/attendance/AttendanceNav';
import { Metric, WeekSummaryTable, type StaffWeekRow } from '@/components/attendance/WeekSummaryTable';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { log } from '@/lib/logger';
import { todayInSast } from '@/components/attendance/dateUtils';
import { usePeriodReadiness } from '@/components/attendance/readiness/usePeriodReadiness';
import { positiveLockVersion } from '@/components/attendance/readiness/lockReadback';

interface WeekPayload {
  weekStart: string; weekEnd: string; staff: StaffWeekRow[];
  totals: { regularHrs: number; overtimeHrs: number; sundayHrs: number; holidayHrs: number;
    nightHrs: number; exceptionsCount: number; staffCount: number };
  payrollTotals: { regularHrs: number; overtimeHrs: number; sundayHrs: number;
    holidayHrs: number; leaveHrs: number; unpaidHrs: number };
  lock: { version: number; lockedAt: string; lockedBy: string; reason: string | null } | null;
}

function thisWeekMonday(): string {
  const date = new Date(`${todayInSast()}T00:00:00Z`);
  const day = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() + (day === 0 ? -6 : 1 - day));
  return date.toISOString().slice(0, 10);
}

function apiMessage(body: unknown, status: number): string {
  const value = (body as { error?: { message?: string } | string } | null)?.error;
  return typeof value === 'string' ? value : value?.message ?? `HTTP ${status}`;
}

async function responseBody(response: Response): Promise<unknown> {
  try { return await response.json(); } catch { return null; }
}

export default function StaffAttendanceWeekPage() {
  const [weekStart, setWeekStart] = useState(thisWeekMonday());
  const [payload, setPayload] = useState<WeekPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [exportBusy, setExportBusy] = useState<'csv' | 'xlsx' | null>(null);
  const weekRequestRef = useRef(0);
  const downloadRef = useRef(0);
  const selectedWeekRef = useRef(weekStart);
  selectedWeekRef.current = weekStart;

  useEffect(() => {
    const requestId = ++weekRequestRef.current;
    let cancelled = false;
    const current = () => !cancelled && requestId === weekRequestRef.current;
    setLoading(true); setError(null); setPayload(null);
    void fetch(`/api/staff/attendance-week?week_start=${encodeURIComponent(weekStart)}`, { credentials: 'same-origin' })
      .then(async (response) => {
        const parsed = await responseBody(response);
        if (!response.ok) throw new Error(apiMessage(parsed, response.status));
        if (current()) setPayload((parsed as { success: true; data: WeekPayload }).data);
      })
      .catch((caught) => {
        if (!current()) return;
        const message = caught instanceof Error ? caught.message : String(caught);
        setError(message); log.error('[staff-attendance-week] load failed', { weekStart, error: message });
      })
      .finally(() => { if (current()) setLoading(false); });
    return () => { cancelled = true; };
  }, [weekStart]);

  const period = usePeriodReadiness(weekStart);
  const days = useMemo(() => Array.from({ length: 7 }, (_, index) => {
    const date = new Date(`${weekStart}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + index);
    return date.toISOString().slice(0, 10);
  }), [weekStart]);
  const candidateLock = payload?.lock ?? null;
  const lockVersion = positiveLockVersion(candidateLock?.version);
  const activeLock = lockVersion === null ? null : candidateLock;
  const hoursState = activeLock ? 'Locked' : 'Approved';

  function changeWeek(value: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return;
    const date = new Date(`${value}T00:00:00Z`);
    const day = date.getUTCDay();
    date.setUTCDate(date.getUTCDate() + (day === 0 ? -6 : 1 - day));
    ++downloadRef.current; setExportBusy(null);
    setWeekStart(date.toISOString().slice(0, 10));
  }

  async function download(format: 'csv' | 'xlsx') {
    if (!activeLock || lockVersion === null) return;
    const requestId = ++downloadRef.current;
    const requestedWeek = weekStart;
    const current = () => requestId === downloadRef.current && selectedWeekRef.current === requestedWeek;
    setExportBusy(format); setError(null);
    try {
      const response = await fetch(`/api/staff/attendance-export?week_start=${encodeURIComponent(weekStart)}&format=${format}&lock_version=${lockVersion}`, { credentials: 'same-origin' });
      if (!current()) return;
      if (!response.ok) throw new Error(apiMessage(await responseBody(response), response.status));
      const url = URL.createObjectURL(await response.blob());
      if (!current()) { URL.revokeObjectURL(url); return; }
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = `attendance-week-${weekStart}.${format}`;
      document.body.appendChild(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(url);
    } catch (caught) {
      if (!current()) return;
      const message = caught instanceof Error ? caught.message : String(caught);
      setError(`Export failed: ${message}`); log.error('[staff-attendance-week] export failed', { format, weekStart, error: message });
    } finally { if (current()) setExportBusy(null); }
  }

  return (
    <AppLayout>
      <AttendanceNav />
      <main className="space-y-4 p-4 lg:p-6">
        <header className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
          <div><h1 className="text-2xl font-semibold">Weekly Attendance</h1><p className="text-sm text-neutral-400">Payroll week {weekStart} — {days[6]}</p></div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex min-h-[44px] items-center gap-2 text-sm text-neutral-300"><Calendar className="h-4 w-4" /><input type="date" value={weekStart} onChange={(event) => changeWeek(event.target.value)} className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1" aria-label="Week-start (auto-snaps to Monday)" /></label>
            {activeLock && lockVersion !== null && <div aria-label="Locked export navigation" className="flex items-center gap-2">
              <span className="text-xs text-amber-300">Lock version {lockVersion}</span>
              <button type="button" onClick={() => { void download('csv'); }} disabled={exportBusy !== null} className="inline-flex min-h-[44px] items-center gap-2 rounded border border-neutral-700 bg-neutral-900 px-3 text-sm disabled:opacity-50"><Download className="h-4 w-4" />{exportBusy === 'csv' ? 'Generating…' : 'CSV'}</button>
              <button type="button" onClick={() => { void download('xlsx'); }} disabled={exportBusy !== null} className="inline-flex min-h-[44px] items-center gap-2 rounded border border-emerald-700 bg-emerald-900/40 px-3 text-sm disabled:opacity-50"><Download className="h-4 w-4" />{exportBusy === 'xlsx' ? 'Generating…' : 'XLSX'}</button>
            </div>}
          </div>
        </header>
        {(error || period.error) && <div role="alert" className="flex items-start gap-2 rounded border border-red-800 bg-red-950/30 p-3 text-sm text-red-200"><AlertTriangle className="mt-0.5 h-4 w-4" />{error ?? period.error}</div>}
        {(loading || (period.loading && !period.readiness)) && <div className="flex items-center gap-2 text-sm text-neutral-400"><LoadingSpinner /> Loading week totals…</div>}
        {!loading && payload && <>
          {activeLock && <div className="flex items-start gap-2 rounded border border-amber-700 bg-amber-950/30 p-3 text-sm text-amber-200"><Lock className="mt-0.5 h-4 w-4" /><span><strong>This payroll week is locked at version {lockVersion}.</strong> Corrections and manual entries remain blocked.{activeLock.reason ? ` Reason: ${activeLock.reason}.` : ''}</span></div>}
          <section className="grid grid-cols-2 gap-2 text-sm md:grid-cols-4 lg:grid-cols-8">
            <Metric label="Staff" value={String(payload.totals.staffCount)} />
            <Metric label={`${hoursState} regular`} value={`${payload.payrollTotals.regularHrs.toFixed(1)}h`} />
            <Metric label={`${hoursState} overtime`} value={`${payload.payrollTotals.overtimeHrs.toFixed(1)}h`} />
            <Metric label={`${hoursState} Sunday`} value={`${payload.payrollTotals.sundayHrs.toFixed(1)}h`} />
            <Metric label={`${hoursState} holiday`} value={`${payload.payrollTotals.holidayHrs.toFixed(1)}h`} />
            <Metric label={`${hoursState} leave`} value={`${payload.payrollTotals.leaveHrs.toFixed(1)}h`} />
            <Metric label={`${hoursState} unpaid`} value={`${payload.payrollTotals.unpaidHrs.toFixed(1)}h`} />
            <Metric label="Exceptions" value={String(payload.totals.exceptionsCount)} flag={payload.totals.exceptionsCount > 0} />
          </section>
          <WeekSummaryTable staff={payload.staff} days={days} />
        </>}
      </main>
    </AppLayout>
  );
}

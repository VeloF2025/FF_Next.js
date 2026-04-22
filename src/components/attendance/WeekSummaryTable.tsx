/**
 * Render helpers for the /staff/attendance/week page.
 *
 * Extracted from pages/staff/attendance/week.tsx to keep each component
 * under CLAUDE.md's 200-line cap. No business logic lives here — the page
 * component still fetches, validates, and downloads; this file only
 * renders what the page hands it.
 */

export interface DayTotals {
  workDate: string;
  regularHrs: number;
  overtimeHrs: number;
  sundayHrs: number;
  holidayHrs: number;
  nightHrs: number;
  exceptionsCount: number;
}

export interface StaffWeekRow {
  staffId: string;
  fullName: string;
  employeeId: string | null;
  days: DayTotals[];
  weekTotals: {
    regularHrs: number;
    overtimeHrs: number;
    sundayHrs: number;
    holidayHrs: number;
    nightHrs: number;
    exceptionsCount: number;
  };
}

function formatHrs(n: number): string {
  return n > 0 ? n.toFixed(2) : '—';
}

function shortDay(ymd: string): string {
  return new Date(`${ymd}T00:00:00Z`).toLocaleDateString('en-ZA', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
  });
}

export function Metric({
  label,
  value,
  flag,
}: {
  label: string;
  value: string;
  flag?: boolean;
}) {
  return (
    <div
      className={`rounded border px-3 py-2 ${
        flag ? 'border-amber-700 bg-amber-900/20' : 'border-neutral-800 bg-neutral-900'
      }`}
    >
      <div className="text-xs text-neutral-400 uppercase tracking-wide">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}

export function WeekSummaryTable({
  staff,
  days,
}: {
  staff: StaffWeekRow[];
  days: string[];
}) {
  return (
    <div className="overflow-x-auto border border-neutral-800 rounded">
      <table className="min-w-full text-sm">
        <thead className="bg-neutral-900 text-neutral-300">
          <tr>
            <th className="text-left px-3 py-2">Staff</th>
            {days.map((d) => (
              <th key={d} className="text-right px-2 py-2 whitespace-nowrap">
                {shortDay(d)}
              </th>
            ))}
            <th className="text-right px-3 py-2 whitespace-nowrap">Reg</th>
            <th className="text-right px-3 py-2 whitespace-nowrap">OT</th>
            <th className="text-right px-3 py-2 whitespace-nowrap">Sun</th>
            <th className="text-right px-3 py-2 whitespace-nowrap">Hol</th>
            <th className="text-right px-3 py-2 whitespace-nowrap">Night</th>
            <th className="text-right px-3 py-2 whitespace-nowrap">Excp</th>
          </tr>
        </thead>
        <tbody>
          {staff.length === 0 && (
            <tr>
              <td colSpan={days.length + 7} className="text-center py-6 text-neutral-500">
                No summaries for this week yet. Run the nightly reconcile cron, or wait
                for it to land.
              </td>
            </tr>
          )}
          {staff.map((s) => (
            <StaffWeekTableRow key={s.staffId} s={s} days={days} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StaffWeekTableRow({ s, days }: { s: StaffWeekRow; days: string[] }) {
  const byDate = new Map(s.days.map((d) => [d.workDate, d]));
  return (
    <tr className="border-t border-neutral-800 hover:bg-neutral-900/50">
      <td className="px-3 py-2">
        <div className="font-medium">{s.fullName}</div>
        {s.employeeId && <div className="text-xs text-neutral-500">{s.employeeId}</div>}
      </td>
      {days.map((d) => {
        const dt = byDate.get(d);
        const totalHrs = dt ? dt.regularHrs + dt.overtimeHrs : 0;
        const hasException = dt ? dt.exceptionsCount > 0 : false;
        return (
          <td
            key={d}
            className={`text-right px-2 py-2 ${hasException ? 'text-amber-400' : ''}`}
          >
            {formatHrs(totalHrs)}
          </td>
        );
      })}
      <td className="text-right px-3 py-2">{s.weekTotals.regularHrs.toFixed(2)}</td>
      <td className="text-right px-3 py-2">{s.weekTotals.overtimeHrs.toFixed(2)}</td>
      <td className="text-right px-3 py-2">{formatHrs(s.weekTotals.sundayHrs)}</td>
      <td className="text-right px-3 py-2">{formatHrs(s.weekTotals.holidayHrs)}</td>
      <td className="text-right px-3 py-2">{formatHrs(s.weekTotals.nightHrs)}</td>
      <td
        className={`text-right px-3 py-2 ${
          s.weekTotals.exceptionsCount > 0 ? 'text-amber-400' : ''
        }`}
      >
        {s.weekTotals.exceptionsCount}
      </td>
    </tr>
  );
}

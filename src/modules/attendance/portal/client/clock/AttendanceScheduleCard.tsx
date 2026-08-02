import React from 'react';

import type { CurrentAttendanceResponse } from '../attendanceStateApi';

export function AttendanceScheduleCard({ attendance }: { attendance: CurrentAttendanceResponse }) {
  const { schedule, result, open } = attendance;
  const shift = schedule.start && schedule.end
    ? `${schedule.start}–${schedule.end}`
    : 'No scheduled shift';
  return (
    <section className="mb-4 rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
        Today&apos;s schedule
      </p>
      <p className="mt-1 text-lg font-semibold text-neutral-100">{shift}</p>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm text-neutral-400">
        {schedule.unpaidBreakMinutes > 0 && (
          <span>{formatHours(schedule.unpaidBreakMinutes / 60)} unpaid lunch</span>
        )}
        <span>{formatHours(result.scheduledPaidHours)} scheduled paid</span>
      </div>
      {result.status === 'open' && open && <ActiveShiftRow clockInAt={open.clockInAt} />}
      {result.status === 'complete' && result.recordedElapsedHours != null && (
        <p className="mt-3 border-t border-neutral-800 pt-3 text-sm font-medium text-neutral-200">
          {formatHours(result.recordedElapsedHours)} recorded
        </p>
      )}
    </section>
  );
}

function ActiveShiftRow({ clockInAt }: { clockInAt: string }) {
  const [elapsedMs, setElapsedMs] = React.useState(
    () => Math.max(0, Date.now() - new Date(clockInAt).getTime())
  );
  React.useEffect(() => {
    const timer = window.setInterval(() => {
      setElapsedMs(Math.max(0, Date.now() - new Date(clockInAt).getTime()));
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [clockInAt]);
  const totalMinutes = Math.floor(elapsedMs / 60_000);
  return (
    <div className="mt-3 border-t border-neutral-800 pt-3 text-sm text-emerald-300">
      <span className="font-semibold">
        Active shift · {Math.floor(totalMinutes / 60)}h {(totalMinutes % 60).toString().padStart(2, '0')}m
      </span>
      <span className="ml-2">Clocked in {formatAttendanceTime(clockInAt)}</span>
    </div>
  );
}

function formatHours(value: number): string {
  return `${Number.isInteger(value) ? value : Number(value.toFixed(2))}h`;
}

function formatAttendanceTime(value: string): string {
  return new Intl.DateTimeFormat('en-ZA', {
    timeZone: 'Africa/Johannesburg',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
}

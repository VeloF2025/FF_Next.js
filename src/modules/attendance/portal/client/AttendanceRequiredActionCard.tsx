import { AlertTriangle } from 'lucide-react';

import type { RequiredAttendanceAction } from './attendanceStateApi';

interface AttendanceRequiredActionCardProps {
  action: RequiredAttendanceAction;
  onCorrect: (exceptionId: string) => void;
}

function formatClockTime(value: string): string {
  return new Intl.DateTimeFormat('en-ZA', {
    timeZone: 'Africa/Johannesburg',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
}

export function AttendanceRequiredActionCard({
  action,
  onCorrect,
}: AttendanceRequiredActionCardProps) {
  return (
    <section className="mb-4 rounded-2xl border border-amber-700/60 bg-amber-950/40 p-4 text-amber-100">
      <div className="flex items-start gap-3">
        <span className="rounded-xl bg-amber-900/60 p-2 text-amber-300">
          <AlertTriangle className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">Previous clock-out missing</h2>
          <p className="mt-1 text-sm text-amber-200/90">
            Clocked in at {formatClockTime(action.clockInAt)}. Submit the time your shift ended before clocking in again.
          </p>
          <p className="mt-2 text-xs font-medium text-amber-300">
            Provisional cap: {action.provisionalPaidHours} hours
          </p>
          <button
            type="button"
            onClick={() => onCorrect(action.exceptionId)}
            className="mt-4 w-full touch-manipulation rounded-xl bg-amber-400 px-4 py-3 text-sm font-semibold text-neutral-950 transition-colors hover:bg-amber-300 active:bg-amber-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-200 focus-visible:ring-offset-2 focus-visible:ring-offset-amber-950"
          >
            Submit clock-out correction
          </button>
        </div>
      </div>
    </section>
  );
}

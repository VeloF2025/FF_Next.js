import React from 'react';
import { Clock } from 'lucide-react';

export function AttendanceClockActionCard({
  open,
  onClockIn,
  onClockOut,
}: {
  open: { clockInAt: string } | null;
  onClockIn: () => void;
  onClockOut: () => void;
}) {
  const [elapsed, setElapsed] = React.useState(
    () => open ? Date.now() - new Date(open.clockInAt).getTime() : 0
  );
  React.useEffect(() => {
    if (!open) return;
    const timer = window.setInterval(() => {
      setElapsed(Date.now() - new Date(open.clockInAt).getTime());
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [open]);

  return (
    <div className="mb-4 rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
      <div className="mb-4 flex items-center gap-3">
        <div className={`flex h-10 w-10 items-center justify-center rounded-full ${
          open ? 'bg-emerald-900/50 text-emerald-300' : 'bg-blue-900/50 text-blue-300'
        }`}>
          <Clock className="h-5 w-5" />
        </div>
        <div>
          <div className={`text-xs font-semibold uppercase tracking-wide ${open ? 'text-emerald-300' : 'text-blue-300'}`}>
            {open ? 'On shift' : 'Off shift'}
          </div>
          <div className="text-sm text-neutral-300">
            {open ? `Since ${formatTime(open.clockInAt)} · ${formatDuration(elapsed)}` : 'No active entry'}
          </div>
        </div>
      </div>
      <button
        type="button"
        onClick={open ? onClockOut : onClockIn}
        className={`w-full touch-manipulation rounded-xl py-4 text-lg font-bold text-white shadow-lg active:brightness-90 focus-visible:outline-none focus-visible:ring-2 ${
          open
            ? 'bg-orange-600 shadow-orange-600/20 hover:bg-orange-500 focus-visible:ring-orange-300'
            : 'bg-blue-600 shadow-blue-600/20 hover:bg-blue-500 focus-visible:ring-blue-300'
        }`}
      >
        {open ? 'Clock out' : 'Clock in'}
      </button>
    </div>
  );
}

function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString('en-ZA', {
    hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Johannesburg',
  });
}

function formatDuration(ms: number): string {
  const totalMinutes = Math.max(0, Math.floor(ms / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes.toString().padStart(2, '0')}m` : `${minutes}m`;
}

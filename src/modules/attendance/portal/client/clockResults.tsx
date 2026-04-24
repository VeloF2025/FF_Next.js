/**
 * Terminal-state views for /my/attendance/clock: success, queued-offline,
 * and not-saved. Kept visually distinct so a tired user cannot confuse
 * "submitted" with "saved locally" with "failed".
 */

import { CheckCircle, Clock, XCircle } from 'lucide-react';

export function SuccessView({
  message,
  onDone,
}: {
  message: string;
  onDone: () => void;
}) {
  return (
    <div className="text-center py-10">
      <div className="mx-auto w-16 h-16 rounded-full bg-emerald-900/40 text-emerald-300 flex items-center justify-center mb-4">
        <CheckCircle className="w-8 h-8" />
      </div>
      <h2 className="text-xl font-semibold mb-1 text-neutral-100">{message}</h2>
      <p className="text-sm text-neutral-400 mb-6">
        {new Date().toLocaleTimeString('en-ZA', {
          hour: '2-digit',
          minute: '2-digit',
          timeZone: 'Africa/Johannesburg',
        })}
      </p>
      <button
        type="button"
        onClick={onDone}
        className="px-6 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold shadow-lg shadow-blue-600/20"
      >
        Done
      </button>
    </div>
  );
}

export function QueuedView({
  message,
  queuePosition,
  onDone,
}: {
  message: string;
  queuePosition: number | null;
  onDone: () => void;
}) {
  return (
    <div className="text-center py-10">
      <div className="mx-auto w-16 h-16 rounded-full bg-amber-900/40 text-amber-300 flex items-center justify-center mb-4">
        <Clock className="w-8 h-8" />
      </div>
      <div className="text-[10px] uppercase tracking-widest text-amber-300 font-bold mb-1">
        Saved on this phone — not yet submitted
      </div>
      <h2 className="text-xl font-semibold mb-1 text-neutral-100">{message}</h2>
      {queuePosition !== null && (
        <p className="text-xs text-neutral-400 mb-4">
          {queuePosition} event{queuePosition === 1 ? '' : 's'} waiting to sync.
        </p>
      )}
      <button
        type="button"
        onClick={onDone}
        className="px-6 py-3 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-semibold shadow-lg shadow-amber-600/20"
      >
        OK, I understand
      </button>
    </div>
  );
}

export function NotSavedView({
  message,
  onBack,
}: {
  message: string;
  onBack: () => void;
}) {
  return (
    <div className="text-center py-10">
      <div className="mx-auto w-16 h-16 rounded-full bg-red-900/40 text-red-300 flex items-center justify-center mb-4">
        <XCircle className="w-8 h-8" />
      </div>
      <h2 className="text-xl font-semibold mb-1 text-red-200">Not saved</h2>
      <p className="text-sm text-neutral-300 mb-6 px-4">{message}</p>
      <button
        type="button"
        onClick={onBack}
        className="px-6 py-3 rounded-xl bg-red-600 hover:bg-red-500 text-white font-semibold shadow-lg shadow-red-600/20"
      >
        Try again
      </button>
    </div>
  );
}

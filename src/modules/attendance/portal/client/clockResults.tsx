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
      <div className="mx-auto w-16 h-16 rounded-full bg-green-100 text-green-700 flex items-center justify-center mb-4">
        <CheckCircle className="w-8 h-8" />
      </div>
      <h2 className="text-xl font-semibold mb-1">{message}</h2>
      <p className="text-sm text-gray-500 mb-6">
        {new Date().toLocaleTimeString('en-ZA', {
          hour: '2-digit',
          minute: '2-digit',
          timeZone: 'Africa/Johannesburg',
        })}
      </p>
      <button
        type="button"
        onClick={onDone}
        className="px-6 py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold"
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
      <div className="mx-auto w-16 h-16 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center mb-4">
        <Clock className="w-8 h-8" />
      </div>
      <div className="text-[10px] uppercase tracking-widest text-amber-700 font-bold mb-1">
        Saved on this phone — not yet submitted
      </div>
      <h2 className="text-xl font-semibold mb-1">{message}</h2>
      {queuePosition !== null && (
        <p className="text-xs text-gray-500 mb-4">
          {queuePosition} event{queuePosition === 1 ? '' : 's'} waiting to sync.
        </p>
      )}
      <button
        type="button"
        onClick={onDone}
        className="px-6 py-3 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-semibold"
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
      <div className="mx-auto w-16 h-16 rounded-full bg-red-100 text-red-700 flex items-center justify-center mb-4">
        <XCircle className="w-8 h-8" />
      </div>
      <h2 className="text-xl font-semibold mb-1 text-red-900">Not saved</h2>
      <p className="text-sm text-gray-700 mb-6 px-4">{message}</p>
      <button
        type="button"
        onClick={onBack}
        className="px-6 py-3 rounded-xl bg-red-600 hover:bg-red-700 text-white font-semibold"
      >
        Try again
      </button>
    </div>
  );
}

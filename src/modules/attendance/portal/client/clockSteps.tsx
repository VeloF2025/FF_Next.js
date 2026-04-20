/**
 * Sub-components for /my/attendance/clock. Kept in a single sibling module
 * rather than one-file-per-component to stay under the project's file-count
 * budget while still keeping the page below 300 lines.
 */

import {
  AlertTriangle,
  Camera,
  CheckCircle,
  Loader2,
  MapPin,
  RefreshCw,
} from 'lucide-react';

export interface GpsSnapshot {
  lat: number;
  lon: number;
  accuracyM: number;
  capturedAt: string;
}

export function SelfieStep({
  selfiePreview,
  onCapture,
}: {
  selfiePreview: string | null;
  onCapture: () => void;
}) {
  return (
    <div className="mb-4">
      <div className="text-sm font-semibold text-gray-700 mb-2">1. Take a selfie</div>
      <div className="rounded-2xl bg-white border border-gray-200 overflow-hidden">
        {selfiePreview ? (
          <div className="relative">
            <img
              src={selfiePreview}
              alt="Selfie preview"
              className="w-full h-auto aspect-square object-cover"
            />
            <button
              type="button"
              onClick={onCapture}
              className="absolute bottom-3 right-3 px-3 py-2 rounded-lg bg-black/70 text-white text-xs font-medium inline-flex items-center gap-1"
            >
              <RefreshCw className="w-3 h-3" />
              Retake
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={onCapture}
            className="w-full aspect-square bg-gray-50 flex flex-col items-center justify-center gap-2 text-gray-500 hover:bg-gray-100"
          >
            <Camera className="w-10 h-10" />
            <span className="text-sm font-medium">Tap to take selfie</span>
          </button>
        )}
      </div>
      <p className="text-xs text-gray-500 mt-2 px-1">
        A clear photo of your face. We use it to confirm the person clocking in.
      </p>
    </div>
  );
}

export function GpsStep({
  gps,
  capturing,
  onRetry,
}: {
  gps: GpsSnapshot | null;
  capturing: boolean;
  onRetry: () => void;
}) {
  return (
    <div className="mb-4">
      <div className="text-sm font-semibold text-gray-700 mb-2">2. Confirm location</div>
      <div className="rounded-2xl bg-white border border-gray-200 p-4 flex items-start gap-3">
        <div className="w-10 h-10 rounded-full bg-blue-50 text-blue-700 flex items-center justify-center flex-shrink-0">
          {capturing ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : gps ? (
            <CheckCircle className="w-5 h-5 text-green-600" />
          ) : (
            <MapPin className="w-5 h-5" />
          )}
        </div>
        <div className="flex-1 text-sm">
          {capturing && <div className="text-gray-700">Getting location…</div>}
          {!capturing && gps && (
            <>
              <div className="text-gray-900 font-medium">
                {gps.lat.toFixed(5)}, {gps.lon.toFixed(5)}
              </div>
              <div className="text-xs text-gray-500 mt-0.5">
                Accuracy {Math.round(gps.accuracyM)} m
                {gps.accuracyM > 100 && (
                  <span className="ml-2 inline-flex items-center gap-1 text-yellow-700">
                    <AlertTriangle className="w-3 h-3" />
                    Low accuracy
                  </span>
                )}
              </div>
            </>
          )}
          {!capturing && !gps && (
            <div className="text-gray-700">Location not captured yet.</div>
          )}
          <button
            type="button"
            onClick={onRetry}
            disabled={capturing}
            className="mt-2 text-xs font-medium text-blue-600 hover:text-blue-700 disabled:opacity-50"
          >
            {gps ? 'Refresh location' : 'Get location'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ConsentModal({
  onGrant,
  onCancel,
  submitting,
}: {
  onGrant: () => void | Promise<void>;
  onCancel: () => void;
  submitting: boolean;
}) {
  return (
    <div className="rounded-2xl bg-white border border-gray-200 shadow-sm p-5">
      <h2 className="text-lg font-semibold">Selfie consent required</h2>
      <p className="mt-2 text-sm text-gray-700">
        FibreFlow uses a selfie at each clock-in and clock-out to confirm
        you are the person on shift. The photos are stored securely, only
        visible to your supervisors and HR, and automatically deleted after
        90 days.
      </p>
      <p className="mt-2 text-sm text-gray-700">
        You can withdraw consent at any time, but without it we cannot
        record your attendance and you will be paid on paper timesheets.
      </p>
      <div className="mt-4 flex flex-col gap-2">
        <button
          type="button"
          onClick={onGrant}
          disabled={submitting}
          className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold disabled:opacity-50"
        >
          {submitting ? 'Saving…' : 'I agree — save my consent'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="w-full py-2 text-sm text-gray-600 hover:text-gray-800"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

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

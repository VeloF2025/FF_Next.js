/**
 * Form-step components for /my/attendance/clock (selfie, GPS, consent).
 * Terminal views live in clockResults.tsx; banners in clockBanners.tsx.
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
      <div className="text-sm font-semibold text-neutral-300 mb-2">1. Take a selfie</div>
      <div className="rounded-2xl bg-neutral-900 border border-neutral-800 overflow-hidden">
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
            className="w-full aspect-square bg-neutral-800 flex flex-col items-center justify-center gap-2 text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200"
          >
            <Camera className="w-10 h-10" />
            <span className="text-sm font-medium">Tap to take selfie</span>
          </button>
        )}
      </div>
      <p className="text-xs text-neutral-400 mt-2 px-1">
        A clear photo of your face. We use it to confirm the person clocking in.
      </p>
    </div>
  );
}

export function GpsStep({
  gps,
  capturing,
  onRetry,
  address,
}: {
  gps: GpsSnapshot | null;
  capturing: boolean;
  onRetry: () => void;
  /**
   * Human-readable address resolved from the coords. Rendered under the
   * numeric lat/lon as a quick sanity-check for staff ("yes I'm at
   * Somerset West"). Pass `null` or omit while the lookup is pending or
   * failed — the line is simply hidden.
   */
  address?: string | null;
}) {
  return (
    <div className="mb-4">
      <div className="text-sm font-semibold text-neutral-300 mb-2">2. Confirm location</div>
      <div className="rounded-2xl bg-neutral-900 border border-neutral-800 p-4 flex items-start gap-3">
        <div className="w-10 h-10 rounded-full bg-blue-900/40 text-blue-300 flex items-center justify-center flex-shrink-0">
          {capturing ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : gps ? (
            <CheckCircle className="w-5 h-5 text-emerald-400" />
          ) : (
            <MapPin className="w-5 h-5" />
          )}
        </div>
        <div className="flex-1 text-sm">
          {capturing && <div className="text-neutral-200">Getting location…</div>}
          {!capturing && gps && (
            <>
              <div className="text-neutral-100 font-medium">
                {gps.lat.toFixed(5)}, {gps.lon.toFixed(5)}
              </div>
              {address && (
                <div className="text-xs text-neutral-300 mt-0.5">{address}</div>
              )}
              <div className="text-xs text-neutral-400 mt-0.5">
                Accuracy {Math.round(gps.accuracyM)} m
                {gps.accuracyM > 100 && (
                  <span className="ml-2 inline-flex items-center gap-1 text-yellow-400">
                    <AlertTriangle className="w-3 h-3" />
                    Low accuracy
                  </span>
                )}
              </div>
            </>
          )}
          {!capturing && !gps && (
            <div className="text-neutral-200">Location not captured yet.</div>
          )}
          <button
            type="button"
            onClick={onRetry}
            disabled={capturing}
            className="mt-2 text-xs font-medium text-blue-400 hover:text-blue-300 disabled:opacity-50"
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
    <div className="rounded-2xl bg-neutral-900 border border-neutral-800 p-5">
      <h2 className="text-lg font-semibold text-neutral-100">Selfie consent required</h2>
      <p className="mt-2 text-sm text-neutral-300">
        FibreFlow uses a selfie at each clock-in and clock-out to confirm
        you are the person on shift. The photos are stored securely, only
        visible to your supervisors and HR, and automatically deleted after
        90 days.
      </p>
      <p className="mt-2 text-sm text-neutral-300">
        You can withdraw consent at any time, but without it we cannot
        record your attendance and you will be paid on paper timesheets.
      </p>
      <div className="mt-4 flex flex-col gap-2">
        <button
          type="button"
          onClick={onGrant}
          disabled={submitting}
          className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold disabled:opacity-50 shadow-lg shadow-blue-600/20"
        >
          {submitting ? 'Saving…' : 'I agree — save my consent'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="w-full py-2 text-sm text-neutral-400 hover:text-neutral-200"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

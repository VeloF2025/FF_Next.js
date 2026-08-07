/**
 * Capture the point where a vehicle is parked overnight.
 *
 * Two decisions worth knowing about:
 *
 *   - The accuracy gate is enforced here as well as on the server. The server
 *     is the authority; doing it in the browser too means the driver learns to
 *     step into the open before they have typed a label, not after.
 *   - There is no map picker and no address search. The driver is standing at
 *     the spot — that is the whole reason on-site capture was chosen over
 *     forward geocoding (design §2).
 */
import React from 'react';
import { MapPin, LocateFixed, AlertTriangle } from 'lucide-react';

import { captureGPSWithFallback } from '@/modules/fleet/offline/gpsCapture';
import { MAX_CAPTURE_ACCURACY_M } from '../declarationRules';
import { ParkingApiError, fetchGeocodeLabel, submitDeclaration } from './parkingApi';

interface Fix {
  lat: number;
  lon: number;
  accuracyM: number;
  addressLabel: string | null;
}

const inputCls =
  'w-full px-3 py-2.5 bg-neutral-950 border border-neutral-700 rounded-lg text-neutral-100 focus:outline-none focus:ring-2 focus:ring-emerald-500';

export function ParkingCapture({
  registration,
  isChange,
  onDone,
  onCancel,
}: {
  registration: string;
  isChange: boolean;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [fix, setFix] = React.useState<Fix | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [label, setLabel] = React.useState('');
  const [note, setNote] = React.useState('');

  const capture = async () => {
    setBusy(true);
    setError(null);
    const result = await captureGPSWithFallback();
    if (!result.success || !result.coordinates) {
      setError(
        result.errorKind === 'denied'
          ? 'Location permission is off. Turn it on for this site in your browser settings, then reload this page.'
          : (result.error ?? 'Could not read your location. Try again in the open.')
      );
      setBusy(false);
      return;
    }
    const { latitude, longitude, accuracy } = result.coordinates;
    if (accuracy > MAX_CAPTURE_ACCURACY_M) {
      setError(
        `Your location is only accurate to ${Math.round(accuracy)}m. Move into the open, away from buildings and roofs, then try again.`
      );
      setBusy(false);
      return;
    }
    const addressLabel = await fetchGeocodeLabel(latitude, longitude);
    setFix({ lat: latitude, lon: longitude, accuracyM: accuracy, addressLabel });
    setBusy(false);
  };

  const submit = async () => {
    if (!fix) return;
    setBusy(true);
    setError(null);
    try {
      await submitDeclaration({
        lat: fix.lat,
        lon: fix.lon,
        accuracyM: fix.accuracyM,
        label: label.trim() || undefined,
        requestNote: note.trim() || undefined,
      });
      onDone();
    } catch (err) {
      setError(err instanceof ParkingApiError ? err.message : 'Could not submit. Please try again.');
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
        <h2 className="text-sm font-semibold text-neutral-100">
          {isChange
            ? `Change where ${registration} parks`
            : `Where is ${registration} parked overnight?`}
        </h2>
        <p className="text-xs text-neutral-400 mt-1">
          Stand where you park the vehicle at night and tap the button below. Your manager
          approves the address before it takes effect.
        </p>
      </div>

      {error && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 flex gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-300 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-100">{error}</p>
        </div>
      )}

      {!fix ? (
        <button
          type="button"
          onClick={capture}
          disabled={busy}
          className="w-full px-4 py-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white font-medium rounded-lg flex items-center justify-center gap-2"
        >
          <LocateFixed className="w-4 h-4" />
          {busy ? 'Finding your location…' : 'Use my current location'}
        </button>
      ) : (
        <div className="space-y-4">
          <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
            <div className="flex items-start gap-2">
              <MapPin className="w-4 h-4 text-emerald-300 shrink-0 mt-0.5" />
              <div>
                <div className="text-sm text-neutral-100">
                  {fix.addressLabel ?? 'Unnamed location'}
                </div>
                <div className="text-xs text-neutral-400 mt-0.5">
                  {fix.lat.toFixed(6)}, {fix.lon.toFixed(6)} · accurate to{' '}
                  {Math.round(fix.accuracyM)}m
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setFix(null)}
              className="text-xs text-neutral-400 underline mt-3"
            >
              Capture again
            </button>
          </div>

          <div>
            <label
              htmlFor="parking-label"
              className="block text-sm font-medium text-neutral-200 mb-2"
            >
              Name this place <span className="text-neutral-500">(optional)</span>
            </label>
            <input
              id="parking-label"
              className={inputCls}
              maxLength={120}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="My yard"
            />
          </div>

          <div>
            <label
              htmlFor="parking-note"
              className="block text-sm font-medium text-neutral-200 mb-2"
            >
              {isChange ? 'Why are you changing it?' : 'Anything your manager should know?'}{' '}
              <span className="text-neutral-500">(optional)</span>
            </label>
            <textarea
              id="parking-note"
              className={inputCls}
              rows={3}
              maxLength={1000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          <button
            type="button"
            onClick={submit}
            disabled={busy}
            className="w-full px-4 py-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white font-medium rounded-lg"
          >
            {busy ? 'Sending…' : 'Send for approval'}
          </button>
        </div>
      )}

      <button type="button" onClick={onCancel} className="w-full text-xs text-neutral-400 underline">
        Cancel
      </button>
    </div>
  );
}

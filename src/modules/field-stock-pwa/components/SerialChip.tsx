'use client';

/**
 * SerialChip — displays a single scanned serial in the ScanSerialsStep list.
 *
 * State colours:
 *   amber   — pending-validation (spin icon while API call is in flight)
 *   emerald — valid
 *   rose    — invalid (shows error message + remove button)
 */

import { CheckCircle, XCircle, Loader2, Camera, Trash2 } from 'lucide-react';
import type { PwaScannedSerial } from '@/modules/field-stock-pwa/types';

export interface SerialChipProps {
  serial: PwaScannedSerial;
  /** Called when the user taps the remove button on an invalid row. */
  onRemove: (serialNumber: string) => void;
  /**
   * Capture a photograph of this unit's label, which is what admits a single
   * unit the stock sheet has never listed. Offered only where a photo would
   * change the outcome.
   */
  onPhotograph?: (serialNumber: string) => void;
}

function borderClass(state: PwaScannedSerial['state'], warned = false): string {
  if (state === 'valid') {
    // Usable, but recorded elsewhere — amber says "note this", not "stop".
    return warned ? 'border-amber-700 bg-amber-950/25' : 'border-emerald-800 bg-emerald-950/30';
  }
  if (state === 'invalid') return 'border-rose-800 bg-rose-950/30';
  return 'border-amber-800 bg-amber-950/30';
}

function StateIcon({ state }: { state: PwaScannedSerial['state'] }) {
  if (state === 'valid')
    return <CheckCircle className="w-4 h-4 text-emerald-400 flex-shrink-0" />;
  if (state === 'invalid')
    return <XCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />;
  return <Loader2 className="w-4 h-4 text-amber-400 flex-shrink-0 animate-spin" />;
}

export function SerialChip({ serial, onRemove, onPhotograph }: SerialChipProps) {
  // Only where a photo would actually change the outcome. Read from the
  // verdict's own flag, NOT from the message text: matching copy with a regex
  // loses the button silently the moment anyone rewords or translates it.
  const photoWouldHelp = serial.state === 'invalid' && serial.canPhotograph === true;
  return (
    <li
      className={`px-3 py-2.5 rounded-lg border flex items-start gap-2 ${borderClass(serial.state, !!serial.warning)}`}
    >
      <StateIcon state={serial.state} />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-mono text-white truncate">{serial.serialNumber}</div>
        {serial.state === 'invalid' && serial.errorMessage && (
          <div className="text-xs text-rose-300 mt-0.5">{serial.errorMessage}</div>
        )}
        {serial.state === 'valid' && serial.warning && (
          <div className="text-xs text-amber-300 mt-0.5">{serial.warning}</div>
        )}
      </div>
      {photoWouldHelp && onPhotograph && (
        <button
          type="button"
          onClick={() => onPhotograph(serial.serialNumber)}
          aria-label={`Photograph the label for ${serial.serialNumber}`}
          className="text-amber-300 hover:text-amber-200 flex-shrink-0 p-0.5"
        >
          <Camera className="w-4 h-4" />
        </button>
      )}
      {serial.state === 'invalid' && (
        <button
          type="button"
          onClick={() => onRemove(serial.serialNumber)}
          aria-label={`Remove ${serial.serialNumber}`}
          className="text-rose-400 hover:text-rose-200 flex-shrink-0 p-0.5"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      )}
    </li>
  );
}

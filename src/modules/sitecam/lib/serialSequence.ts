// src/modules/sitecam/lib/serialSequence.ts
// Pure helpers for walking a step's ordered serial list (step 6: ONT then Gizzu
// UPS). Shared by the capture state machine (save + dev skip) and draft restore
// so the "next serial vs last serial" rule lives in exactly one place.
import type { StepState } from './sitecamTypes';

type SerialCursor = Pick<StepState, 'serialIndex' | 'serials'>;

/** True when the step's current serial is the last one to scan. */
export function isLastSerial(step: SerialCursor): boolean {
  return step.serialIndex + 1 >= Math.max(step.serials.length, 1);
}

/**
 * State patch advancing a serial-scan step to its NEXT serial (used when the
 * current serial is saved or skipped and more remain). Resets the per-serial
 * attempt counter and mirrors the next serial's device/label for the UI.
 */
export function nextSerialPatch(step: SerialCursor): Partial<StepState> {
  const serialIndex = step.serialIndex + 1;
  const next = step.serials[serialIndex] ?? null;
  return {
    serialIndex,
    serialLabel: next?.label ?? '',
    serialDevice: next?.device ?? null,
    serialAttempts: 0,
    serialScanned: null,
  };
}

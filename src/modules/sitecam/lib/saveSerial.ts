// src/modules/sitecam/lib/saveSerial.ts
// POST a confirmed serial to the verify-serial endpoint and normalise the
// outcome into a small result union. Extracted from SerialScanStep so the
// component stays presentational (and under the component-size limit) and the
// save/parse/timeout logic can be unit-tested on its own.
import { log } from '@/lib/logger';

const MODULE = 'saveSerial';
const SAVE_TIMEOUT_MS = 15_000;

type CrossRefStatus = 'verified' | 'mismatch' | 'pending';

export type SaveSerialInput = {
  drNumber: string;
  step: number;
  device: 'ont' | 'ups';
  scannedSerial: string;
  attemptNumber: number;
};

export type SaveSerialResult =
  | { kind: 'saved'; serial: string; message: string; crossRefStatus: CrossRefStatus }
  | { kind: 'invalid'; message: string }
  | { kind: 'error'; message: string };

export async function saveSerial(input: SaveSerialInput): Promise<SaveSerialResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SAVE_TIMEOUT_MS);
  try {
    const res = await fetch('/api/my/sitecam/verify-serial', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        drNumber: input.drNumber,
        step: input.step,
        device: input.device,
        scannedSerial: input.scannedSerial,
        attemptNumber: input.attemptNumber,
      }),
    });
    const json = (await res.json().catch(() => null)) as {
      data?: { result: 'saved' | 'invalid_format'; serial: string; message: string; crossRefStatus?: CrossRefStatus };
      error?: string;
      message?: string;
    } | null;

    if (!res.ok) {
      return { kind: 'error', message: json?.error ?? json?.message ?? `Could not save serial (HTTP ${res.status}). Try again.` };
    }
    if (!json?.data) {
      return { kind: 'error', message: 'Could not save serial — the server returned an unexpected response. Try again.' };
    }
    const { result, serial, message, crossRefStatus } = json.data;
    if (result === 'saved') {
      return { kind: 'saved', serial, message, crossRefStatus: crossRefStatus ?? 'pending' };
    }
    return { kind: 'invalid', message };
  } catch (err) {
    const isAbort = err instanceof Error && err.name === 'AbortError';
    log.error('Verify serial failed', { err: String(err) }, MODULE);
    return {
      kind: 'error',
      message: isAbort
        ? 'Saving timed out. Check signal, then review and confirm again — your serial is still here.'
        : 'Network error while saving. Check signal, then review and confirm again — your serial is still here.',
    };
  } finally {
    clearTimeout(timeout);
  }
}

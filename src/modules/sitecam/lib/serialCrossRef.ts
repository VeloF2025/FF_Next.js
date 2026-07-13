/**
 * Server-side cross-reference of a scanned SiteCam serial against the DR's
 * 1Map record (OneMap API, which also carries the OES-imported serials).
 * Completes the original SiteCam design: scan-time saves the serial as
 * 'pending'; this resolves it to 'verified' / 'mismatch' when reference
 * data exists, and leaves it 'pending' when the DR has no record yet.
 */

import { log } from '@/lib/logger';
import { type SerialDevice } from './verifySerial';

const ONEMAP_HOST = process.env.ONEMAP_HOST ?? 'http://100.96.203.105:8003';
const CROSS_REF_TIMEOUT_MS = 5_000;

export type CrossRefStatus = 'verified' | 'mismatch' | 'pending';

export interface CrossRefResult {
  status: CrossRefStatus;
  /** The reference serial we compared against, when one was found. */
  expectedSerial: string | null;
}

/** Values permitted by the dr_photo_unified_reviews.{ont,ups}_serial_status CHECK constraint. */
export type SerialStatusColumn = 'pending' | 'pass' | 'fail';

/**
 * Map a cross-reference status to the value persisted in the
 * `dr_photo_unified_reviews.{ont,ups}_serial_status` column. That column's
 * CHECK constraint only permits {'pending','pass','fail','locked'} — writing
 * the raw CrossRefStatus ('verified'/'mismatch') violates it and 500s the
 * serial save, stranding the technician on step 6. The raw CrossRefStatus is
 * still returned to the client (see verify-serial) for its UI messaging; only
 * the persisted value must be mapped.
 */
export function crossRefStatusToColumn(status: CrossRefStatus): SerialStatusColumn {
  switch (status) {
    case 'verified':
      return 'pass';
    case 'mismatch':
      return 'fail';
    case 'pending':
      return 'pending';
  }
}

/**
 * Pure decision: compare a scanned serial to the reference value. EXACT match
 * (case- and whitespace-normalised) — for authority-grade ONT/UPS asset
 * cross-reference any character difference is a mismatch, so a single mis-scanned
 * digit surfaces for QA rather than silently "verifying" the wrong device.
 */
export function decideCrossRefStatus(
  scanned: string,
  expected: string | null | undefined,
): CrossRefResult {
  if (typeof expected !== 'string' || expected.trim().length === 0) {
    return { status: 'pending', expectedSerial: null };
  }
  const normalised = expected.trim().toUpperCase();
  return {
    status: scanned.trim().toUpperCase() === normalised ? 'verified' : 'mismatch',
    expectedSerial: normalised,
  };
}

/**
 * Look up the DR on 1Map and compare the scanned serial. Best-effort: any
 * lookup failure resolves to 'pending' — cross-reference must never block
 * or crash the scan flow.
 */
export async function crossReferenceSerial(
  drNumber: string,
  device: SerialDevice,
  scannedSerial: string,
): Promise<CrossRefResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CROSS_REF_TIMEOUT_MS);
  try {
    const resp = await fetch(`${ONEMAP_HOST}/api/record/${encodeURIComponent(drNumber)}`, {
      signal: controller.signal,
    });
    if (!resp.ok) {
      return { status: 'pending', expectedSerial: null };
    }
    const data = await resp.json() as { ont_barcode?: unknown; ups_serial?: unknown };
    const expected = device === 'ont' ? data.ont_barcode : data.ups_serial;
    return decideCrossRefStatus(scannedSerial, typeof expected === 'string' ? expected : null);
  } catch (err) {
    log.warn('Serial cross-reference lookup failed — leaving pending', {
      drNumber, device, err: String(err),
    }, 'serialCrossRef');
    return { status: 'pending', expectedSerial: null };
  } finally {
    clearTimeout(timeout);
  }
}

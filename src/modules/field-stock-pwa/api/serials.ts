/**
 * Serial validation helpers for the field-stock PWA.
 *
 * Serial validation:
 *   GET /api/my/stores/serials/[serialNumber] returns a StockSerial
 *   via getSerialByNumber which does NOT join stock_items, so itemName is absent.
 *   validateSerial therefore returns stockItemName: undefined when the serial exists
 *   but has no joined item name. Callers must handle the optional field gracefully.
 *
 * Photo-to-serial extraction:
 *   extractSerialFromPhoto POSTs to /api/my/stores/serials/extract and returns
 *   SerialExtractResult. Compress to 1920px (not 1280) to preserve barcode density.
 */

import { request, ApiError } from './request';

// =============================================================================
// Photo-to-serial extraction
// =============================================================================

export interface SerialExtractResult {
  serial: string | null;
  family: 'ont' | 'gizzu' | 'generic' | null;
  method: 'barcode' | 'vlm' | 'none';
  confidence: number;
  photoUrl: string | null;
}

/**
 * Photo→serial fallback: POST the captured still to the extract endpoint.
 * Caller compresses to 1920px max (NOT the receipts 1280 default — barcode
 * density must survive for the server-side zxing pass).
 */
export async function extractSerialFromPhoto(photo: Blob): Promise<SerialExtractResult> {
  const form = new FormData();
  form.append('photo', photo, 'serial.jpg');
  const res = await fetch('/api/my/stores/serials/extract', { method: 'POST', body: form });
  const json = (await res.json()) as {
    success: boolean;
    data?: SerialExtractResult;
    error?: { code?: string; message?: string };
  };
  if (!res.ok || !json.success || !json.data) {
    throw new ApiError(
      res.status,
      json.error?.code ?? 'EXTRACT_ERROR',
      json.error?.message ?? `Extraction failed (${res.status})`,
    );
  }
  return json.data;
}

// =============================================================================
// Server row shape
// =============================================================================

/** Shape returned by GET /api/my/stores/serials/[serialNumber] */
interface SerialRow {
  id: string;
  stockItemId: string;
  serialNumber: string;
  status: string;
  /** Present only when the serial service was called via getSerials (with joins). */
  itemName?: string;
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Validate a scanned serial number against the stock serials table.
 *
 * Returns valid=true when the serial exists and has status 'available'.
 * stockItemName may be undefined — the single-serial endpoint does not join
 * stock_items. Callers should display stockItemId as a fallback.
 *
 * Returns valid=false (with errorMessage) when:
 *  - Serial not found (404)
 *  - Serial status is not 'available' (e.g. 'issued', 'installed')
 *  - Any unexpected API error
 */
export async function validateSerial(serialNumber: string): Promise<{
  valid: boolean;
  stockItemId?: string;
  stockItemName?: string;
  errorMessage?: string;
}> {
  try {
    const serial = await request<SerialRow>(
      `/api/my/stores/serials/${encodeURIComponent(serialNumber)}`
    );

    if (serial.status !== 'available' && serial.status !== 'in_stock') {
      return {
        valid: false,
        stockItemId: serial.stockItemId,
        stockItemName: serial.itemName,
        errorMessage: `Serial is not available (status: ${serial.status})`,
      };
    }

    return {
      valid: true,
      stockItemId: serial.stockItemId,
      stockItemName: serial.itemName,
    };
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      return { valid: false, errorMessage: 'Serial number not found' };
    }
    // Propagate unexpected errors so the caller's error boundary handles them.
    throw err;
  }
}

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
  /** Every serial the photo yielded. A carton gives nine; a unit label gives one. */
  serials: string[];
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
  currentLocationId?: string | null;
  /** Joined by the /my/stores serial route; absent from other serial endpoints. */
  currentLocationName?: string | null;
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
  currentLocationId?: string | null;
  currentLocationName?: string | null;
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
        currentLocationId: serial.currentLocationId,
        currentLocationName: serial.currentLocationName,
        errorMessage: `Serial is not available (status: ${serial.status})`,
      };
    }

    return {
      valid: true,
      stockItemId: serial.stockItemId,
      stockItemName: serial.itemName,
      currentLocationId: serial.currentLocationId,
      currentLocationName: serial.currentLocationName,
    };
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      return { valid: false, errorMessage: 'Serial number not found' };
    }
    // Propagate unexpected errors so the caller's error boundary handles them.
    throw err;
  }
}

// =============================================================================
// Batch validation (carton scans)
// =============================================================================

export interface BatchSerialResult {
  serialNumber: string;
  valid: boolean;
  errorMessage?: string;
  /** Set on a valid row worth flagging — e.g. not on the stock sheet yet. */
  warning?: string;
  /** True when the serial will be taken into stock at picking time. */
  provisional?: true;
  stockItemId?: string;
  stockItemName?: string;
  currentLocationId?: string | null;
  currentLocationName?: string | null;
}

export interface BatchSerialResponse {
  results: BatchSerialResult[];
  quantsWarning?: { serialsInStock: number; quantsOnHand: number };
}

/**
 * Validate every serial from one carton scan in a single round-trip.
 *
 * Unlike validateSerial, this never throws on a per-serial problem — an unknown
 * or misplaced serial comes back as a result with valid=false, so a partial box
 * still yields its good members. Transport errors still throw.
 */
export async function validateSerialBatch(input: {
  serials: string[];
  stockItemId: string;
  sourceLocationId?: string | null;
  /**
   * The RAW decoded scan payload. The server re-derives which serials it
   * corroborates; there is deliberately no client flag saying "trust me".
   */
  scanPayload?: string | null;
}): Promise<BatchSerialResponse> {
  return request<BatchSerialResponse>('/api/my/stores/serials/validate-batch', {
    method: 'POST',
    body: JSON.stringify({
      serials: input.serials,
      stockItemId: input.stockItemId,
      sourceLocationId: input.sourceLocationId ?? null,
      scanPayload: input.scanPayload ?? null,
    }),
  });
}

/**
 * Location constants and fetch helper for the field-stock PWA.
 *
 * FIELD_DEFAULT_LOCATION_ID matches the UUID seeded by migration 357.
 * It is the fixed destination for all /my/stores issue pickings — a virtual
 * 'transit' location that acts as a logical sink until per-technician
 * van-stock locations are wired end-to-end.
 *
 * useStoresLocations() is a lightweight inline fetch hook for use in the PWA
 * layer only. It does NOT import useLocations from the procurement module
 * (which brings in server-side imports and the full StockLocation shape).
 */

import { useState, useEffect, useCallback } from 'react';
import { ApiError } from '../api';

// 🟢 WORKING: matches migration 357_field_default_location.sql
export const FIELD_DEFAULT_LOCATION_ID = '00000000-0000-0000-0000-000000000001';

// =============================================================================
// Minimal location shape (camelCase, as returned by GET /api/my/stores/locations)
// =============================================================================

export interface PwaStockLocation {
  id: string;
  name: string;
  code: string;
  locationType: string;
  isActive: boolean;
  /**
   * Logical bin classification. Defined by migration 182 CHECK constraint:
   *   main | department | project | technician | in_transit | faulty | quarantine
   *
   * The "Faulty Equipment Bin" has locationType='warehouse' and binType='faulty'
   * (seeded in migration 182) — it must be excluded from the picker.
   * Not all rows have this populated; null is allowed.
   */
  binType: string | null;
}

// =============================================================================
// Fetch helper — wraps GET /api/my/stores/locations
// =============================================================================

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string };
}

async function fetchLocationsRaw(): Promise<PwaStockLocation[]> {
  // Request warehouse-type only at the server to reduce payload size.
  // The server may still return non-warehouse rows if it doesn't support the
  // locationType query param yet, so we apply client-side filtering defensively.
  const url = '/api/my/stores/locations?locationType=warehouse';
  let res: Response;
  try {
    res = await fetch(url, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ApiError(0, 'NETWORK_ERROR', 'Could not reach the server.', { cause: message });
  }

  let envelope: ApiEnvelope<PwaStockLocation[]> | null = null;
  try {
    const text = await res.text();
    envelope = text ? (JSON.parse(text) as ApiEnvelope<PwaStockLocation[]>) : null;
  } catch {
    throw new ApiError(res.status, 'PARSE_ERROR', `Non-JSON response (HTTP ${res.status})`);
  }

  if (!envelope) {
    throw new ApiError(res.status, 'EMPTY_RESPONSE', `Empty response (HTTP ${res.status})`);
  }
  if (!res.ok || !envelope.success) {
    const e = envelope.error ?? { code: 'UNKNOWN', message: `HTTP ${res.status}` };
    throw new ApiError(res.status, e.code, e.message);
  }

  return envelope.data ?? [];
}

// =============================================================================
// Hook
// =============================================================================

export interface UseStoresLocationsResult {
  /** Warehouse-type locations only, excluding the FIELD-DEFAULT row. */
  warehouses: PwaStockLocation[];
  loading: boolean;
  error: string | null;
  reload: () => void;
}

// =============================================================================
// Pure filter helper (exported for unit tests)
// =============================================================================

/**
 * Pure predicate: returns true only for locations that belong in the warehouse picker.
 *
 * Exclusion rules:
 *   1. locationType !== 'warehouse' — only warehouse rows are selectable
 *   2. !isActive — inactive locations are hidden
 *   3. id === FIELD_DEFAULT_LOCATION_ID — the synthetic transit destination row must never
 *      appear as a source
 *   4. binType === 'faulty' — "Faulty Equipment Bin" is seeded with locationType='warehouse'
 *      AND binType='faulty' (migration 182); the locationType check alone cannot exclude it
 *   5. code === 'FAULTY' — belt-and-braces heuristic: if the API stops returning binType
 *      (column dropped in a future migration), we still exclude this row by its stable code
 *
 * Exported so unit tests can assert the predicate without mounting the hook.
 */
export function filterWarehouseLocations(
  locations: PwaStockLocation[],
): PwaStockLocation[] {
  return locations.filter(
    (l) =>
      l.locationType === 'warehouse' &&
      l.isActive &&
      l.id !== FIELD_DEFAULT_LOCATION_ID &&
      l.binType !== 'faulty' &&
      l.code !== 'FAULTY',
  );
}

/**
 * Fetch active warehouse locations for the PickWarehouseStep picker.
 *
 * Filters applied client-side after the server-filtered list is returned:
 *   - locationType === 'warehouse' (defence-in-depth: server already filters)
 *   - isActive === true
 *   - id !== FIELD_DEFAULT_LOCATION_ID (excludes the synthetic destination row)
 *   - binType !== 'faulty' (excludes "Faulty Equipment Bin" seeded by migration 182;
 *       that row has locationType='warehouse' AND binType='faulty', so the locationType
 *       filter alone cannot remove it — we must check binType explicitly)
 *   - code !== 'FAULTY' (belt-and-braces heuristic in case binType is not returned
 *       by a future API version that drops the bin_type column)
 */
export function useStoresLocations(): UseStoresLocationsResult {
  const [warehouses, setWarehouses] = useState<PwaStockLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const reload = useCallback(() => {
    setTick((t) => t + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchLocationsRaw()
      .then((all) => {
        if (cancelled) return;
        setWarehouses(filterWarehouseLocations(all));
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load locations');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [tick]);

  return { warehouses, loading, error, reload };
}

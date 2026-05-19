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
// Minimal location shape (camelCase, as returned by GET /api/procurement/field-stock/locations)
// =============================================================================

export interface PwaStockLocation {
  id: string;
  name: string;
  code: string;
  locationType: string;
  isActive: boolean;
}

// =============================================================================
// Fetch helper — wraps GET /api/procurement/field-stock/locations
// =============================================================================

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string };
}

async function fetchLocationsRaw(): Promise<PwaStockLocation[]> {
  let res: Response;
  try {
    res = await fetch('/api/procurement/field-stock/locations', {
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

/**
 * Fetch active warehouse locations for the PickWarehouseStep picker.
 *
 * Filters applied client-side after the full list is returned:
 *   - locationType === 'warehouse'
 *   - isActive === true
 *   - id !== FIELD_DEFAULT_LOCATION_ID (excludes the destination row from picker)
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
        const filtered = all.filter(
          (l) =>
            l.locationType === 'warehouse' &&
            l.isActive &&
            l.id !== FIELD_DEFAULT_LOCATION_ID,
        );
        setWarehouses(filtered);
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

/**
 * useHolderAccountability Hook
 * Manages holder-centric stock accountability (Sprint D custody model)
 */

import { useState, useCallback, useEffect, useRef } from 'react';

export interface HolderAccountability {
  holder_id: string;
  holder_type: 'staff' | 'contractor' | 'external_person';
  staff_id: string | null;
  contractor_id: string | null;
  name: string;
  is_active: boolean;
  issued_count: number;
  issued_value: number;
  consumed_count: number;
  consumed_value: number;
  returned_count: number;
  returned_value: number;
  held_count: number;
  held_value: number;
  unaccounted_count: number;
  is_blocked: boolean;
  blocked_reason: string | null;
  blocked_at: string | null;
  blocked_by: string | null;
  pending_recovery_amount: number;
  recovered_amount: number;
}

interface UseHolderAccountabilityOptions {
  isBlocked?: boolean;
  hasUnaccounted?: boolean;
  autoFetch?: boolean;
}

interface UseHolderAccountabilityReturn {
  holders: HolderAccountability[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useHolderAccountability(
  options: UseHolderAccountabilityOptions = {}
): UseHolderAccountabilityReturn {
  const { isBlocked, hasUnaccounted, autoFetch = true } = options;
  const [holders, setHolders] = useState<HolderAccountability[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (isBlocked !== undefined) params.set('isBlocked', String(isBlocked));
      if (hasUnaccounted !== undefined) params.set('hasUnaccounted', String(hasUnaccounted));

      const response = await fetch(
        `/api/procurement/field-stock/accountability/holders?${params}`
      );
      if (!response.ok) throw new Error('Failed to fetch holder accountability records');
      const result = await response.json();
      setHolders(result.data || []);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [isBlocked, hasUnaccounted]);

  const hasFetched = useRef(false);

  useEffect(() => {
    if (autoFetch && !hasFetched.current) {
      hasFetched.current = true;
      refetch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFetch]);

  return { holders, loading, error, refetch };
}

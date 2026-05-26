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

/** Postgres numeric columns arrive as strings over JSON; coerce to real numbers. */
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

function toHolderAccountability(r: Record<string, unknown>): HolderAccountability {
  return {
    holder_id: String(r.holder_id),
    holder_type: r.holder_type as HolderAccountability['holder_type'],
    staff_id: (r.staff_id as string) ?? null,
    contractor_id: (r.contractor_id as string) ?? null,
    name: String(r.name),
    is_active: Boolean(r.is_active),
    issued_count: num(r.issued_count),
    issued_value: num(r.issued_value),
    consumed_count: num(r.consumed_count),
    consumed_value: num(r.consumed_value),
    returned_count: num(r.returned_count),
    returned_value: num(r.returned_value),
    held_count: num(r.held_count),
    held_value: num(r.held_value),
    unaccounted_count: num(r.unaccounted_count),
    is_blocked: Boolean(r.is_blocked),
    blocked_reason: (r.blocked_reason as string) ?? null,
    blocked_at: (r.blocked_at as string) ?? null,
    blocked_by: (r.blocked_by as string) ?? null,
    pending_recovery_amount: num(r.pending_recovery_amount),
    recovered_amount: num(r.recovered_amount),
  };
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
      const rows = (result.data as Record<string, unknown>[]) || [];
      setHolders(rows.map(toHolderAccountability));
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

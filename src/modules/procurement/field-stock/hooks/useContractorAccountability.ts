/**
 * useContractorAccountability Hook
 * Manages contractor stock accountability (SOP Section 10)
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import type { ContractorStockAccountability, StockAccountabilityHistory } from '../types';

interface AccountabilitySummary {
  accountability: ContractorStockAccountability;
  stockHeld: Array<{
    stock_item_id: string;
    item_name: string;
    item_code: string;
    category: string;
    quantity: number;
    location_id: string;
    location_name: string;
    technician_name: string;
  }>;
  unaccountedSerials: Array<{
    id: string;
    serial_number: string;
    item_name: string;
    item_code: string;
    location_name: string;
    technician_name: string;
  }>;
  recentHistory: StockAccountabilityHistory[];
  pendingReturns: Array<{
    id: string;
    return_number: string;
    status: string;
    line_count: number;
  }>;
}

interface ReconciliationResult {
  issued: { count: number; value: number };
  consumed: { count: number; value: number };
  returned: { count: number; value: number };
  unaccounted: { count: number; value: number };
}

interface UseContractorAccountabilityOptions {
  isBlocked?: boolean;
  hasUnaccounted?: boolean;
  autoFetch?: boolean;
}

interface UseContractorAccountabilityReturn {
  contractors: ContractorStockAccountability[];
  loading: boolean;
  error: string | null;
  fetchContractors: () => Promise<void>;
  getContractorSummary: (contractorId: string) => Promise<AccountabilitySummary>;
  blockContractor: (contractorId: string, reason: string, blockedBy: string) => Promise<ContractorStockAccountability>;
  unblockContractor: (contractorId: string, reason: string, unblockedBy: string) => Promise<ContractorStockAccountability>;
  reconcileContractor: (
    contractorId: string,
    reconciledBy: string,
    notes?: string
  ) => Promise<{ accountability: ContractorStockAccountability; reconciliation: ReconciliationResult }>;
  createAccountability: (contractorId: string, contractorName: string) => Promise<ContractorStockAccountability>;
}

export function useContractorAccountability(
  options: UseContractorAccountabilityOptions = {}
): UseContractorAccountabilityReturn {
  const { isBlocked, hasUnaccounted, autoFetch = true } = options;
  const [contractors, setContractors] = useState<ContractorStockAccountability[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchContractors = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (isBlocked !== undefined) params.set('isBlocked', String(isBlocked));
      if (hasUnaccounted !== undefined) params.set('hasUnaccounted', String(hasUnaccounted));

      const response = await fetch(`/api/procurement/field-stock/accountability?${params}`);
      if (!response.ok) throw new Error('Failed to fetch accountability records');
      const result = await response.json();
      setContractors(result.data || []);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [isBlocked, hasUnaccounted]);

  // Track if initial fetch has been done
  const hasFetched = useRef(false);

  // Auto-fetch on mount if enabled (only once)
  useEffect(() => {
    if (autoFetch && !hasFetched.current) {
      hasFetched.current = true;
      fetchContractors();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFetch]);

  const getContractorSummary = useCallback(async (contractorId: string): Promise<AccountabilitySummary> => {
    const response = await fetch(`/api/procurement/field-stock/accountability/${contractorId}`);
    if (!response.ok) {
      const result = await response.json();
      throw new Error(result.message || 'Failed to fetch contractor summary');
    }
    const result = await response.json();
    return result.data;
  }, []);

  const blockContractor = useCallback(async (
    contractorId: string,
    reason: string,
    blockedBy: string
  ): Promise<ContractorStockAccountability> => {
    const response = await fetch(`/api/procurement/field-stock/accountability/${contractorId}/block`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason, blockedBy })
    });

    if (!response.ok) {
      const result = await response.json();
      throw new Error(result.message || 'Failed to block contractor');
    }

    const result = await response.json();
    const updated = result.data;
    setContractors(prev => prev.map(c => c.contractorId === contractorId ? updated : c));
    return updated;
  }, []);

  const unblockContractor = useCallback(async (
    contractorId: string,
    reason: string,
    unblockedBy: string
  ): Promise<ContractorStockAccountability> => {
    const response = await fetch(`/api/procurement/field-stock/accountability/${contractorId}/unblock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason, unblockedBy })
    });

    if (!response.ok) {
      const result = await response.json();
      throw new Error(result.message || 'Failed to unblock contractor');
    }

    const result = await response.json();
    const updated = result.data;
    setContractors(prev => prev.map(c => c.contractorId === contractorId ? updated : c));
    return updated;
  }, []);

  const reconcileContractor = useCallback(async (
    contractorId: string,
    reconciledBy: string,
    notes?: string
  ): Promise<{ accountability: ContractorStockAccountability; reconciliation: ReconciliationResult }> => {
    const response = await fetch(`/api/procurement/field-stock/accountability/${contractorId}/reconcile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reconciledBy, notes })
    });

    if (!response.ok) {
      const result = await response.json();
      throw new Error(result.message || 'Failed to reconcile contractor');
    }

    const result = await response.json();
    const data = result.data;
    setContractors(prev => prev.map(c => c.contractorId === contractorId ? data : c));
    return {
      accountability: data,
      reconciliation: data.reconciliation
    };
  }, []);

  const createAccountability = useCallback(async (
    contractorId: string,
    contractorName: string
  ): Promise<ContractorStockAccountability> => {
    const response = await fetch('/api/procurement/field-stock/accountability', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contractorId, contractorName })
    });

    if (!response.ok) {
      const result = await response.json();
      throw new Error(result.message || 'Failed to create accountability record');
    }

    const result = await response.json();
    const created = result.data;
    setContractors(prev => [created, ...prev]);
    return created;
  }, []);

  return {
    contractors,
    loading,
    error,
    fetchContractors,
    getContractorSummary,
    blockContractor,
    unblockContractor,
    reconcileContractor,
    createAccountability
  };
}

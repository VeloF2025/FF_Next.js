/**
 * useReturns Hook
 * Manages stock returns with inspection workflow
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import type {
  StockReturn,
  CreateReturnDTO,
  ReturnLineDisposition
} from '../types';

interface UseReturnsOptions {
  status?: string;
  returnedBy?: string;
  autoFetch?: boolean;
}

interface UseReturnsReturn {
  returns: StockReturn[];
  loading: boolean;
  error: string | null;
  fetchReturns: () => Promise<void>;
  createReturn: (data: CreateReturnDTO) => Promise<StockReturn>;
  inspectReturn: (
    returnId: string,
    inspectedBy: string,
    notes?: string,
    lineDispositions?: Record<string, ReturnLineDisposition>
  ) => Promise<StockReturn>;
  acceptReturn: (returnId: string) => Promise<StockReturn>;
  getReturn: (returnId: string) => Promise<StockReturn>;
}

export function useReturns(options: UseReturnsOptions = {}): UseReturnsReturn {
  const { status, returnedBy, autoFetch = true } = options;
  const [returns, setReturns] = useState<StockReturn[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchReturns = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (status) params.set('status', status);
      if (returnedBy) params.set('returnedBy', returnedBy);

      const response = await fetch(`/api/procurement/field-stock/returns?${params}`);
      if (!response.ok) throw new Error('Failed to fetch returns');
      const result = await response.json();
      setReturns(result.data || []);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [status, returnedBy]);

  // Track if initial fetch has been done
  const hasFetched = useRef(false);

  // Auto-fetch on mount if enabled (only once)
  useEffect(() => {
    if (autoFetch && !hasFetched.current) {
      hasFetched.current = true;
      fetchReturns();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFetch]);

  const createReturn = useCallback(async (data: CreateReturnDTO): Promise<StockReturn> => {
    const response = await fetch('/api/procurement/field-stock/returns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        originalPickingId: data.originalPickingId,
        returnedById: data.returnedById,
        returnedByName: data.returnedByName,
        returnToLocationId: data.returnToLocationId,
        notes: data.notes,
        lines: data.lines.map(line => ({
          stockItemId: line.stockItemId,
          serialId: line.serialId,
          serialNumber: line.serialNumber,
          quantity: line.quantity,
          condition: line.condition,
          returnReason: line.returnReason,
          notes: line.notes
        }))
      })
    });

    if (!response.ok) {
      const result = await response.json();
      throw new Error(result.message || 'Failed to create return');
    }

    const result = await response.json();
    const newReturn = result.data;
    setReturns(prev => [newReturn, ...prev]);
    return newReturn;
  }, []);

  const inspectReturn = useCallback(async (
    returnId: string,
    inspectedBy: string,
    notes?: string,
    lineDispositions?: Record<string, ReturnLineDisposition>
  ): Promise<StockReturn> => {
    const response = await fetch(`/api/procurement/field-stock/returns/${returnId}/inspect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        inspectedBy,
        inspectionNotes: notes,
        lineDispositions
      })
    });

    if (!response.ok) {
      const result = await response.json();
      throw new Error(result.message || 'Failed to inspect return');
    }

    const result = await response.json();
    const updatedReturn = result.data;
    setReturns(prev => prev.map(r => r.id === returnId ? updatedReturn : r));
    return updatedReturn;
  }, []);

  const acceptReturn = useCallback(async (returnId: string): Promise<StockReturn> => {
    const response = await fetch(`/api/procurement/field-stock/returns/${returnId}/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });

    if (!response.ok) {
      const result = await response.json();
      throw new Error(result.message || 'Failed to accept return');
    }

    const result = await response.json();
    const updatedReturn = result.data;
    setReturns(prev => prev.map(r => r.id === returnId ? updatedReturn : r));
    return updatedReturn;
  }, []);

  const getReturn = useCallback(async (returnId: string): Promise<StockReturn> => {
    const response = await fetch(`/api/procurement/field-stock/returns?id=${returnId}`);
    if (!response.ok) throw new Error('Failed to fetch return');
    const result = await response.json();
    return result.data;
  }, []);

  return {
    returns,
    loading,
    error,
    fetchReturns,
    createReturn,
    inspectReturn,
    acceptReturn,
    getReturn
  };
}

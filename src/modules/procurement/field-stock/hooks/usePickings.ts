/**
 * usePickings Hook
 * Manage stock picking operations (issue, receipt, transfer, return, scrap)
 */

import { useState, useCallback, useEffect } from 'react';
import type {
  StockPicking,
  StockPickingLine,
  CreatePickingInput,
  SignPickingInput,
  PickingFilters,
  PickingType,
  PickingStatus
} from '../types';

interface UsePickingsOptions {
  autoFetch?: boolean;
  defaultFilters?: PickingFilters;
}

interface UsePickingsReturn {
  pickings: StockPicking[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  createPicking: (input: CreatePickingInput) => Promise<StockPicking>;
  confirmPicking: (pickingId: string) => Promise<StockPicking>;
  processPicking: (pickingId: string) => Promise<StockPicking>;
  signPicking: (pickingId: string, input: SignPickingInput) => Promise<StockPicking>;
  cancelPicking: (pickingId: string) => Promise<void>;
  getPicking: (pickingId: string) => Promise<StockPicking | null>;
}

const API_BASE = '/api/procurement/field-stock/pickings';

/** Map snake_case DB row to camelCase StockPicking */
function mapPicking(row: Record<string, unknown>): StockPicking {
  return {
    id: row.id as string,
    pickingNumber: (row.pickingNumber ?? row.picking_number) as string,
    pickingType: (row.pickingType ?? row.picking_type) as PickingType,
    sourceLocationId: (row.sourceLocationId ?? row.source_location_id) as string,
    destinationLocationId: (row.destinationLocationId ?? row.destination_location_id) as string,
    projectId: (row.projectId ?? row.project_id) as string | undefined,
    jobReference: (row.jobReference ?? row.job_reference) as string | undefined,
    jobType: (row.jobType ?? row.job_type) as StockPicking['jobType'],
    contractorId: (row.contractorId ?? row.contractor_id) as string | undefined,
    contractorName: (row.contractorName ?? row.contractor_name) as string | undefined,
    teamName: (row.teamName ?? row.team_name) as string | undefined,
    technicianId: (row.technicianId ?? row.technician_id) as string | undefined,
    technicianName: (row.technicianName ?? row.technician_name) as string | undefined,
    signatureData: (row.signatureData ?? row.signature_data) as string | undefined,
    signedAt: (row.signedAt ?? row.signed_at) as Date | undefined,
    signedBy: (row.signedBy ?? row.signed_by) as string | undefined,
    status: (row.status) as PickingStatus,
    scheduledDate: (row.scheduledDate ?? row.scheduled_date) as Date | undefined,
    effectiveDate: (row.effectiveDate ?? row.effective_date) as Date | undefined,
    requestedBy: (row.requestedBy ?? row.requested_by) as string | undefined,
    approvedBy: (row.approvedBy ?? row.approved_by) as string | undefined,
    approvedAt: (row.approvedAt ?? row.approved_at) as Date | undefined,
    notes: row.notes as string | undefined,
    createdAt: (row.createdAt ?? row.created_at) as Date,
    updatedAt: (row.updatedAt ?? row.updated_at) as Date,
  };
}

export function usePickings(options: UsePickingsOptions = {}): UsePickingsReturn {
  const { autoFetch = false, defaultFilters = {} } = options;
  const [pickings, setPickings] = useState<StockPicking[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Fetch pickings with optional filters
   */
  const fetchPickings = useCallback(async (filters: PickingFilters = defaultFilters) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (filters.pickingType) params.set('pickingType', filters.pickingType);
      if (filters.status) params.set('status', filters.status);
      if (filters.contractorId) params.set('contractorId', filters.contractorId);
      if (filters.technicianId) params.set('technicianId', filters.technicianId);
      if (filters.projectId) params.set('projectId', filters.projectId);
      if (filters.dateFrom) params.set('dateFrom', filters.dateFrom.toISOString());
      if (filters.dateTo) params.set('dateTo', filters.dateTo.toISOString());

      const url = params.toString() ? `${API_BASE}?${params.toString()}` : API_BASE;
      const response = await fetch(url);

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to fetch pickings');
      }

      const data = await response.json();
      const raw = data.data || [];
      setPickings(raw.map((r: Record<string, unknown>) => mapPicking(r)));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch pickings';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [defaultFilters]);

  /**
   * Create a new picking
   */
  const createPicking = useCallback(async (input: CreatePickingInput): Promise<StockPicking> => {
    const response = await fetch(API_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input)
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Failed to create picking');
    }

    const data = await response.json();
    const newPicking = mapPicking(data.data as Record<string, unknown>);
    setPickings(prev => [newPicking, ...prev]);
    return newPicking;
  }, []);

  /**
   * Confirm a picking (draft → confirmed)
   */
  const confirmPicking = useCallback(async (pickingId: string): Promise<StockPicking> => {
    const response = await fetch(`${API_BASE}/${pickingId}/confirm`, {
      method: 'POST'
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Failed to confirm picking');
    }

    const data = await response.json();
    const updated = mapPicking(data.data as Record<string, unknown>);
    setPickings(prev => prev.map(p => p.id === pickingId ? updated : p));
    return updated;
  }, []);

  /**
   * Process a picking (confirmed → done)
   */
  const processPicking = useCallback(async (pickingId: string): Promise<StockPicking> => {
    const response = await fetch(`${API_BASE}/${pickingId}/process`, {
      method: 'POST'
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Failed to process picking');
    }

    const data = await response.json();
    const updated = mapPicking(data.data as Record<string, unknown>);
    setPickings(prev => prev.map(p => p.id === pickingId ? updated : p));
    return updated;
  }, []);

  /**
   * Sign a picking with digital signature
   */
  const signPicking = useCallback(async (pickingId: string, input: SignPickingInput): Promise<StockPicking> => {
    const response = await fetch(`${API_BASE}/${pickingId}/sign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input)
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Failed to sign picking');
    }

    const data = await response.json();
    const updated = mapPicking(data.data as Record<string, unknown>);
    setPickings(prev => prev.map(p => p.id === pickingId ? updated : p));
    return updated;
  }, []);

  /**
   * Cancel a picking
   */
  const cancelPicking = useCallback(async (pickingId: string): Promise<void> => {
    const response = await fetch(`${API_BASE}/${pickingId}/cancel`, {
      method: 'POST'
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Failed to cancel picking');
    }

    setPickings(prev => prev.filter(p => p.id !== pickingId));
  }, []);

  /**
   * Get a single picking by ID
   */
  const getPicking = useCallback(async (pickingId: string): Promise<StockPicking | null> => {
    const response = await fetch(`${API_BASE}/${pickingId}`);

    if (!response.ok) {
      if (response.status === 404) return null;
      const data = await response.json();
      throw new Error(data.error || 'Failed to fetch picking');
    }

    const data = await response.json();
    return mapPicking(data.data as Record<string, unknown>);
  }, []);

  // Auto-fetch on mount if enabled
  useEffect(() => {
    if (autoFetch) {
      fetchPickings();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFetch]);

  return {
    pickings,
    loading,
    error,
    refresh: fetchPickings,
    createPicking,
    confirmPicking,
    processPicking,
    signPicking,
    cancelPicking,
    getPicking
  };
}

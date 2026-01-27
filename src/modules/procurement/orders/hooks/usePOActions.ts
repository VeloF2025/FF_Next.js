// ============= PO Actions Hook =============
// Handles user actions for purchase orders

import { useState, useCallback } from 'react';
import type { PurchaseOrder, POStatus } from '../../../../types/procurement/po.types';
import { poService } from '../../../../services/procurement/poService';

interface UsePOActionsProps {
  po: PurchaseOrder | null;
  onUpdated: () => void;
  onReload: () => Promise<void>;
}

interface SubmitResult {
  autoApproved: boolean;
  status: string;
}

export const usePOActions = ({ po, onUpdated, onReload }: UsePOActionsProps) => {
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showRejectModal, setShowRejectModal] = useState(false);

  const handleStatusChange = useCallback(async (newStatus: POStatus, notes?: string) => {
    if (!po) return;

    try {
      setActionLoading('status');
      setError(null);
      await poService.updatePOStatus(po.id, newStatus, notes);
      await onReload();
      onUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update status');
    } finally {
      setActionLoading(null);
    }
  }, [po, onReload, onUpdated]);

  const handleSubmitForApproval = useCallback(async (): Promise<SubmitResult | null> => {
    if (!po) return null;

    try {
      setActionLoading('submit');
      setError(null);
      await poService.submitForApproval(po.id);
      await onReload();
      onUpdated();
      return { autoApproved: false, status: 'pending_approval' };
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit for approval');
      return null;
    } finally {
      setActionLoading(null);
    }
  }, [po, onReload, onUpdated]);

  const handleApprove = useCallback(async (notes?: string) => {
    if (!po) return;

    try {
      setActionLoading('approve');
      setError(null);
      await poService.approvePO(po.id, 'current-user');
      await onReload();
      onUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to approve purchase order');
    } finally {
      setActionLoading(null);
    }
  }, [po, onReload, onUpdated]);

  const handleRejectWithReason = useCallback(async (reason: string) => {
    if (!po) return;
    if (!reason.trim()) {
      setError('Rejection reason is required');
      return;
    }

    try {
      setActionLoading('reject');
      setError(null);
      await poService.rejectPO(po.id, 'current-user', reason);
      await onReload();
      onUpdated();
      setShowRejectModal(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reject purchase order');
    } finally {
      setActionLoading(null);
    }
  }, [po, onReload, onUpdated]);

  // Legacy handler that opens modal
  const handleReject = useCallback(() => {
    setShowRejectModal(true);
  }, []);

  const closeRejectModal = useCallback(() => {
    setShowRejectModal(false);
  }, []);

  return {
    actionLoading,
    error,
    showRejectModal,
    handleStatusChange,
    handleSubmitForApproval,
    handleApprove,
    handleReject,
    handleRejectWithReason,
    closeRejectModal
  };
};

// ============= PO Detail Modal Component =============
// Main modal for viewing purchase order details

import React, { useState } from 'react';
import { usePOData, usePOActions } from '../hooks';
import { PODetailHeader } from './PODetailHeader';
import { PODetailTabs } from './PODetailTabs';
import { LoadingState, ErrorState } from './POModalStates';
import { PORejectModal } from './PORejectModal';
import {
  DetailsTab,
  ItemsTab,
  DeliveryTab,
  InvoicesTab,
  HistoryTab
} from './detail-modal-tabs';
import type { PurchaseOrder } from '../../../../types/procurement/po.types';

interface PODetailModalProps {
  poId: string;
  onClose: () => void;
  onUpdated: () => void;
}

export const PODetailModal: React.FC<PODetailModalProps> = ({
  poId,
  onClose,
  onUpdated
}) => {
  const [activeTab, setActiveTab] = useState('details');

  // Data fetching
  const { po, items, loading, error, reload } = usePOData(poId);

  // Actions
  const {
    actionLoading,
    error: actionError,
    showRejectModal,
    handleStatusChange,
    handleSubmitForApproval,
    handleApprove,
    handleReject,
    handleRejectWithReason,
    closeRejectModal
  } = usePOActions({ po, onUpdated, onReload: reload });

  // Show loading state
  if (loading) {
    return <LoadingState />;
  }

  // Show error state
  if (error || actionError) {
    return (
      <ErrorState
        error={error || actionError || 'An error occurred'}
        onClose={onClose}
        onRetry={reload}
      />
    );
  }

  // Guard against null PO
  if (!po) {
    return null;
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-6xl mx-4 max-h-[90vh] overflow-hidden">
        {/* Header */}
        <PODetailHeader
          po={po as PurchaseOrder & { version?: number; approvedBy?: string; approvedAt?: string }}
          actionLoading={actionLoading}
          onApprove={handleApprove}
          onReject={handleReject}
          onStatusChange={handleStatusChange}
          onSubmitForApproval={handleSubmitForApproval}
          onClose={onClose}
        />

        {/* Tabs */}
        <PODetailTabs activeTab={activeTab} onTabChange={setActiveTab} />

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[calc(90vh-200px)]">
          {activeTab === 'details' && <DetailsTab po={po} />}
          {activeTab === 'items' && <ItemsTab items={items} currency={po.currency} />}
          {activeTab === 'delivery' && <DeliveryTab po={po} />}
          {activeTab === 'invoices' && <InvoicesTab po={po} />}
          {activeTab === 'history' && <HistoryTab po={po} />}
        </div>
      </div>

      {/* Reject Modal */}
      {showRejectModal && (
        <PORejectModal
          poNumber={po.poNumber}
          onConfirm={handleRejectWithReason}
          onCancel={closeRejectModal}
          loading={actionLoading === 'reject'}
        />
      )}
    </div>
  );
};

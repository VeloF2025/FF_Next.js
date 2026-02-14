// ============= PO Reject Modal Component =============
// Modal for rejecting a PO with reason (required)

import React, { useState } from 'react';
import { AlertCircle, X } from 'lucide-react';
import { VelocityButton } from '../../../../components/ui';

interface PORejectModalProps {
  poNumber: string;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
  loading?: boolean;
}

export const PORejectModal: React.FC<PORejectModalProps> = ({
  poNumber,
  onConfirm,
  onCancel,
  loading = false
}) => {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!reason.trim()) {
      setError('Rejection reason is required');
      return;
    }

    if (reason.trim().length < 10) {
      setError('Please provide a more detailed reason (at least 10 characters)');
      return;
    }

    setError('');
    onConfirm(reason.trim());
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60]">
      <div className="bg-card rounded-lg shadow-2xl w-full max-w-md mx-4">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b bg-red-50">
          <div className="flex items-center gap-2 text-red-800">
            <AlertCircle className="h-5 w-5" />
            <h3 className="font-semibold">Reject Purchase Order</h3>
          </div>
          <button
            onClick={onCancel}
            disabled={loading}
            className="text-muted-foreground hover:text-muted-foreground p-1"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="p-4">
          <p className="text-muted-foreground mb-4">
            You are about to reject <strong>{poNumber}</strong>. The PO will be
            returned to draft status for revision. Please provide a reason for
            rejection to help the requester understand what changes are needed.
          </p>

          <div className="mb-4">
            <label
              htmlFor="rejection-reason"
              className="block text-sm font-medium text-muted-foreground mb-1"
            >
              Rejection Reason <span className="text-red-500">*</span>
            </label>
            <textarea
              id="rejection-reason"
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                if (error) setError('');
              }}
              placeholder="Please explain why this PO is being rejected and what changes are needed..."
              rows={4}
              disabled={loading}
              className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none ${
                error ? 'border-red-500' : 'border-border'
              }`}
            />
            {error && (
              <p className="mt-1 text-sm text-red-600">{error}</p>
            )}
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">
            <p className="text-sm text-amber-800">
              <strong>Note:</strong> This will create a new version of the PO.
              The requester will be able to make changes and resubmit for approval.
            </p>
          </div>

          {/* Actions */}
          <div className="flex justify-end space-x-3">
            <VelocityButton
              type="button"
              variant="outline"
              onClick={onCancel}
              disabled={loading}
            >
              Cancel
            </VelocityButton>
            <VelocityButton
              type="submit"
              variant="solid-destructive"
              loading={loading}
              icon={<AlertCircle className="h-4 w-4" />}
            >
              Reject PO
            </VelocityButton>
          </div>
        </form>
      </div>
    </div>
  );
};

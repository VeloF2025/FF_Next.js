// ============= PO Detail Header Component =============
// Modal header with title, badges, and action buttons

import React from 'react';
import {
  X,
  CheckCircle,
  AlertCircle,
  Send,
  Edit,
  Download,
  Clock,
  FileCheck,
  History
} from 'lucide-react';
import { VelocityButton, StatusBadge } from '../../../../components/ui';
import type { PurchaseOrder, POStatus } from '../../../../types/procurement/po.types';

interface PODetailHeaderProps {
  po: PurchaseOrder & {
    version?: number;
    approvedBy?: string;
    approvedAt?: string;
  };
  actionLoading: string | null;
  onApprove: () => void;
  onReject: () => void;
  onStatusChange: (status: POStatus) => void;
  onSubmitForApproval?: () => void;
  onClose: () => void;
}

export const PODetailHeader: React.FC<PODetailHeaderProps> = ({
  po,
  actionLoading,
  onApprove,
  onReject,
  onStatusChange,
  onSubmitForApproval,
  onClose
}) => {
  // Handle both enum values (UPPERCASE) and database values (lowercase)
  const statusLower = String(po.status).toLowerCase();
  const approvalStatusLower = String(po.approvalStatus || '').toLowerCase();

  const canApprove = approvalStatusLower === 'pending' || approvalStatusLower === 'in_progress' ||
    statusLower === 'pending_approval';
  const canEdit = statusLower === 'draft';
  const canSend = statusLower === 'approved';
  const canSubmit = statusLower === 'draft' && onSubmitForApproval;
  const isPending = statusLower === 'pending_approval' || approvalStatusLower === 'pending';
  const version = po.version || 1;

  return (
    <div className="border-b">
      {/* Approval Status Banner */}
      {isPending && (
        <div className="bg-amber-50 border-b border-amber-200 px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-amber-800">
            <Clock className="h-5 w-5" />
            <span className="font-medium">Awaiting Approval</span>
            <span className="text-amber-600 text-sm">
              • Total: R{po.totalAmount?.toLocaleString() || '0'}
            </span>
          </div>
          {po.approvedBy && (
            <span className="text-sm text-amber-600">
              Previous approver: {po.approvedBy}
            </span>
          )}
        </div>
      )}

      {/* Version Banner (if v2+) */}
      {version > 1 && (
        <div className="bg-blue-50 border-b border-blue-200 px-6 py-2 flex items-center gap-2 text-blue-800">
          <History className="h-4 w-4" />
          <span className="text-sm">
            <strong>Version {version}</strong> - This PO has been revised {version - 1} time{version > 2 ? 's' : ''}
          </span>
        </div>
      )}

      <div className="flex items-center justify-between p-6">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-bold text-foreground">{po.poNumber}</h2>
            {version > 1 && (
              <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs font-medium rounded">
                v{version}
              </span>
            )}
          </div>
          <p className="text-muted-foreground">{po.title}</p>
          <div className="flex items-center space-x-3 mt-2">
            <StatusBadge status={po.status} />
            {po.approvalStatus && approvalStatusLower !== 'not_submitted' && (
              <StatusBadge status={po.approvalStatus} />
            )}
          </div>
        </div>

      <div className="flex items-center space-x-3">
        {/* Submit for Approval - for draft POs */}
        {canSubmit && (
          <VelocityButton
            size="sm"
            onClick={onSubmitForApproval}
            loading={actionLoading === 'submit'}
            icon={<FileCheck className="h-4 w-4" />}
          >
            Submit for Approval
          </VelocityButton>
        )}

        {/* Approval Actions - for pending POs */}
        {canApprove && (
          <>
            <VelocityButton
              size="sm"
              onClick={onApprove}
              loading={actionLoading === 'approve'}
              icon={<CheckCircle className="h-4 w-4" />}
            >
              Approve
            </VelocityButton>
            <VelocityButton
              variant="outline"
              size="sm"
              onClick={onReject}
              loading={actionLoading === 'reject'}
              icon={<AlertCircle className="h-4 w-4" />}
            >
              Reject
            </VelocityButton>
          </>
        )}

        {/* Send Action - for approved POs */}
        {canSend && (
          <VelocityButton
            size="sm"
            onClick={() => onStatusChange('SENT' as POStatus)}
            loading={actionLoading === 'status'}
            icon={<Send className="h-4 w-4" />}
          >
            Send to Supplier
          </VelocityButton>
        )}

        {/* Edit Action - for draft POs */}
        {canEdit && !canSubmit && (
          <VelocityButton
            variant="outline"
            size="sm"
            icon={<Edit className="h-4 w-4" />}
          >
            Edit
          </VelocityButton>
        )}

        {/* Download Action */}
        <VelocityButton
          variant="outline"
          size="sm"
          icon={<Download className="h-4 w-4" />}
        >
          Download PDF
        </VelocityButton>

        {/* Close Button */}
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-muted-foreground p-2"
        >
          <X className="h-6 w-6" />
        </button>
      </div>
      </div>
    </div>
  );
};

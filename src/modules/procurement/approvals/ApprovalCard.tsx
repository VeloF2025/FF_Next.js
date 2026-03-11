/**
 * ApprovalCard — Single approval request row for the approvals list.
 */

import { useRouter } from 'next/router';
import {
  FileText, ShoppingCart, Package, ChevronRight,
  Check, X, Loader2, Clock, CheckCircle, XCircle, AlertTriangle,
} from 'lucide-react';
import type { WorkflowType } from '@/types/procurement/approval.types';

export interface ApprovalItem {
  id: string;
  documentType: WorkflowType;
  documentId: string;
  documentNumber: string | null;
  documentAmount: number | null;
  status: string;
  requestedByName: string;
  requestedAt: string;
  requestNotes: string | null;
  assignedToName: string | null;
  respondedByName: string | null;
  respondedAt: string | null;
  responseNotes: string | null;
  isOverdue: boolean;
  workflowName: string;
  levelName: string;
  approverRole: string | null;
  approverName: string | null;
}

const typeConfig: Record<WorkflowType, { label: string; color: string; icon: typeof FileText }> = {
  purchase_requisition: { label: 'Requisition', color: 'bg-blue-500/20 text-blue-400', icon: FileText },
  purchase_order: { label: 'Purchase Order', color: 'bg-green-500/20 text-green-400', icon: ShoppingCart },
  boq: { label: 'BOQ', color: 'bg-purple-500/20 text-purple-400', icon: FileText },
  rfq: { label: 'RFQ', color: 'bg-orange-500/20 text-orange-400', icon: FileText },
  goods_receipt: { label: 'Goods Receipt', color: 'bg-teal-500/20 text-teal-400', icon: Package },
  supplier_registration: { label: 'Supplier', color: 'bg-indigo-500/20 text-indigo-400', icon: FileText },
  payment_request: { label: 'Payment', color: 'bg-emerald-500/20 text-emerald-400', icon: FileText },
};

const statusBadge: Record<string, { label: string; color: string; Icon: typeof Clock }> = {
  pending: { label: 'Pending', color: 'bg-amber-500/20 text-amber-400', Icon: Clock },
  approved: { label: 'Approved', color: 'bg-green-500/20 text-green-400', Icon: CheckCircle },
  rejected: { label: 'Rejected', color: 'bg-red-500/20 text-red-400', Icon: XCircle },
  escalated: { label: 'Escalated', color: 'bg-orange-500/20 text-orange-400', Icon: AlertTriangle },
  skipped: { label: 'Skipped', color: 'bg-gray-500/20 text-gray-400', Icon: ChevronRight },
  cancelled: { label: 'Cancelled', color: 'bg-gray-500/20 text-gray-400', Icon: X },
};

function fmtZAR(n: number) {
  return new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR', maximumFractionDigits: 0 }).format(n);
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' });
}

function getDocLink(type: WorkflowType, docId: string) {
  switch (type) {
    case 'purchase_requisition': return `/procurement/requisitions/${docId}`;
    case 'purchase_order': return `/procurement/purchase-orders/${docId}`;
    case 'goods_receipt': return `/procurement/grn/${docId}`;
    default: return '#';
  }
}

interface Props {
  item: ApprovalItem;
  onApprove?: (id: string) => void;
  onReject?: (id: string) => void;
  actioningId: string | null;
}

export function ApprovalCard({ item, onApprove, onReject, actioningId }: Props) {
  const router = useRouter();
  const tc = typeConfig[item.documentType] || { label: item.documentType, color: 'bg-gray-500/20 text-gray-400', icon: FileText };
  const sb = statusBadge[item.status] || statusBadge.pending;
  const TypeIcon = tc.icon;
  const isPending = item.status === 'pending';

  return (
    <div className="p-4 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg hover:border-[var(--ff-border-light)] transition-colors">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 flex-1">
          <div className={`p-2 rounded-lg ${tc.color.split(' ')[0]}`}>
            <TypeIcon className={`h-5 w-5 ${tc.color.split(' ')[1]}`} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <button
                onClick={() => router.push(getDocLink(item.documentType, item.documentId))}
                className="font-medium text-[var(--ff-text-primary)] hover:text-amber-400 transition-colors"
              >
                {item.documentNumber || `#${item.documentId.slice(0, 8)}`}
              </button>
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${tc.color}`}>{tc.label}</span>
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${sb.color}`}>
                <sb.Icon className="h-3 w-3" />
                {sb.label}
              </span>
              {item.isOverdue && isPending && (
                <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-500/20 text-red-400">Overdue</span>
              )}
            </div>
            <div className="text-sm text-[var(--ff-text-secondary)]">
              {item.workflowName} &middot; {item.levelName}
              {item.approverName && (
                <span className="text-[var(--ff-text-tertiary)]"> &middot; <span className="text-amber-400">{item.approverName}</span></span>
              )}
            </div>
            <div className="text-sm text-[var(--ff-text-tertiary)] mt-1">
              Requested by <span className="text-[var(--ff-text-secondary)]">{item.requestedByName}</span> on {fmtDate(item.requestedAt)}
            </div>
            {/* Assigned / Responded info */}
            {isPending && item.assignedToName && (
              <div className="text-sm text-[var(--ff-text-tertiary)] mt-0.5">
                Assigned to <span className="text-amber-400">{item.assignedToName}</span>
              </div>
            )}
            {!isPending && item.respondedByName && (
              <div className="text-sm text-[var(--ff-text-tertiary)] mt-0.5">
                {item.status === 'approved' ? 'Approved' : item.status === 'rejected' ? 'Rejected' : 'Actioned'} by{' '}
                <span className="text-[var(--ff-text-secondary)]">{item.respondedByName}</span>
                {item.respondedAt && <> on {fmtDate(item.respondedAt)}</>}
              </div>
            )}
            {item.responseNotes && (
              <div className="text-sm text-[var(--ff-text-tertiary)] mt-1 italic">&ldquo;{item.responseNotes}&rdquo;</div>
            )}
          </div>
        </div>

        {/* Right: Amount + Actions */}
        <div className="flex items-center gap-4">
          {item.documentAmount != null && (
            <div className="text-right">
              <div className="text-lg font-semibold text-[var(--ff-text-primary)]">{fmtZAR(item.documentAmount * 1.15)}</div>
              <div className="text-xs text-[var(--ff-text-tertiary)]">incl. VAT</div>
            </div>
          )}
          <div className="flex items-center gap-2">
            {isPending && onApprove && (
              <button
                onClick={() => onApprove(item.id)}
                disabled={actioningId === item.id}
                className="inline-flex items-center gap-1 px-3 py-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50 text-sm"
              >
                {actioningId === item.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Approve
              </button>
            )}
            {isPending && onReject && (
              <button
                onClick={() => onReject(item.id)}
                disabled={actioningId === item.id}
                className="inline-flex items-center gap-1 px-3 py-1.5 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 text-sm"
              >
                <X className="h-4 w-4" />
                Reject
              </button>
            )}
            <button
              onClick={() => router.push(getDocLink(item.documentType, item.documentId))}
              className="p-1.5 text-[var(--ff-text-tertiary)] hover:text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-hover)] rounded transition-colors"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

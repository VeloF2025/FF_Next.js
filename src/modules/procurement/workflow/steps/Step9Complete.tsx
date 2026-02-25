/**
 * Step9Complete — Procurement Journey Summary
 * Shows full journey checklist, all document references, and action buttons.
 */

import React from 'react';
import { useRouter } from 'next/router';
import {
  CheckCircle,
  FileText,
  Package,
  Truck,
  CreditCard,
  ShieldCheck,
  ExternalLink,
  RotateCcw,
  LayoutDashboard,
} from 'lucide-react';
import type { WorkflowState } from '../useWorkflowState';

// 🟢 WORKING: full type coverage
interface Step9CompleteProps {
  state: WorkflowState;
  onReset: () => void;
}

const formatCurrency = (value: number | undefined): string => {
  if (value === undefined) return '-';
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
    minimumFractionDigits: 0,
  }).format(value);
};

const STEP_LABELS: [number, string, React.FC<{ style?: React.CSSProperties }>][] = [
  [1, 'Create Requisition', FileText],
  [2, 'Add Line Items', FileText],
  [3, 'Set Strategy', Package],
  [4, 'Requisition Approval', ShieldCheck],
  [5, 'Create Order', Package],
  [6, 'Receive Goods', Truck],
  [7, 'Submit Invoice', CreditCard],
  [8, 'Payment Approval', ShieldCheck],
  [9, 'Complete', CheckCircle],
];

export const Step9Complete: React.FC<Step9CompleteProps> = ({ state, onReset }) => {
  const router = useRouter();

  const totalAmount = state.invoiceAmount ?? state.estimatedTotal;
  const isRfq = state.strategy === 'rfq';
  const paymentApproved = state.paymentApprovalStatus === 'approved';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
      {/* Congratulations header */}
      <div style={{ textAlign: 'center', padding: '24px 0 8px' }}>
        <CheckCircle style={{ width: 56, height: 56, color: '#16a34a', margin: '0 auto 14px' }} />
        <h2 style={{ fontWeight: 800, fontSize: 22, color: 'var(--ff-text-primary)', margin: '0 0 6px' }}>
          Procurement Complete
        </h2>
        <p style={{ fontSize: 15, color: 'var(--ff-text-secondary)', margin: 0 }}>
          Your procurement journey has been successfully completed.
        </p>
      </div>

      {/* Summary badges */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'center' }}>
        <Badge label={isRfq ? 'Strategy: RFQ' : 'Strategy: Direct PO'} color={isRfq ? '#d97706' : '#2563eb'} />
        {totalAmount !== undefined && (
          <Badge label={`Total: ${formatCurrency(totalAmount)}`} color="#059669" />
        )}
        <Badge
          label={paymentApproved ? 'Payment: Approved' : 'Payment: Pending'}
          color={paymentApproved ? '#16a34a' : '#d97706'}
        />
      </div>

      {/* Document references */}
      <div>
        <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--ff-text-primary)', marginBottom: 12 }}>
          Document References
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {state.requisitionId && (
            <DocLink
              icon={FileText}
              label="Requisition"
              ref={state.requisitionNumber}
              href={`/procurement/requisitions/${state.requisitionId}`}
              onClick={() => void router.push(`/procurement/requisitions/${state.requisitionId}`)}
            />
          )}
          {state.rfqId && (
            <DocLink
              icon={Package}
              label="RFQ"
              ref={state.rfqNumber}
              href={`/procurement/rfq/${state.rfqId}`}
              onClick={() => void router.push(`/procurement/rfq/${state.rfqId}`)}
            />
          )}
          {state.poId && (
            <DocLink
              icon={Package}
              label="Purchase Order"
              ref={state.poNumber}
              href={`/procurement/purchase-orders/${state.poId}`}
              onClick={() => void router.push(`/procurement/purchase-orders/${state.poId}`)}
            />
          )}
          {state.grnId && (
            <DocLink
              icon={Truck}
              label="Goods Receipt"
              href={`/procurement/grn/${state.grnId}`}
              onClick={() => void router.push(`/procurement/grn/${state.grnId}`)}
            />
          )}
          {state.paymentApprovalRequestId && (
            <DocLink
              icon={ShieldCheck}
              label="Payment Request"
              href="/procurement/approvals"
              onClick={() => void router.push('/procurement/approvals')}
            />
          )}
        </div>
      </div>

      {/* Journey timeline */}
      <div>
        <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--ff-text-primary)', marginBottom: 12 }}>
          Journey Timeline
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          {STEP_LABELS.map(([num, label, Icon], i) => {
            const isLast = i === STEP_LABELS.length - 1;
            return (
              <div key={num} style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                {/* Connector column */}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 28, flexShrink: 0 }}>
                  <div style={{ width: 24, height: 24, borderRadius: '50%', background: 'rgba(22,163,74,0.15)', border: '2px solid #16a34a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Icon style={{ width: 12, height: 12, color: '#16a34a' }} />
                  </div>
                  {!isLast && (
                    <div style={{ width: 2, flexGrow: 1, minHeight: 20, background: 'rgba(22,163,74,0.2)', margin: '2px 0' }} />
                  )}
                </div>
                <div style={{ paddingBottom: isLast ? 0 : 12, paddingTop: 3 }}>
                  <span style={{ fontSize: 13, color: 'var(--ff-text-primary)', fontWeight: 500 }}>
                    Step {num}: {label}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center', paddingTop: 8 }}>
        <button
          onClick={onReset}
          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 20px', border: '1px solid var(--ff-border-light)', borderRadius: 10, cursor: 'pointer', background: 'transparent', color: 'var(--ff-text-primary)', fontSize: 14, fontWeight: 600 }}
        >
          <RotateCcw style={{ width: 16, height: 16 }} />
          Start New Procurement
        </button>
        <button
          onClick={() => void router.push('/procurement')}
          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 20px', background: '#059669', border: 'none', borderRadius: 10, cursor: 'pointer', color: '#fff', fontSize: 14, fontWeight: 600 }}
        >
          <LayoutDashboard style={{ width: 16, height: 16 }} />
          View All Procurement
        </button>
      </div>
    </div>
  );
};

// ---- Internal components ----

const Badge: React.FC<{ label: string; color: string }> = ({ label, color }) => (
  <span style={{ display: 'inline-flex', alignItems: 'center', padding: '4px 14px', borderRadius: 20, fontSize: 13, fontWeight: 600, background: `${color}18`, border: `1px solid ${color}40`, color }}>
    {label}
  </span>
);

interface DocLinkProps {
  icon: React.FC<{ style?: React.CSSProperties }>;
  label: string;
  ref?: string;
  href: string;
  onClick: () => void;
}

const DocLink: React.FC<DocLinkProps> = ({ icon: Icon, label, ref: refNumber, onClick }) => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', border: '1px solid var(--ff-border-light)', borderRadius: 8, background: 'var(--ff-bg-primary)' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <Icon style={{ width: 16, height: 16, color: 'var(--ff-text-secondary)' }} />
      <span style={{ fontSize: 14, color: 'var(--ff-text-primary)', fontWeight: 500 }}>
        {label}
        {refNumber && <span style={{ color: 'var(--ff-text-secondary)', fontWeight: 400, marginLeft: 6 }}>{refNumber}</span>}
      </span>
    </div>
    <button
      onClick={onClick}
      style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: '#2563eb', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
    >
      <ExternalLink style={{ width: 12, height: 12 }} /> View
    </button>
  </div>
);

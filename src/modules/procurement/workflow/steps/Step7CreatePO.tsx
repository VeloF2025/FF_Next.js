/**
 * Step7CreatePO — Create Purchase Order from awarded quote.
 * Both RFQ and Direct PO paths converge here to create the PO.
 */

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import {
  ShoppingCart, CheckCircle, ExternalLink, ArrowLeft, ArrowRight, Loader2, AlertCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { log } from '@/lib/logger';
import type { WorkflowState } from '../useWorkflowState';
import { ProcurementDocumentPanel } from '@/modules/procurement/documents/components/ProcurementDocumentPanel';
import { calcVat } from './requisitionUtils';

interface Step7Props {
  state: WorkflowState;
  onComplete: (update: Partial<WorkflowState>) => void;
  onBack: () => void;
}

type Phase = 'form' | 'submitting' | 'done';

const formatCurrency = (value: number | undefined): string => {
  if (value === undefined) return '-';
  return new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR', minimumFractionDigits: 0 }).format(value);
};

export const Step7CreatePO: React.FC<Step7Props> = ({ state, onComplete, onBack }) => {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>(state.poId ? 'done' : 'form');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [createdPoId, setCreatedPoId] = useState<string | undefined>(state.poId);
  const [createdPoNumber, setCreatedPoNumber] = useState<string | undefined>(state.poNumber);

  useEffect(() => {
    if (state.poId) {
      setCreatedPoId(state.poId);
      setCreatedPoNumber(state.poNumber);
      setPhase('done');
    }
  }, [state.poId, state.poNumber]);

  const handleCreatePO = async () => {
    if (deliveryAddress.length < 10) return;
    setPhase('submitting');
    setSubmitError(null);
    try {
      const res = await fetch(
        `/api/procurement/requisitions/${state.requisitionId}/convert-to-po`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            supplierId: state.selectedSupplierId,
            deliveryAddress,
            quotedAmount: state.awardedQuoteAmount,
          }),
        }
      );
      const json = await res.json() as {
        success: boolean;
        data?: { purchaseOrder?: { id: string; poNumber: string }; id?: string; poNumber?: string };
        message?: string;
      };
      if (!json.success || !json.data) throw new Error(json.message ?? 'Failed to create PO');
      const id = json.data.purchaseOrder?.id ?? json.data.id ?? '';
      const poNumber = json.data.purchaseOrder?.poNumber ?? json.data.poNumber ?? '';
      setCreatedPoId(id);
      setCreatedPoNumber(poNumber);
      setPhase('done');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to create Purchase Order';
      log.error('PO creation failed', { error: { error: err } }, 'Step7CreatePO');
      setSubmitError(msg);
      setPhase('form');
    }
  };

  const handleNext = () => {
    onComplete({ poId: createdPoId, poNumber: createdPoNumber });
  };

  if (phase === 'done') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        <div style={{ background: 'rgba(22,163,74,0.08)', border: '1px solid rgba(22,163,74,0.3)', borderRadius: 12, padding: 24, textAlign: 'center' }}>
          <CheckCircle style={{ width: 40, height: 40, color: '#16a34a', margin: '0 auto 12px' }} />
          <p style={{ fontWeight: 600, fontSize: 16, color: 'var(--ff-text-primary)', marginBottom: 4 }}>Purchase Order Created</p>
          <p style={{ color: 'var(--ff-text-secondary)', marginBottom: 16 }}>{createdPoNumber}</p>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => router.push(`/procurement/purchase-orders/${createdPoId}`)}
          >
            <ExternalLink style={{ width: 14, height: 14 }} /> View Purchase Order
          </Button>
        </div>

        {createdPoId && (
          <ProcurementDocumentPanel
            entityType="purchase_order"
            entityId={createdPoId}
            allowedTypes={[
              { value: 'purchase_order', label: 'Purchase Order' },
              { value: 'quote_pdf', label: 'Supplier Quote' },
              { value: 'contract', label: 'Contract' },
              { value: 'other', label: 'Other' },
            ]}
          />
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button variant="primary" onClick={handleNext} style={{ background: '#16a34a' }}>
            Next: Track Delivery <ArrowRight style={{ width: 16, height: 16 }} />
          </Button>
        </div>
      </div>
    );
  }

  const canSubmit = deliveryAddress.length >= 10 && phase !== 'submitting';
  const quoteAmt = state.awardedQuoteAmount || 0;
  const vatAmt = calcVat(quoteAmt);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 12px', background: 'rgba(37,99,235,0.08)', border: '1px solid #2563eb', borderRadius: 20, fontSize: 13, color: '#2563eb', fontWeight: 600, alignSelf: 'flex-start' }}>
        <ShoppingCart style={{ width: 14, height: 14 }} /> Create Purchase Order
      </div>

      {/* Summary card */}
      <div style={{ background: 'var(--ff-bg-secondary)', borderRadius: 8, padding: '16px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <p style={{ fontSize: 12, color: 'var(--ff-text-tertiary)', marginBottom: 2 }}>Supplier</p>
          <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--ff-text-primary)' }}>{state.selectedSupplierName || 'Not selected'}</p>
        </div>
        <div>
          <p style={{ fontSize: 12, color: 'var(--ff-text-tertiary)', marginBottom: 2 }}>Requisition</p>
          <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--ff-text-primary)' }}>{state.requisitionNumber}</p>
        </div>
        <div>
          <p style={{ fontSize: 12, color: 'var(--ff-text-tertiary)', marginBottom: 2 }}>Quoted Amount (excl. VAT)</p>
          <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--ff-text-primary)' }}>{formatCurrency(quoteAmt)}</p>
        </div>
        <div>
          <p style={{ fontSize: 12, color: 'var(--ff-text-tertiary)', marginBottom: 2 }}>Total (incl. VAT)</p>
          <p style={{ fontSize: 16, fontWeight: 700, color: '#16a34a' }}>{formatCurrency(quoteAmt + vatAmt)}</p>
        </div>
      </div>

      {submitError && (
        <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: '10px 14px', display: 'flex', gap: 8, alignItems: 'center' }}>
          <AlertCircle style={{ width: 16, height: 16, color: '#ef4444', flexShrink: 0 }} />
          <span style={{ fontSize: 14, color: '#ef4444' }}>{submitError}</span>
        </div>
      )}

      <div>
        <label style={{ fontSize: 14, fontWeight: 600, color: 'var(--ff-text-primary)', display: 'block', marginBottom: 8 }}>
          Delivery Address <span style={{ color: '#ef4444' }}>*</span>
        </label>
        <textarea
          value={deliveryAddress}
          onChange={(e) => setDeliveryAddress(e.target.value)}
          placeholder="e.g. Site Office, 12 Industrial Rd, Tembisa, 1628"
          rows={3}
          style={{ width: '100%', padding: '10px 12px', border: `1px solid ${deliveryAddress.length > 0 && deliveryAddress.length < 10 ? '#ef4444' : 'var(--ff-border-light)'}`, borderRadius: 8, background: 'var(--ff-bg-primary)', color: 'var(--ff-text-primary)', fontSize: 14, outline: 'none', boxSizing: 'border-box', resize: 'vertical', fontFamily: 'inherit' }}
        />
        {deliveryAddress.length > 0 && deliveryAddress.length < 10 && (
          <p style={{ fontSize: 12, color: '#ef4444', marginTop: 4 }}>Address must be at least 10 characters</p>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Button variant="secondary" onClick={onBack}>
          <ArrowLeft style={{ width: 16, height: 16 }} /> Back
        </Button>
        <Button
          onClick={() => void handleCreatePO()}
          disabled={!canSubmit}
          style={{ background: canSubmit ? '#2563eb' : undefined }}
        >
          {phase === 'submitting' ? (
            <><Loader2 style={{ width: 16, height: 16, animation: 'spin 1s linear infinite' }} /> Creating…</>
          ) : (
            <><ShoppingCart style={{ width: 16, height: 16 }} /> Create Purchase Order</>
          )}
        </Button>
      </div>
    </div>
  );
};

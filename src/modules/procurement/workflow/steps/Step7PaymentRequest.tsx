/**
 * Step7PaymentRequest — Create a payment approval request
 * Routes to Finance approval queue after submission.
 */

import React, { useState } from 'react';
import {
  CreditCard,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Info,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { log } from '@/lib/logger';
import type { WorkflowState } from '../useWorkflowState';
import { ProcurementDocumentPanel } from '@/modules/procurement/documents/components/ProcurementDocumentPanel';
import { calcVat } from './requisitionUtils';

// 🟢 WORKING: full type coverage
interface Step7PaymentRequestProps {
  state: WorkflowState;
  onComplete: (update: Partial<WorkflowState>) => void;
  onBack: () => void;
}

interface PaymentForm {
  invoiceNumber: string;
  invoiceAmount: string;
  invoiceDate: string;
  dueDate: string;
  notes: string;
}

const EMPTY_FORM: PaymentForm = {
  invoiceNumber: '',
  invoiceAmount: '',
  invoiceDate: '',
  dueDate: '',
  notes: '',
};

const AMOUNT_VARIANCE_THRESHOLD = 0.1;

const formatCurrency = (value: number | undefined): string => {
  if (value === undefined) return '-';
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
    minimumFractionDigits: 0,
  }).format(value);
};

export const Step7PaymentRequest: React.FC<Step7PaymentRequestProps> = ({ state, onComplete, onBack }) => {
  const [form, setForm] = useState<PaymentForm>(EMPTY_FORM);
  const [errors, setErrors] = useState<Partial<PaymentForm>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const patch = (field: keyof PaymentForm) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    setForm((prev) => ({ ...prev, [field]: e.target.value }));
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const validate = (): boolean => {
    const next: Partial<PaymentForm> = {};
    if (!form.invoiceNumber.trim()) next.invoiceNumber = 'Invoice number is required';
    if (!form.invoiceAmount || Number(form.invoiceAmount) <= 0) next.invoiceAmount = 'Valid invoice amount is required';
    if (!form.dueDate) next.dueDate = 'Due date is required';
    if (!state.poId && !state.rfqId) next.notes = 'No PO or RFQ reference found — cannot submit';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const invoiceAmountNum = form.invoiceAmount ? Number(form.invoiceAmount) : undefined;
  const estimateExclVat = state.estimatedTotal;
  const estimateInclVat = estimateExclVat !== undefined ? estimateExclVat + calcVat(estimateExclVat) : undefined;
  const hasVarianceWarning =
    invoiceAmountNum !== undefined &&
    estimateInclVat !== undefined &&
    Math.abs(invoiceAmountNum - estimateInclVat) / estimateInclVat > AMOUNT_VARIANCE_THRESHOLD;

  const handleSubmit = async () => {
    if (!validate()) return;
    setSubmitting(true);
    setSubmitError(null);

    const invoiceAmount = Number(form.invoiceAmount);

    try {
      const res = await fetch('/api/procurement/payment-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          poId: state.poId,
          rfqId: state.rfqId,
          invoiceNumber: form.invoiceNumber.trim(),
          invoiceAmount,
          invoiceDate: form.invoiceDate || undefined,
          dueDate: form.dueDate,
          notes: form.notes.trim() || undefined,
        }),
      });

      const json = await res.json() as { success: boolean; data?: { id: string; status: string }; message?: string };
      if (!json.success || !json.data) throw new Error(json.message ?? 'Failed to create payment request');

      onComplete({
        paymentApprovalRequestId: json.data.id,
        invoiceAmount,
        invoiceDueDate: form.dueDate,
        paymentApprovalStatus: json.data.status === 'auto_approved' ? 'approved' : 'pending',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to submit payment request';
      log.error('Step7PaymentRequest: submission failed', { err }, 'procurement');
      setSubmitError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <CreditCard style={{ width: 22, height: 22, color: '#059669' }} />
        <div>
          <p style={{ fontWeight: 700, fontSize: 16, color: 'var(--ff-text-primary)', margin: 0 }}>Payment Request</p>
          <p style={{ fontSize: 13, color: 'var(--ff-text-secondary)', margin: 0 }}>Create invoice and route for Finance approval</p>
        </div>
      </div>

      {/* Reference context */}
      <ContextCard state={state} />

      {/* Finance routing note */}
      <div style={{ display: 'flex', gap: 8, background: 'rgba(5,150,105,0.07)', border: '1px solid rgba(5,150,105,0.2)', borderRadius: 8, padding: '10px 14px' }}>
        <Info style={{ width: 16, height: 16, color: '#059669', flexShrink: 0, marginTop: 1 }} />
        <p style={{ fontSize: 13, color: 'var(--ff-text-primary)', margin: 0 }}>
          Payment Request will be routed for <strong>Finance approval</strong> after submission.
        </p>
      </div>

      {/* Error banner */}
      {submitError && (
        <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: '10px 14px', display: 'flex', gap: 8 }}>
          <AlertCircle style={{ width: 16, height: 16, color: '#ef4444', flexShrink: 0 }} />
          <span style={{ fontSize: 14, color: '#ef4444' }}>{submitError}</span>
        </div>
      )}

      {/* Form */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <FieldRow>
          <FormField label="Invoice Number" required error={errors.invoiceNumber}>
            <input
              type="text"
              value={form.invoiceNumber}
              onChange={patch('invoiceNumber')}
              placeholder="e.g. INV-2026-001"
              style={inputStyle(Boolean(errors.invoiceNumber))}
            />
          </FormField>
          <FormField label="Invoice Amount (ZAR)" required error={errors.invoiceAmount}>
            <div style={{ position: 'relative' }}>
              <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--ff-text-secondary)', fontSize: 14, pointerEvents: 'none' }}>R</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.invoiceAmount}
                onChange={patch('invoiceAmount')}
                placeholder="0"
                style={{ ...inputStyle(Boolean(errors.invoiceAmount)), paddingLeft: 28 }}
              />
            </div>
          </FormField>
        </FieldRow>

        {/* Variance warning */}
        {hasVarianceWarning && (
          <div style={{ display: 'flex', gap: 8, background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 8, padding: '10px 14px' }}>
            <AlertTriangle style={{ width: 16, height: 16, color: '#d97706', flexShrink: 0, marginTop: 1 }} />
            <p style={{ fontSize: 13, color: 'var(--ff-text-primary)', margin: 0 }}>
              Invoice amount differs by more than 10% from estimate ({formatCurrency(estimateInclVat)} incl. VAT). Finance may require additional justification.
            </p>
          </div>
        )}

        {/* Estimate vs actual */}
        {invoiceAmountNum !== undefined && estimateInclVat !== undefined && !hasVarianceWarning && (
          <p style={{ fontSize: 13, color: 'var(--ff-text-secondary)' }}>
            Estimated: {formatCurrency(estimateInclVat)} (incl. VAT) &mdash; Invoice: {formatCurrency(invoiceAmountNum)}
          </p>
        )}

        <FieldRow>
          <FormField label="Invoice Date">
            <input type="date" value={form.invoiceDate} onChange={patch('invoiceDate')} style={inputStyle(false)} />
          </FormField>
          <FormField label="Due Date" required error={errors.dueDate}>
            <input type="date" value={form.dueDate} onChange={patch('dueDate')} style={inputStyle(Boolean(errors.dueDate))} />
          </FormField>
        </FieldRow>

        <FormField label="Payment Notes">
          <textarea
            value={form.notes}
            onChange={patch('notes')}
            rows={3}
            placeholder="Optional notes for Finance team…"
            style={{ ...inputStyle(false), resize: 'vertical', minHeight: 72 }}
          />
        </FormField>
      </div>

      {/* Inline document upload — Supplier Invoice */}
      {state.poId && (
        <ProcurementDocumentPanel
          entityType="purchase_order"
          entityId={state.poId}
          allowedTypes={[
            { value: 'invoice', label: 'Supplier Invoice' },
            { value: 'receipt', label: 'Receipt' },
            { value: 'other', label: 'Other' },
          ]}
        />
      )}

      {/* Navigation */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Button variant="secondary" onClick={onBack}>
          <ArrowLeft style={{ width: 16, height: 16 }} /> Back
        </Button>
        <Button
          onClick={() => void handleSubmit()}
          disabled={submitting}
          style={{ background: submitting ? undefined : '#059669' }}
        >
          {submitting ? (
            <><Loader2 style={{ width: 16, height: 16, animation: 'spin 1s linear infinite' }} /> Submitting…</>
          ) : (
            <>Submit Payment Request <ArrowRight style={{ width: 16, height: 16 }} /></>
          )}
        </Button>
      </div>
    </div>
  );
};

// ---- Internal helpers ----

const ContextCard: React.FC<{ state: WorkflowState }> = ({ state }) => (
  <div style={{ background: 'var(--ff-bg-secondary)', borderRadius: 8, padding: '12px 16px', display: 'flex', flexWrap: 'wrap', gap: '6px 24px' }}>
    {state.requisitionNumber && (
      <span style={{ fontSize: 13, color: 'var(--ff-text-secondary)' }}>
        Requisition: <strong style={{ color: 'var(--ff-text-primary)' }}>{state.requisitionNumber}</strong>
      </span>
    )}
    {state.rfqNumber && (
      <span style={{ fontSize: 13, color: 'var(--ff-text-secondary)' }}>
        RFQ: <strong style={{ color: 'var(--ff-text-primary)' }}>{state.rfqNumber}</strong>
      </span>
    )}
    {state.poNumber && (
      <span style={{ fontSize: 13, color: 'var(--ff-text-secondary)' }}>
        PO: <strong style={{ color: 'var(--ff-text-primary)' }}>{state.poNumber}</strong>
      </span>
    )}
  </div>
);

const FieldRow: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>{children}</div>
);

const FormField: React.FC<{ label: string; required?: boolean; error?: string; children: React.ReactNode }> = ({ label, required, error, children }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
    <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--ff-text-primary)' }}>
      {label} {required && <span style={{ color: '#ef4444' }}>*</span>}
    </label>
    {children}
    {error && <span style={{ fontSize: 12, color: '#ef4444' }}>{error}</span>}
  </div>
);

const inputStyle = (hasError: boolean): React.CSSProperties => ({
  width: '100%',
  padding: '9px 12px',
  border: `1px solid ${hasError ? '#ef4444' : 'var(--ff-border-light)'}`,
  borderRadius: 8,
  background: 'var(--ff-bg-primary)',
  color: 'var(--ff-text-primary)',
  fontSize: 14,
  outline: 'none',
  boxSizing: 'border-box',
});



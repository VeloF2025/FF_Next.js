/**
 * Step6QuoteAward — Upload supplier quotes, evaluate, and award.
 * RFQ path: receive quotes from multiple suppliers, compare, pick winner.
 * Direct PO path: upload the single supplier's quote and confirm amount.
 */

import React, { useState, useEffect } from 'react';
import {
  FileText, CheckCircle, ArrowLeft, ArrowRight, Loader2, Award, Upload,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { log } from '@/lib/logger';
import type { WorkflowState } from '../useWorkflowState';
import { ProcurementDocumentPanel } from '@/modules/procurement/documents/components/ProcurementDocumentPanel';

interface Step6Props {
  state: WorkflowState;
  onComplete: (update: Partial<WorkflowState>) => void;
  onBack: () => void;
}

interface QuoteEntry {
  supplierId: string;
  supplierName: string;
  amount: string;
  deliveryDays: string;
  notes: string;
}

const formatCurrency = (value: number | undefined): string => {
  if (value === undefined) return '-';
  return new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR', minimumFractionDigits: 0 }).format(value);
};

export const Step6QuoteAward: React.FC<Step6Props> = ({ state, onComplete, onBack }) => {
  const isRfq = state.strategy === 'rfq';
  const [awarded, setAwarded] = useState(!!state.awardedQuoteAmount);

  // Direct PO path state
  const [directAmount, setDirectAmount] = useState<string>(state.awardedQuoteAmount?.toString() || '');

  // RFQ path state — quote entries per supplier
  const [quotes, setQuotes] = useState<QuoteEntry[]>([]);
  const [selectedWinner, setSelectedWinner] = useState<string>(state.selectedSupplierId || '');
  const [loadingSuppliers, setLoadingSuppliers] = useState(isRfq);

  // Load RFQ suppliers
  useEffect(() => {
    if (!isRfq || !state.rfqId) return;
    setLoadingSuppliers(true);
    fetch(`/api/procurement/rfq-suppliers?rfqId=${state.rfqId}`)
      .then((r) => r.json())
      .then((json: { success: boolean; data?: Array<{ supplier_id: string; supplier_name: string }> }) => {
        if (json.success && json.data) {
          setQuotes(json.data.map((s) => ({
            supplierId: s.supplier_id,
            supplierName: s.supplier_name || `Supplier ${s.supplier_id}`,
            amount: '', deliveryDays: '', notes: '',
          })));
        }
      })
      .catch((err) => {
        log.error('Step6QuoteAward', 'Failed to load RFQ suppliers', { error: err });
      })
      .finally(() => setLoadingSuppliers(false));
  }, [isRfq, state.rfqId]);

  const updateQuote = (idx: number, field: keyof QuoteEntry, value: string) => {
    setQuotes((prev) => prev.map((q, i) => i === idx ? { ...q, [field]: value } : q));
  };

  const handleAwardRfq = () => {
    const winner = quotes.find((q) => q.supplierId === selectedWinner);
    if (!winner || !winner.amount) return;
    setAwarded(true);
    // Don't advance yet — user clicks Next
  };

  const handleConfirmDirect = () => {
    const amt = parseFloat(directAmount);
    if (isNaN(amt) || amt <= 0) return;
    setAwarded(true);
  };

  const handleNext = () => {
    if (isRfq) {
      const winner = quotes.find((q) => q.supplierId === selectedWinner);
      onComplete({
        selectedSupplierId: selectedWinner,
        selectedSupplierName: winner?.supplierName,
        awardedQuoteAmount: parseFloat(winner?.amount || '0'),
      });
    } else {
      onComplete({
        awardedQuoteAmount: parseFloat(directAmount),
      });
    }
  };

  if (loadingSuppliers) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '48px' }}>
        <Loader2 style={{ width: 24, height: 24, animation: 'spin 1s linear infinite', color: 'var(--ff-text-secondary)' }} />
        <span style={{ marginLeft: 8, color: 'var(--ff-text-secondary)' }}>Loading supplier quotes…</span>
      </div>
    );
  }

  if (awarded) {
    const winnerName = isRfq
      ? quotes.find((q) => q.supplierId === selectedWinner)?.supplierName || 'Selected'
      : state.selectedSupplierName || 'Selected';
    const awardAmt = isRfq
      ? parseFloat(quotes.find((q) => q.supplierId === selectedWinner)?.amount || '0')
      : parseFloat(directAmount);

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        <div style={{ background: 'rgba(22,163,74,0.08)', border: '1px solid rgba(22,163,74,0.3)', borderRadius: 12, padding: 24, textAlign: 'center' }}>
          <Award style={{ width: 40, height: 40, color: '#16a34a', margin: '0 auto 12px' }} />
          <p style={{ fontWeight: 600, fontSize: 16, color: 'var(--ff-text-primary)', marginBottom: 4 }}>
            {isRfq ? 'Supplier Awarded' : 'Quote Confirmed'}
          </p>
          <p style={{ color: 'var(--ff-text-secondary)', marginBottom: 4 }}>{winnerName}</p>
          <p style={{ fontWeight: 600, fontSize: 18, color: 'var(--ff-text-primary)' }}>{formatCurrency(awardAmt)}</p>
        </div>

        {/* Document upload */}
        <ProcurementDocumentPanel
          entityType={isRfq ? 'rfq_response' : 'purchase_order'}
          entityId={isRfq ? (state.rfqId || '') : (state.requisitionId || '')}
          allowedTypes={[
            { value: 'quote_pdf', label: 'Supplier Quote' },
            { value: 'other', label: 'Other' },
          ]}
        />

        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <Button variant="secondary" onClick={() => setAwarded(false)}>
            <ArrowLeft style={{ width: 16, height: 16 }} /> Edit
          </Button>
          <Button onClick={handleNext}>
            Next: Create PO <ArrowRight style={{ width: 16, height: 16 }} />
          </Button>
        </div>
      </div>
    );
  }

  // ---- RFQ Evaluation Form ----
  if (isRfq) {
    const canAward = selectedWinner !== '' && quotes.find((q) => q.supplierId === selectedWinner)?.amount !== '';

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 12px', background: 'rgba(217,119,6,0.08)', border: '1px solid #d97706', borderRadius: 20, fontSize: 13, color: '#d97706', fontWeight: 600, alignSelf: 'flex-start' }}>
          <FileText style={{ width: 14, height: 14 }} /> RFQ Quote Evaluation
        </div>
        <p style={{ fontSize: 14, color: 'var(--ff-text-secondary)' }}>
          Enter received quotes from each supplier, then select the winning bid.
        </p>

        {/* Document upload for quote PDFs */}
        <ProcurementDocumentPanel
          entityType="rfq_response"
          entityId={state.rfqId || ''}
          allowedTypes={[{ value: 'quote_pdf', label: 'Supplier Quote PDF' }, { value: 'other', label: 'Other' }]}
        />

        {/* Quote entry table */}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ background: 'var(--ff-bg-secondary)' }}>
                <th style={{ padding: '10px 12px', textAlign: 'left', borderBottom: '2px solid var(--ff-border-light)' }}>Supplier</th>
                <th style={{ padding: '10px 12px', textAlign: 'right', borderBottom: '2px solid var(--ff-border-light)' }}>Quote Amount (R)</th>
                <th style={{ padding: '10px 12px', textAlign: 'center', borderBottom: '2px solid var(--ff-border-light)' }}>Delivery (days)</th>
                <th style={{ padding: '10px 12px', textAlign: 'left', borderBottom: '2px solid var(--ff-border-light)' }}>Notes</th>
                <th style={{ padding: '10px 12px', textAlign: 'center', borderBottom: '2px solid var(--ff-border-light)' }}>Award</th>
              </tr>
            </thead>
            <tbody>
              {quotes.map((q, idx) => (
                <tr key={q.supplierId} style={{ borderBottom: '1px solid var(--ff-border-light)' }}>
                  <td style={{ padding: '10px 12px', fontWeight: 500, color: 'var(--ff-text-primary)' }}>{q.supplierName}</td>
                  <td style={{ padding: '10px 12px' }}>
                    <input type="number" value={q.amount} onChange={(e) => updateQuote(idx, 'amount', e.target.value)} placeholder="0.00" style={{ width: 120, padding: '6px 8px', border: '1px solid var(--ff-border-light)', borderRadius: 6, background: 'var(--ff-bg-primary)', color: 'var(--ff-text-primary)', textAlign: 'right', fontSize: 14 }} />
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                    <input type="number" value={q.deliveryDays} onChange={(e) => updateQuote(idx, 'deliveryDays', e.target.value)} placeholder="0" style={{ width: 60, padding: '6px 8px', border: '1px solid var(--ff-border-light)', borderRadius: 6, background: 'var(--ff-bg-primary)', color: 'var(--ff-text-primary)', textAlign: 'center', fontSize: 14 }} />
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    <input type="text" value={q.notes} onChange={(e) => updateQuote(idx, 'notes', e.target.value)} placeholder="Optional" style={{ width: '100%', padding: '6px 8px', border: '1px solid var(--ff-border-light)', borderRadius: 6, background: 'var(--ff-bg-primary)', color: 'var(--ff-text-primary)', fontSize: 14 }} />
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                    <input type="radio" name="awardSupplier" checked={selectedWinner === q.supplierId} onChange={() => setSelectedWinner(q.supplierId)} disabled={!q.amount} style={{ width: 18, height: 18, accentColor: '#16a34a' }} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Button variant="secondary" onClick={onBack}>
            <ArrowLeft style={{ width: 16, height: 16 }} /> Back
          </Button>
          <Button onClick={handleAwardRfq} disabled={!canAward}>
            <Award style={{ width: 16, height: 16 }} /> Award Supplier
          </Button>
        </div>
      </div>
    );
  }

  // ---- Direct PO: Upload Quote ----
  const directValid = parseFloat(directAmount) > 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 12px', background: 'rgba(37,99,235,0.08)', border: '1px solid #2563eb', borderRadius: 20, fontSize: 13, color: '#2563eb', fontWeight: 600, alignSelf: 'flex-start' }}>
        <Upload style={{ width: 14, height: 14 }} /> Upload Supplier Quote
      </div>

      <div style={{ background: 'var(--ff-bg-secondary)', borderRadius: 8, padding: '12px 16px' }}>
        <p style={{ fontSize: 13, color: 'var(--ff-text-secondary)' }}>
          Supplier: <strong style={{ color: 'var(--ff-text-primary)' }}>{state.selectedSupplierName}</strong>
        </p>
      </div>

      <ProcurementDocumentPanel
        entityType="purchase_order"
        entityId={state.requisitionId || ''}
        allowedTypes={[{ value: 'quote_pdf', label: 'Supplier Quote' }, { value: 'other', label: 'Other' }]}
      />

      <div>
        <label style={{ fontSize: 14, fontWeight: 600, color: 'var(--ff-text-primary)', display: 'block', marginBottom: 8 }}>
          Quoted Amount (excl. VAT) <span style={{ color: '#ef4444' }}>*</span>
        </label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 16, color: 'var(--ff-text-secondary)' }}>R</span>
          <input type="number" value={directAmount} onChange={(e) => setDirectAmount(e.target.value)} placeholder="0.00" style={{ flex: 1, padding: '10px 12px', border: '1px solid var(--ff-border-light)', borderRadius: 8, background: 'var(--ff-bg-primary)', color: 'var(--ff-text-primary)', fontSize: 16, outline: 'none' }} />
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Button variant="secondary" onClick={onBack}>
          <ArrowLeft style={{ width: 16, height: 16 }} /> Back
        </Button>
        <Button onClick={handleConfirmDirect} disabled={!directValid}>
          <CheckCircle style={{ width: 16, height: 16 }} /> Confirm Quote
        </Button>
      </div>
    </div>
  );
};

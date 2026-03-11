/**
 * Step5Order — Sourcing: Send RFQ or Select Supplier
 * RFQ path: select suppliers and send RFQ emails.
 * Direct PO path: select a single preferred supplier.
 * PO creation happens later at Step 7 after quote is submitted.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Package,
  FileText,
  CheckCircle,
  ExternalLink,
  ArrowLeft,
  ArrowRight,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import { log } from '@/lib/logger';
import type { WorkflowState } from '../useWorkflowState';
import { calcVat } from './requisitionUtils';

interface Step5OrderProps {
  state: WorkflowState;
  onComplete: (update: Partial<WorkflowState>) => void;
  onBack: () => void;
}

interface Supplier {
  id: string;
  name: string;
  companyName: string;
}

type Phase = 'select' | 'submitting' | 'done';

const formatCurrency = (value: number | undefined): string => {
  if (value === undefined) return '-';
  return new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR', minimumFractionDigits: 0 }).format(value);
};

export const Step5Order: React.FC<Step5OrderProps> = ({ state, onComplete, onBack }) => {
  const isRfq = state.strategy === 'rfq';
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loadingSuppliers, setLoadingSuppliers] = useState(true);
  const [supplierError, setSupplierError] = useState<string | null>(null);
  const [selectedSupplierIds, setSelectedSupplierIds] = useState<string[]>([]);
  const [selectedSupplierId, setSelectedSupplierId] = useState<string>(state.selectedSupplierId || '');
  const [phase, setPhase] = useState<Phase>('select');
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (isRfq && state.rfqId) setPhase('done');
    if (!isRfq && state.selectedSupplierId) setPhase('done');
  }, [isRfq, state.rfqId, state.selectedSupplierId]);

  const fetchSuppliers = useCallback(async () => {
    setLoadingSuppliers(true);
    setSupplierError(null);
    try {
      const res = await fetch('/api/suppliers');
      const json = await res.json() as { success: boolean; data?: Supplier[]; message?: string };
      if (!json.success) throw new Error(json.message ?? 'Failed to load suppliers');
      setSuppliers(json.data ?? []);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load suppliers';
      log.error('Step5Order', 'Supplier fetch failed', { error: err });
      setSupplierError(msg);
    } finally {
      setLoadingSuppliers(false);
    }
  }, []);

  useEffect(() => { void fetchSuppliers(); }, [fetchSuppliers]);

  const toggleSupplier = (id: string) => {
    setSelectedSupplierIds((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    );
  };

  const handleSubmitRfq = async () => {
    if (selectedSupplierIds.length === 0) return;
    setPhase('submitting');
    setSubmitError(null);
    try {
      const res = await fetch(
        `/api/procurement/requisitions/${state.requisitionId}/create-rfq`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ supplierIds: selectedSupplierIds }) }
      );
      const json = await res.json() as { success: boolean; data?: { id: string; rfqNumber: string }; message?: string };
      if (!json.success || !json.data) throw new Error(json.message ?? 'Failed to create RFQ');
      setPhase('done');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to create RFQ';
      log.error('Step5Order', 'RFQ creation failed', { error: err });
      setSubmitError(msg);
      setPhase('select');
    }
  };

  const handleSelectSupplier = () => {
    if (!selectedSupplierId) return;
    const supplier = suppliers.find((s) => s.id === selectedSupplierId);
    const name = supplier?.companyName || supplier?.name || 'Unknown';
    setPhase('done');
    // Don't call onComplete yet — wait for user to click Next
    setSelectedSupplierId(selectedSupplierId);
    // Store locally for the Next button
    void name; // used in handleNext
  };

  const handleNext = () => {
    if (isRfq) {
      onComplete({ rfqId: state.rfqId, rfqNumber: state.rfqNumber });
    } else {
      const supplier = suppliers.find((s) => s.id === selectedSupplierId);
      const name = supplier?.companyName || supplier?.name || 'Unknown';
      onComplete({ selectedSupplierId, selectedSupplierName: name });
    }
  };

  const accentColor = isRfq ? '#d97706' : '#2563eb';
  const accentBg = isRfq ? 'rgba(217,119,6,0.08)' : 'rgba(37,99,235,0.08)';

  if (loadingSuppliers) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '48px' }}>
        <Loader2 style={{ width: 24, height: 24, animation: 'spin 1s linear infinite', color: 'var(--ff-text-secondary)' }} />
        <span style={{ marginLeft: 8, color: 'var(--ff-text-secondary)' }}>Loading suppliers…</span>
      </div>
    );
  }

  if (supplierError) {
    return (
      <div style={{ padding: '24px', textAlign: 'center' }}>
        <AlertCircle style={{ width: 32, height: 32, color: '#ef4444', margin: '0 auto 8px' }} />
        <p style={{ color: '#ef4444', marginBottom: 12 }}>{supplierError}</p>
        <button onClick={() => void fetchSuppliers()} style={{ padding: '8px 16px', border: '1px solid var(--ff-border-light)', borderRadius: 6, cursor: 'pointer' }}>Retry</button>
      </div>
    );
  }

  if (phase === 'done') {
    const doneLabel = isRfq ? 'RFQ Sent to Suppliers' : 'Supplier Selected';
    const doneDetail = isRfq
      ? state.rfqNumber || 'RFQ created'
      : suppliers.find((s) => s.id === selectedSupplierId)?.companyName || state.selectedSupplierName || 'Selected';

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        <StrategyBadge isRfq={isRfq} accentColor={accentColor} accentBg={accentBg} />
        <div style={{ background: 'rgba(22,163,74,0.08)', border: '1px solid rgba(22,163,74,0.3)', borderRadius: 12, padding: 24, textAlign: 'center' }}>
          <CheckCircle style={{ width: 40, height: 40, color: '#16a34a', margin: '0 auto 12px' }} />
          <p style={{ fontWeight: 600, fontSize: 16, color: 'var(--ff-text-primary)', marginBottom: 4 }}>{doneLabel}</p>
          <p style={{ color: 'var(--ff-text-secondary)' }}>{doneDetail}</p>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={handleNext} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 20px', background: '#16a34a', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600 }}>
            Next: Quote &amp; Award <ArrowRight style={{ width: 16, height: 16 }} />
          </button>
        </div>
      </div>
    );
  }

  const canSubmit = isRfq ? selectedSupplierIds.length > 0 : Boolean(selectedSupplierId);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <StrategyBadge isRfq={isRfq} accentColor={accentColor} accentBg={accentBg} />
      <div style={{ background: 'var(--ff-bg-secondary)', borderRadius: 8, padding: '12px 16px' }}>
        <p style={{ fontSize: 13, color: 'var(--ff-text-secondary)' }}>
          Requisition <strong style={{ color: 'var(--ff-text-primary)' }}>{state.requisitionNumber}</strong>
          {state.estimatedTotal !== undefined && (
            <> &mdash; Estimated: <strong style={{ color: 'var(--ff-text-primary)' }}>{formatCurrency(state.estimatedTotal + calcVat(state.estimatedTotal))}</strong> <span style={{ fontSize: 11 }}>(incl. VAT)</span></>
          )}
        </p>
      </div>
      {submitError && (
        <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: '10px 14px', display: 'flex', gap: 8, alignItems: 'center' }}>
          <AlertCircle style={{ width: 16, height: 16, color: '#ef4444', flexShrink: 0 }} />
          <span style={{ fontSize: 14, color: '#ef4444' }}>{submitError}</span>
        </div>
      )}
      {isRfq ? (
        <RfqSupplierSelect suppliers={suppliers} selectedIds={selectedSupplierIds} onToggle={toggleSupplier} accentColor={accentColor} accentBg={accentBg} />
      ) : (
        <PoSupplierSelect suppliers={suppliers} selectedId={selectedSupplierId} onChange={setSelectedSupplierId} accentColor={accentColor} />
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <button onClick={onBack} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 16px', border: '1px solid var(--ff-border-light)', borderRadius: 8, cursor: 'pointer', background: 'transparent', color: 'var(--ff-text-secondary)' }}>
          <ArrowLeft style={{ width: 16, height: 16 }} /> Back
        </button>
        <button
          onClick={isRfq ? () => void handleSubmitRfq() : handleSelectSupplier}
          disabled={!canSubmit || phase === 'submitting'}
          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 20px', background: canSubmit && phase !== 'submitting' ? accentColor : 'var(--ff-bg-tertiary)', color: canSubmit && phase !== 'submitting' ? '#fff' : 'var(--ff-text-tertiary)', border: 'none', borderRadius: 8, cursor: canSubmit ? 'pointer' : 'not-allowed', fontWeight: 600 }}
        >
          {phase === 'submitting' ? (
            <><Loader2 style={{ width: 16, height: 16, animation: 'spin 1s linear infinite' }} /> Sending…</>
          ) : (
            <>{isRfq ? 'Create & Send RFQ' : 'Confirm Supplier'}</>
          )}
        </button>
      </div>
    </div>
  );
};

const StrategyBadge: React.FC<{ isRfq: boolean; accentColor: string; accentBg: string }> = ({ isRfq, accentColor, accentBg }) => (
  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 12px', background: accentBg, border: `1px solid ${accentColor}`, borderRadius: 20, fontSize: 13, color: accentColor, fontWeight: 600, alignSelf: 'flex-start' }}>
    {isRfq ? <FileText style={{ width: 14, height: 14 }} /> : <Package style={{ width: 14, height: 14 }} />}
    {isRfq ? 'Strategy: RFQ' : 'Strategy: Direct PO'}
  </div>
);

const RfqSupplierSelect: React.FC<{ suppliers: Supplier[]; selectedIds: string[]; onToggle: (id: string) => void; accentColor: string; accentBg: string }> = ({ suppliers, selectedIds, onToggle, accentColor, accentBg }) => (
  <div>
    <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--ff-text-primary)', marginBottom: 12 }}>
      Select Suppliers to Invite <span style={{ color: '#ef4444' }}>*</span>
      <span style={{ fontWeight: 400, color: 'var(--ff-text-secondary)', fontSize: 12, marginLeft: 8 }}>Select at least one</span>
    </p>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 300, overflowY: 'auto' }}>
      {suppliers.length === 0 && <p style={{ color: 'var(--ff-text-tertiary)', fontSize: 14 }}>No suppliers found.</p>}
      {suppliers.map((s) => {
        const checked = selectedIds.includes(s.id);
        return (
          <label key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', border: `1px solid ${checked ? accentColor : 'var(--ff-border-light)'}`, borderRadius: 8, cursor: 'pointer', background: checked ? accentBg : 'var(--ff-bg-primary)', transition: 'all 0.15s' }}>
            <input type="checkbox" checked={checked} onChange={() => onToggle(s.id)} style={{ width: 16, height: 16, accentColor }} />
            <span style={{ fontWeight: 500, color: 'var(--ff-text-primary)' }}>{s.companyName || s.name}</span>
          </label>
        );
      })}
    </div>
    {selectedIds.length > 0 && <p style={{ fontSize: 12, color: 'var(--ff-text-secondary)', marginTop: 8 }}>{selectedIds.length} supplier{selectedIds.length !== 1 ? 's' : ''} selected</p>}
  </div>
);

const PoSupplierSelect: React.FC<{ suppliers: Supplier[]; selectedId: string; onChange: (id: string) => void; accentColor: string }> = ({ suppliers, selectedId, onChange, accentColor }) => (
  <div>
    <label style={{ fontSize: 14, fontWeight: 600, color: 'var(--ff-text-primary)', display: 'block', marginBottom: 8 }}>
      Select Supplier <span style={{ color: '#ef4444' }}>*</span>
    </label>
    <select value={selectedId} onChange={(e) => onChange(e.target.value)} style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--ff-border-light)', borderRadius: 8, background: 'var(--ff-bg-primary)', color: 'var(--ff-text-primary)', fontSize: 14, outline: 'none', boxSizing: 'border-box', accentColor }}>
      <option value="">-- Select a supplier --</option>
      {suppliers.map((s) => <option key={s.id} value={s.id}>{s.companyName || s.name}</option>)}
    </select>
  </div>
);

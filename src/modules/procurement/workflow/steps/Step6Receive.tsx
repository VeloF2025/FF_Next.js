/**
 * Step6Receive — Goods Receipt Note (GRN) tracker
 * Checks GRN status for the PO, allows recording delivery or skipping.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import {
  Truck,
  CheckCircle,
  AlertCircle,
  Clock,
  ExternalLink,
  ArrowLeft,
  ArrowRight,
  Loader2,
  Info,
  XCircle,
} from 'lucide-react';
import { log } from '@/lib/logger';
import { formatDisplayDate } from '@/utils/dateFormat';
import type { WorkflowState } from '../useWorkflowState';

// 🟢 WORKING: full type coverage
interface Step6ReceiveProps {
  state: WorkflowState;
  onComplete: (update: Partial<WorkflowState>) => void;
  onBack: () => void;
}

type GrnStatus = 'draft' | 'partial' | 'complete' | 'rejected';

interface GRN {
  id: string;
  grnNumber: string;
  status: GrnStatus;
  receivedDate?: string;
}

const GRN_STATUS_CONFIG: Record<GrnStatus, { label: string; color: string; bg: string; Icon: React.FC<{ style?: React.CSSProperties }> }> = {
  draft: { label: 'Draft', color: '#6b7280', bg: 'rgba(107,114,128,0.1)', Icon: Clock },
  partial: { label: 'Partial', color: '#d97706', bg: 'rgba(217,119,6,0.1)', Icon: AlertCircle },
  complete: { label: 'Complete', color: '#16a34a', bg: 'rgba(22,163,74,0.1)', Icon: CheckCircle },
  rejected: { label: 'Rejected', color: '#dc2626', bg: 'rgba(220,38,38,0.1)', Icon: XCircle },
};

export const Step6Receive: React.FC<Step6ReceiveProps> = ({ state, onComplete, onBack }) => {
  const router = useRouter();
  const isRfqPath = state.strategy === 'rfq' && !state.poId;

  const [grns, setGrns] = useState<GRN[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const fetchGrns = useCallback(async () => {
    if (!state.poId) return;
    setLoading(true);
    setFetchError(null);
    try {
      const res = await fetch(`/api/procurement/grn?poId=${state.poId}`);
      const json = await res.json() as { success: boolean; data?: GRN[]; message?: string };
      if (!json.success) throw new Error(json.message ?? 'Failed to load GRNs');
      setGrns(json.data ?? []);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load GRNs';
      log.error('Step6Receive: GRN fetch failed', { err }, 'procurement');
      setFetchError(msg);
    } finally {
      setLoading(false);
    }
  }, [state.poId]);

  useEffect(() => {
    void fetchGrns();
  }, [fetchGrns]);

  const firstGrn = grns[0];
  const hasCompleteOrPartial = grns.some((g) => g.status === 'complete' || g.status === 'partial');

  const handleConfirm = () => {
    if (!firstGrn) return;
    onComplete({ grnId: firstGrn.id, grnStatus: 'confirmed' });
  };

  const handleSkip = () => {
    onComplete({ grnStatus: 'pending' });
  };

  const handleRecordDelivery = () => {
    void router.push(`/procurement/grn/new?poId=${state.poId}`);
  };

  // ---- RFQ path without a PO yet ----
  if (isRfqPath) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        <SectionHeader title="Track Delivery" subtitle="Goods Receipt Note" />
        <div style={{ background: 'rgba(37,99,235,0.06)', border: '1px solid rgba(37,99,235,0.2)', borderRadius: 12, padding: 20, display: 'flex', gap: 12 }}>
          <Info style={{ width: 20, height: 20, color: '#2563eb', flexShrink: 0, marginTop: 2 }} />
          <p style={{ fontSize: 14, color: 'var(--ff-text-primary)', lineHeight: 1.6 }}>
            A Purchase Order will be created after supplier quotes are accepted. You can record delivery once the PO is confirmed.
          </p>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <button onClick={onBack} style={backBtnStyle}>
            <ArrowLeft style={{ width: 16, height: 16 }} /> Back
          </button>
          <button onClick={() => onComplete({ grnStatus: 'pending' })} style={primaryBtnStyle('#16a34a')}>
            Skip to Payment <ArrowRight style={{ width: 16, height: 16 }} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <SectionHeader title="Track Delivery" subtitle="Goods Receipt Note" />

      {/* PO reference */}
      {state.poNumber && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--ff-bg-secondary)', borderRadius: 8, padding: '10px 14px' }}>
          <span style={{ fontSize: 14, color: 'var(--ff-text-secondary)' }}>
            Purchase Order: <strong style={{ color: 'var(--ff-text-primary)' }}>{state.poNumber}</strong>
          </span>
          <button
            onClick={() => void router.push(`/procurement/purchase-orders/${state.poId}`)}
            style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: '#2563eb', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
          >
            <ExternalLink style={{ width: 12, height: 12 }} /> View PO
          </button>
        </div>
      )}

      {/* GRN loading */}
      {loading && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--ff-text-secondary)', padding: '12px 0' }}>
          <Loader2 style={{ width: 18, height: 18, animation: 'spin 1s linear infinite' }} />
          <span style={{ fontSize: 14 }}>Checking delivery records…</span>
        </div>
      )}

      {fetchError && (
        <ErrorBanner message={fetchError} onRetry={() => void fetchGrns()} />
      )}

      {/* No GRN yet */}
      {!loading && !fetchError && grns.length === 0 && (
        <div style={{ background: 'rgba(217,119,6,0.08)', border: '1px solid rgba(217,119,6,0.25)', borderRadius: 12, padding: 20 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 14 }}>
            <Truck style={{ width: 20, height: 20, color: '#d97706', flexShrink: 0 }} />
            <p style={{ fontSize: 14, color: 'var(--ff-text-primary)', fontWeight: 500 }}>No delivery recorded yet</p>
          </div>
          <button onClick={handleRecordDelivery} style={primaryBtnStyle('#d97706')}>
            Record Delivery
          </button>
        </div>
      )}

      {/* GRN list */}
      {!loading && grns.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--ff-text-primary)' }}>
            Delivery Records ({grns.length})
          </p>
          {grns.map((grn) => {
            const cfg = GRN_STATUS_CONFIG[grn.status] ?? GRN_STATUS_CONFIG.draft;
            const { Icon } = cfg;
            return (
              <div key={grn.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', border: '1px solid var(--ff-border-light)', borderRadius: 8, background: 'var(--ff-bg-primary)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Icon style={{ width: 16, height: 16, color: cfg.color }} />
                  <span style={{ fontSize: 14, color: 'var(--ff-text-primary)', fontWeight: 500 }}>{grn.grnNumber}</span>
                  {grn.receivedDate && (
                    <span style={{ fontSize: 12, color: 'var(--ff-text-tertiary)' }}>
                      {formatDisplayDate(grn.receivedDate)}
                    </span>
                  )}
                </div>
                <span style={{ fontSize: 12, fontWeight: 600, padding: '2px 10px', borderRadius: 20, background: cfg.bg, color: cfg.color }}>
                  {cfg.label}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Continue instruction when no GRN */}
      {!loading && !fetchError && grns.length === 0 && (
        <div style={{ display: 'flex', gap: 8, padding: '10px 14px', background: 'var(--ff-bg-secondary)', borderRadius: 8 }}>
          <Info style={{ width: 16, height: 16, color: 'var(--ff-text-secondary)', flexShrink: 0, marginTop: 1 }} />
          <p style={{ fontSize: 13, color: 'var(--ff-text-secondary)' }}>
            Record delivery first, then return here to continue.
          </p>
        </div>
      )}

      {/* Action row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <button onClick={onBack} style={backBtnStyle}>
          <ArrowLeft style={{ width: 16, height: 16 }} /> Back
        </button>
        <button
          onClick={handleConfirm}
          disabled={!hasCompleteOrPartial}
          style={primaryBtnStyle(hasCompleteOrPartial ? '#16a34a' : undefined)}
        >
          Mark as Received &amp; Continue <ArrowRight style={{ width: 16, height: 16 }} />
        </button>
      </div>

      {/* Skip link */}
      <div style={{ textAlign: 'center' }}>
        <button
          onClick={handleSkip}
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--ff-text-tertiary)', textDecoration: 'underline' }}
        >
          Skip (goods not required)
        </button>
      </div>
    </div>
  );
};

// ---- Internal helpers ----

const SectionHeader: React.FC<{ title: string; subtitle: string }> = ({ title, subtitle }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
    <Truck style={{ width: 22, height: 22, color: '#16a34a' }} />
    <div>
      <p style={{ fontWeight: 700, fontSize: 16, color: 'var(--ff-text-primary)', margin: 0 }}>{title}</p>
      <p style={{ fontSize: 13, color: 'var(--ff-text-secondary)', margin: 0 }}>{subtitle}</p>
    </div>
  </div>
);

const ErrorBanner: React.FC<{ message: string; onRetry: () => void }> = ({ message, onRetry }) => (
  <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
    <span style={{ fontSize: 14, color: '#dc2626' }}>{message}</span>
    <button onClick={onRetry} style={{ fontSize: 12, color: '#dc2626', background: 'none', border: '1px solid #dc2626', borderRadius: 4, padding: '2px 8px', cursor: 'pointer' }}>
      Retry
    </button>
  </div>
);

const backBtnStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6,
  padding: '10px 16px',
  border: '1px solid var(--ff-border-light)',
  borderRadius: 8, cursor: 'pointer',
  background: 'transparent',
  color: 'var(--ff-text-secondary)',
  fontSize: 14,
};

const primaryBtnStyle = (bg?: string): React.CSSProperties => ({
  display: 'flex', alignItems: 'center', gap: 8,
  padding: '10px 20px',
  background: bg ?? 'var(--ff-bg-tertiary)',
  color: bg ? '#fff' : 'var(--ff-text-tertiary)',
  border: 'none', borderRadius: 8,
  cursor: bg ? 'pointer' : 'not-allowed',
  fontWeight: 600, fontSize: 14,
});

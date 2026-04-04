/**
 * PickingDetail Component
 * Display full details of a stock picking with actions
 */

'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import {
  ArrowLeft,
  ArrowRight,
  Package,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Truck,
  RotateCcw,
  FileSignature,
  Play,
  Ban,
} from 'lucide-react';
import { LoadingSpinner, InlineSpinner } from '@/components/ui/LoadingSpinner';
import { usePickings } from '../../hooks/usePickings';
import { SignatureCapture } from './SignatureCapture';
import type { PickingType, PickingStatus } from '../../types';

interface PickingLine {
  id: string;
  stock_item_id: string;
  planned_quantity: number;
  actual_quantity: number | null;
  serial_ids: string[] | null;
  status: string;
  notes: string | null;
  item_name: string;
  item_code: string;
}

interface PickingDetailData {
  id: string;
  picking_number: string;
  picking_type: PickingType;
  status: PickingStatus;
  source_location_id: string;
  destination_location_id: string;
  source_location_name: string;
  source_location_code: string;
  destination_location_name: string;
  destination_location_code: string;
  contractor_name: string | null;
  technician_name: string | null;
  team_name: string | null;
  job_reference: string | null;
  scheduled_date: string | null;
  effective_date: string | null;
  requested_by: string | null;
  approved_by: string | null;
  signature_data: string | null;
  signed_at: string | null;
  signed_by: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  lines: PickingLine[] | null;
}

const TYPE_CONFIG: Record<PickingType, { label: string; icon: React.ReactNode; color: string }> = {
  issue: { label: 'Issue', icon: <ArrowRight className="h-5 w-5" />, color: 'blue' },
  receipt: { label: 'Receipt', icon: <Package className="h-5 w-5" />, color: 'green' },
  transfer: { label: 'Transfer', icon: <Truck className="h-5 w-5" />, color: 'purple' },
  return: { label: 'Return', icon: <RotateCcw className="h-5 w-5" />, color: 'orange' },
  scrap: { label: 'Scrap', icon: <XCircle className="h-5 w-5" />, color: 'red' },
};

const STATUS_CONFIG: Record<PickingStatus, { label: string; color: string; icon: React.ReactNode }> = {
  draft: { label: 'Draft', color: 'gray', icon: <Clock className="h-4 w-4" /> },
  confirmed: { label: 'Confirmed', color: 'blue', icon: <CheckCircle2 className="h-4 w-4" /> },
  processing: { label: 'Processing', color: 'yellow', icon: <InlineSpinner size="sm" /> },
  done: { label: 'Done', color: 'green', icon: <CheckCircle2 className="h-4 w-4" /> },
  cancelled: { label: 'Cancelled', color: 'red', icon: <XCircle className="h-4 w-4" /> },
};

const STATUS_BADGE: Record<string, string> = {
  draft: 'bg-secondary text-gray-800 dark:bg-gray-700 dark:text-gray-200',
  confirmed: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-200',
  processing: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-200',
  done: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-200',
  cancelled: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-200',
};

interface PickingDetailProps {
  pickingId: string;
}

export function PickingDetail({ pickingId }: PickingDetailProps) {
  const router = useRouter();
  const { confirmPicking, processPicking, cancelPicking, signPicking } = usePickings();
  const [picking, setPicking] = useState<PickingDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [showSignature, setShowSignature] = useState(false);

  useEffect(() => {
    async function fetchPicking() {
      setLoading(true);
      try {
        const res = await fetch(`/api/procurement/field-stock/pickings/${pickingId}`);
        if (!res.ok) {
          if (res.status === 404) {
            setError('Transfer not found');
            return;
          }
          const data = await res.json();
          throw new Error(data.error || 'Failed to fetch transfer');
        }
        const data = await res.json();
        setPicking(data.data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load transfer');
      } finally {
        setLoading(false);
      }
    }
    if (pickingId) fetchPicking();
  }, [pickingId]);

  const handleAction = async (action: 'confirm' | 'process' | 'cancel') => {
    if (!picking) return;
    setActionLoading(true);
    try {
      if (action === 'confirm') await confirmPicking(picking.id);
      else if (action === 'process') await processPicking(picking.id);
      else if (action === 'cancel') await cancelPicking(picking.id);
      // Refresh
      const res = await fetch(`/api/procurement/field-stock/pickings/${pickingId}`);
      const data = await res.json();
      setPicking(data.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to ${action} transfer`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleSign = async (signatureData: string, signedBy: string) => {
    if (!picking) return;
    setActionLoading(true);
    try {
      await signPicking(picking.id, { signatureData, signedBy });
      setShowSignature(false);
      const res = await fetch(`/api/procurement/field-stock/pickings/${pickingId}`);
      const data = await res.json();
      setPicking(data.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sign transfer');
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return <LoadingSpinner className="h-64" size="lg" label="" />;
  }

  if (error || !picking) {
    return (
      <div className="space-y-4">
        <button
          onClick={() => router.push('/procurement/field-stock')}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Transfers
        </button>
        <div className="rounded-lg border border-red-200 bg-red-50 p-6 dark:border-red-800 dark:bg-red-900/20">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-red-500" />
            <p className="text-red-800 dark:text-red-200">{error || 'Transfer not found'}</p>
          </div>
        </div>
      </div>
    );
  }

  const typeConfig = TYPE_CONFIG[picking.picking_type] || TYPE_CONFIG.transfer;
  const statusConfig = STATUS_CONFIG[picking.status] || STATUS_CONFIG.draft;
  const lines = picking.lines || [];

  if (showSignature) {
    return (
      <div className="space-y-4">
        <button
          onClick={() => setShowSignature(false)}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Transfer
        </button>
        <SignatureCapture
          onSave={handleSign}
          onCancel={() => setShowSignature(false)}
          signerName={picking.technician_name || picking.contractor_name || ''}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Back + Header */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => router.push('/procurement/field-stock')}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Transfers
        </button>
        <div className="flex items-center gap-2">
          {picking.status === 'draft' && (
            <>
              <button
                onClick={() => handleAction('confirm')}
                disabled={actionLoading}
                className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                <CheckCircle2 className="h-4 w-4" /> Confirm
              </button>
              <button
                onClick={() => handleAction('cancel')}
                disabled={actionLoading}
                className="flex items-center gap-2 rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-900/20"
              >
                <Ban className="h-4 w-4" /> Cancel
              </button>
            </>
          )}
          {picking.status === 'confirmed' && (
            <button
              onClick={() => handleAction('process')}
              disabled={actionLoading}
              className="flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
            >
              <Play className="h-4 w-4" /> Process
            </button>
          )}
          {!picking.signed_at && picking.status !== 'cancelled' && (
            <button
              onClick={() => setShowSignature(true)}
              disabled={actionLoading}
              className="flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-accent/50 disabled:opacity-50"
            >
              <FileSignature className="h-4 w-4" /> Sign
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/20">
          <AlertCircle className="h-5 w-5 text-red-500" />
          <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
        </div>
      )}

      {/* Title Card */}
      <div className="rounded-lg border border-border bg-card p-6 dark:border-gray-700 dark:bg-gray-800">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <div className="rounded-lg bg-blue-100 p-3 dark:bg-blue-900/30">
              {typeConfig.icon}
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground">{picking.picking_number}</h1>
              <div className="mt-1 flex items-center gap-3">
                <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_BADGE[picking.status] || STATUS_BADGE.draft}`}>
                  {statusConfig.icon} {statusConfig.label}
                </span>
                <span className="text-sm text-muted-foreground">{typeConfig.label}</span>
              </div>
            </div>
          </div>
          {picking.signed_at && (
            <div className="flex items-center gap-1 rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-800 dark:bg-green-900/30 dark:text-green-300">
              <CheckCircle2 className="h-3 w-3" /> Signed by {picking.signed_by}
            </div>
          )}
        </div>
      </div>

      {/* Details Grid */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Locations */}
        <div className="rounded-lg border border-border bg-card p-5 dark:border-gray-700 dark:bg-gray-800">
          <h3 className="mb-3 text-sm font-semibold uppercase text-muted-foreground">Locations</h3>
          <div className="space-y-3">
            <div>
              <p className="text-xs text-muted-foreground">From</p>
              <p className="font-medium text-foreground">{picking.source_location_code} - {picking.source_location_name}</p>
            </div>
            <div className="flex justify-center">
              <ArrowRight className="h-4 w-4 text-gray-400" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">To</p>
              <p className="font-medium text-foreground">{picking.destination_location_code} - {picking.destination_location_name}</p>
            </div>
          </div>
        </div>

        {/* Info */}
        <div className="rounded-lg border border-border bg-card p-5 dark:border-gray-700 dark:bg-gray-800">
          <h3 className="mb-3 text-sm font-semibold uppercase text-muted-foreground">Details</h3>
          <div className="grid grid-cols-2 gap-3 text-sm">
            {picking.contractor_name && (
              <div>
                <p className="text-xs text-muted-foreground">Contractor</p>
                <p className="font-medium text-foreground">{picking.contractor_name}</p>
              </div>
            )}
            {picking.technician_name && (
              <div>
                <p className="text-xs text-muted-foreground">Technician</p>
                <p className="font-medium text-foreground">{picking.technician_name}</p>
              </div>
            )}
            {picking.team_name && (
              <div>
                <p className="text-xs text-muted-foreground">Team</p>
                <p className="font-medium text-foreground">{picking.team_name}</p>
              </div>
            )}
            {picking.job_reference && (
              <div>
                <p className="text-xs text-muted-foreground">Job Reference</p>
                <p className="font-medium text-foreground">{picking.job_reference}</p>
              </div>
            )}
            <div>
              <p className="text-xs text-muted-foreground">Created</p>
              <p className="font-medium text-foreground">{new Date(picking.created_at).toLocaleString()}</p>
            </div>
            {picking.scheduled_date && (
              <div>
                <p className="text-xs text-muted-foreground">Scheduled</p>
                <p className="font-medium text-foreground">{new Date(picking.scheduled_date).toISOString().split('T')[0]}</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Lines */}
      <div className="rounded-lg border border-border bg-card dark:border-gray-700 dark:bg-gray-800">
        <div className="border-b border-border p-4 dark:border-gray-700">
          <h3 className="text-sm font-semibold uppercase text-muted-foreground">
            Items ({lines.length})
          </h3>
        </div>
        {lines.length === 0 ? (
          <div className="p-6 text-center text-muted-foreground">No items on this transfer</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-background">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-muted-foreground">Item</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-muted-foreground">Code</th>
                  <th className="px-4 py-3 text-right text-xs font-medium uppercase text-muted-foreground">Planned</th>
                  <th className="px-4 py-3 text-right text-xs font-medium uppercase text-muted-foreground">Actual</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-muted-foreground">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border dark:divide-gray-700">
                {lines.map((line) => (
                  <tr key={line.id}>
                    <td className="px-4 py-3 font-medium text-foreground">{line.item_name}</td>
                    <td className="px-4 py-3 font-mono text-muted-foreground">{line.item_code}</td>
                    <td className="px-4 py-3 text-right text-foreground">{line.planned_quantity}</td>
                    <td className="px-4 py-3 text-right text-foreground">{line.actual_quantity ?? '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[line.status] || STATUS_BADGE.draft}`}>
                        {line.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Notes */}
      {picking.notes && (
        <div className="rounded-lg border border-border bg-card p-5 dark:border-gray-700 dark:bg-gray-800">
          <h3 className="mb-2 text-sm font-semibold uppercase text-muted-foreground">Notes</h3>
          <p className="text-sm text-foreground">{picking.notes}</p>
        </div>
      )}

      {/* Signature */}
      {picking.signature_data && (
        <div className="rounded-lg border border-border bg-card p-5 dark:border-gray-700 dark:bg-gray-800">
          <h3 className="mb-2 text-sm font-semibold uppercase text-muted-foreground">Signature</h3>
          <div className="flex items-center gap-4">
            <img
              src={picking.signature_data}
              alt="Signature"
              className="h-20 rounded border border-border bg-white"
            />
            <div className="text-sm">
              <p className="font-medium text-foreground">{picking.signed_by}</p>
              {picking.signed_at && (
                <p className="text-muted-foreground">{new Date(picking.signed_at).toLocaleString()}</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

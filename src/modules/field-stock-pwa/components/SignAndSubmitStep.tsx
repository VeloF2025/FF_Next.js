'use client';

/**
 * SignAndSubmitStep -- final step of the stores issue flow.
 * Signature + notes + proof photo (non-serial) + offline-tolerant submit + R5k pending-tech cap.
 * ⚪ UNTESTED: integration tests in Task 2.9
 */

import { useState, useCallback, useMemo } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { SignaturePad } from './SignaturePad';
import { ValueCapPanel } from './ValueCapPanel';
import { ProofPhotoCapture } from './ProofPhotoCapture';
import { submitIssue, uploadIssueProof } from '@/modules/field-stock-pwa/api';
import { enqueueIssue } from '@/modules/field-stock-pwa/offline/queueIssue';
import { checkPendingValueCap } from '@/modules/field-stock-pwa/lib/stockValueGuard';
import type { StockItem } from './PickItemStep';
import type { PwaTechSummary, PwaScannedSerial, PwaIssueDraft, PwaPickingResult } from '@/modules/field-stock-pwa/types';

export interface SignAndSubmitStepProps {
  technician: PwaTechSummary;
  stockItem: StockItem;
  /** Only state==='valid' rows count toward submission and value cap. */
  scanned: PwaScannedSerial[];
  /** Quantity for non-serial (lot/quantity/none) items. Zero for serial issues. */
  quantity: number;
  contractorId: string | null;
  sourceLocationId: string;
  destinationLocationId: string;
  onSubmitted: (result: PwaPickingResult) => void;
  onBack: () => void;
}

export function SignAndSubmitStep({
  technician, stockItem, scanned, quantity, contractorId,
  sourceLocationId, destinationLocationId, onSubmitted, onBack,
}: SignAndSubmitStepProps) {
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proofPhoto, setProofPhoto] = useState<Blob | null>(null);
  const [proofPreview, setProofPreview] = useState<string | null>(null);

  const isSerialIssue = stockItem.trackingType === 'serial';
  const validSerials = useMemo(() => scanned.filter((s) => s.state === 'valid'), [scanned]);
  const unitCount = isSerialIssue ? validSerials.length : quantity;

  const valueGuard = useMemo(() => {
    if (technician.accountStatus !== 'pending') return null;
    if (stockItem.unitValueZar == null) return { unknown: true } as const;
    return checkPendingValueCap([{ unitValueZar: stockItem.unitValueZar, quantity: unitCount }], 'pending');
  }, [technician.accountStatus, stockItem.unitValueZar, unitCount]);

  const capBlocking = valueGuard !== null && 'over' in valueGuard && valueGuard.over;
  const readyToIssue = isSerialIssue ? validSerials.length > 0 : quantity > 0 && proofPhoto !== null;
  const canSubmit = signatureDataUrl !== null && readyToIssue && !capBlocking && !submitting;

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    const draft: PwaIssueDraft = {
      technicianId: technician.id, contractorId, stockItemId: stockItem.id,
      serials: validSerials, signatureDataUrl, notes, sourceLocationId, destinationLocationId,
    };
    try {
      if (!isSerialIssue) {
        if (!navigator.onLine) {
          setError('You are offline — quantity issues need a connection to upload the proof photo. Try again when you have signal.');
          return;
        }
        const proof = await uploadIssueProof(proofPhoto!);
        onSubmitted(await submitIssue({ ...draft, quantity, proofPhotoKey: proof.photoKey, proofPhotoUrl: proof.photoUrl }));
        return;
      }
      if (navigator.onLine) {
        onSubmitted(await submitIssue(draft));
      } else {
        const queueId = await enqueueIssue(draft);
        onSubmitted({ pickingId: 'queued-' + queueId, pickingNumber: 'QUEUED', status: 'pending' });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }, [
    canSubmit, technician.id, contractorId, stockItem.id,
    validSerials, signatureDataUrl, notes, onSubmitted,
    sourceLocationId, destinationLocationId, isSerialIssue, quantity, proofPhoto,
  ]);

  const summaryQty = isSerialIssue
    ? `${validSerials.length} serial${validSerials.length !== 1 ? 's' : ''}`
    : `${quantity} ${stockItem.uom ?? 'units'}`;

  return (
    <div className="space-y-4">
      <div className="rounded-lg bg-neutral-900 border border-neutral-800 px-4 py-3 space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-xs text-neutral-400">Issuing</span>
          {technician.accountStatus === 'pending' && (
            <span className="text-[10px] uppercase tracking-wide rounded bg-amber-950 text-amber-300 px-2 py-0.5">
              Pending account
            </span>
          )}
        </div>
        <p className="text-sm text-white font-medium">
          {summaryQty} of <span className="text-emerald-300">{stockItem.name}</span>
          {stockItem.sku && <span className="text-neutral-500 font-normal"> ({stockItem.sku})</span>}
        </p>
        <p className="text-sm text-neutral-300">
          to <span className="font-medium text-white">{technician.name}</span>
        </p>
      </div>

      <ValueCapPanel guard={valueGuard} technicianName={technician.name} />

      {!isSerialIssue && (
        <ProofPhotoCapture
          preview={proofPreview}
          onCapture={(b, u) => { setProofPhoto(b); setProofPreview(u); }}
        />
      )}

      <SignaturePad value={signatureDataUrl} onChange={setSignatureDataUrl} />

      <div className="space-y-1.5">
        <label htmlFor="stores-notes" className="text-sm font-medium text-neutral-300">
          Stores notes <span className="ml-1 text-xs text-neutral-600 font-normal">(optional)</span>
        </label>
        <textarea
          id="stores-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value.slice(0, 500))}
          maxLength={500}
          rows={3}
          placeholder="Any notes for the stores record..."
          className="w-full rounded-lg bg-neutral-900 border border-neutral-700 text-white text-sm placeholder:text-neutral-600 px-3 py-2.5 focus:outline-none focus:border-neutral-500 resize-none"
        />
        <p className="text-right text-xs text-neutral-600">{notes.length}/500</p>
      </div>

      {error && (
        <div className="flex gap-2 rounded-lg bg-rose-950/60 border border-rose-800 px-4 py-3">
          <AlertTriangle className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-rose-300">{error}</p>
        </div>
      )}

      <div className="flex gap-3 pt-1">
        <button type="button" onClick={onBack} disabled={submitting}
          className="flex-1 py-3.5 rounded-lg border border-neutral-700 text-neutral-300 text-sm font-medium hover:bg-neutral-800 active:bg-neutral-700 disabled:opacity-40">
          Back
        </button>
        <button type="button" onClick={handleSubmit} disabled={!canSubmit}
          className="flex-[2] py-3.5 rounded-lg bg-emerald-700 text-white text-sm font-medium hover:bg-emerald-600 active:bg-emerald-800 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2">
          {submitting ? <><Loader2 className="w-4 h-4 animate-spin" />Submitting...</> : 'Sign and submit'}
        </button>
      </div>
    </div>
  );
}

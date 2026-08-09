'use client';

import { useState } from 'react';
import { FileCheck2 } from 'lucide-react';
import { usePermission } from '@/hooks/usePermission';
import { COMMAND_PERMISSIONS } from '../services/zoneDeliveryHttp';
import { readZoneHandoverState, submitZoneHandover } from '../services/zoneHandoverSubmission';
import { ZoneAttestationDialog, type AttestationValues } from './ZoneAttestationDialog';

interface Props {
  projectId: string;
  zoneNo: number;
  onSubmitted?: () => void;
}

const fileInput = 'mt-1 block w-full text-xs text-[var(--ff-text-secondary)]';

/**
 * "Zone Handover" — Johan's second control, shown on a zone with All PONs
 * selected, exactly where he described it.
 *
 * Both documents are required every time. He was asked directly whether a
 * legacy zone might have only one, and answered that he always has both, so
 * treating them as the handover action rather than as a gate upon it costs
 * nothing and keeps the evidence attached to the date.
 */
export function ZoneHandoverButton({ projectId, zoneNo, onSubmitted }: Props) {
  const { can } = usePermission();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fac, setFac] = useState<File | null>(null);
  const [cac, setCac] = useState<File | null>(null);
  const [replacing, setReplacing] = useState(false);

  // Declaring a handover is gated on zone-qa-approve; the uploads it performs
  // are gated on documents-manage. Both are required for the sequence to
  // complete, so both are required to offer it.
  const permitted = can(COMMAND_PERMISSIONS.zoneQa, 'edit')
    && can(COMMAND_PERMISSIONS.document, 'edit');
  if (!permitted) return null;

  const openDialog = () => {
    setError(null);
    setFac(null);
    setCac(null);
    setReplacing(false);
    setOpen(true);
    // Uploading over evidence that is already on file is a correction, and the
    // command rejects a correction with no reason. Ask before submitting rather
    // than failing on a field that is not on screen — this is what a retry of a
    // half-finished handover looks like.
    void readZoneHandoverState(projectId, zoneNo)
      .then(state => setReplacing(state.hasEvidence))
      .catch(() => setReplacing(false));
  };

  const submit = async (values: AttestationValues): Promise<boolean> => {
    if (!fac || !cac) {
      setError('Both the FAC and the CAC are required.');
      return false;
    }
    setSubmitting(true);
    setError(null);
    try {
      await submitZoneHandover({ projectId, zoneNo, fac, cac, ...values });
      onSubmitted?.();
      return true;
    } catch (handoverError) {
      setError(handoverError instanceof Error
        ? handoverError.message
        : 'Unable to record the zone handover.');
      return false;
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        className="inline-flex items-center gap-1.5 rounded-md bg-amber-700 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-amber-600"
      >
        <FileCheck2 className="h-3.5 w-3.5" />
        Zone Handover
      </button>
      <ZoneAttestationDialog
        open={open}
        title={`Zone ${zoneNo} handover`}
        description="Upload the signed FAC and CAC, then choose the date the zone was handed over."
        dateLabel="Date handed over"
        confirmLabel="Record handover"
        submitting={submitting}
        error={error}
        requireReason={replacing}
        reasonHint="Reason for replacing the evidence on file"
        onClose={() => setOpen(false)}
        onSubmit={submit}
      >
        <label className="block text-sm text-[var(--ff-text-primary)]">
          FAC
          <input
            type="file"
            required
            onChange={event => setFac(event.target.files?.[0] ?? null)}
            className={fileInput}
          />
        </label>
        <label className="block text-sm text-[var(--ff-text-primary)]">
          CAC
          <input
            type="file"
            required
            onChange={event => setCac(event.target.files?.[0] ?? null)}
            className={fileInput}
          />
        </label>
      </ZoneAttestationDialog>
    </>
  );
}

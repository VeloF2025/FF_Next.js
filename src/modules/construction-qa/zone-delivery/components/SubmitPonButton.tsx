'use client';

import { useState } from 'react';
import { Send } from 'lucide-react';
import { usePermission } from '@/hooks/usePermission';
import { COMMAND_PERMISSIONS } from '../services/zoneDeliveryHttp';
import { ZoneAttestationDialog, type AttestationValues } from './ZoneAttestationDialog';

interface Props {
  projectId: string;
  zoneNo: number;
  ponNo: number;
  /** Called after a successful submission so the caller can refresh. */
  onSubmitted?: () => void;
}

interface Envelope {
  success: boolean;
  error?: { message?: string };
}

/**
 * "Submit PON" — Johan's first control, on the screen where he already works.
 *
 * He uploads a PON's optical pack to the FNO's SharePoint by hand and then
 * records that he did it. The button attests to that; it does not verify it,
 * because FibreFlow cannot see the FNO's SharePoint.
 */
export function SubmitPonButton({ projectId, zoneNo, ponNo, onSubmitted }: Props) {
  const { can } = usePermission();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // usePermission resolves against the database, which is what makes this
  // visible to a user whose grants live in user_permission_overrides rather
  // than in the role — the token-array check would report false for them.
  if (!can(COMMAND_PERMISSIONS.operations, 'edit')) return null;

  const submit = async (values: AttestationValues): Promise<boolean> => {
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch('/api/zone-delivery/pon-submit', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          zoneNo,
          ponNo,
          source: 'works-qa-toolbar',
          ...values,
        }),
      });
      const payload = await response.json() as Envelope;
      if (!response.ok || !payload.success) {
        throw new Error(payload.error?.message ?? 'Unable to record the PON submission.');
      }
      onSubmitted?.();
      return true;
    } catch (submitError) {
      setError(submitError instanceof Error
        ? submitError.message
        : 'Unable to record the PON submission.');
      return false;
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => { setError(null); setOpen(true); }}
        className="inline-flex items-center gap-1.5 rounded-md bg-red-700 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-red-600"
      >
        <Send className="h-3.5 w-3.5" />
        Submit PON
      </button>
      <ZoneAttestationDialog
        open={open}
        title={`Submit PON ${ponNo}`}
        description={`Records that PON ${ponNo} in zone ${zoneNo} was submitted to the FNO for port activation.`}
        dateLabel="Date submitted"
        confirmLabel="Submit PON"
        submitting={submitting}
        error={error}
        onClose={() => setOpen(false)}
        onSubmit={submit}
      />
    </>
  );
}

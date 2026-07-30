/**
 * Withdraw a certificate that was already verified.
 *
 * Deliberately not folded into the generic DocumentVerificationPanel: that
 * component's actions are gated on `isPending` and its verdict type is
 * verified/rejected, because for every other document type those are the only
 * two outcomes. Revocation only exists for a training certificate, so it lives
 * with the rest of the certificate workflow.
 *
 * The reason is mandatory here and mandatory again on the server — this dialog
 * is a convenience, not the control.
 */

import { useState } from 'react';
import { Ban, Loader2 } from 'lucide-react';

export interface TrainingCertificateRevokeDialogProps {
  isOpen: boolean;
  documentId: string;
  documentName: string;
  onClose(): void;
  onRevoked(): void;
}

export function TrainingCertificateRevokeDialog({
  isOpen,
  documentId,
  documentName,
  onClose,
  onRevoked,
}: TrainingCertificateRevokeDialogProps) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  async function submit() {
    if (!reason.trim()) {
      setError('A reason is required to revoke a certificate');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/staff-documents/${documentId}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ status: 'revoked', notes: reason.trim() }),
      });
      const json = await res.json();
      if (!res.ok || json?.success === false) {
        setError(json?.error?.message || 'Failed to revoke the certificate');
        setBusy(false);
        return;
      }
      // Only once the API confirms every linked competency was withdrawn.
      onRevoked();
    } catch {
      setError('Network error revoking the certificate');
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Revoke training certificate"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
    >
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow-xl max-w-lg w-full m-4 p-6 space-y-4">
        <h2 className="text-lg font-semibold text-[var(--ff-text-primary)]">
          Revoke {documentName}
        </h2>
        <p className="text-sm text-[var(--ff-text-secondary)]">
          Every competency this certificate proves stops counting immediately. The document and its
          audit history are kept — a corrected certificate is uploaded as a new submission.
        </p>

        {error && (
          <div role="alert" className="p-3 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg text-sm">
            {error}
          </div>
        )}

        <div>
          <label htmlFor="revoke-reason" className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
            Reason *
          </label>
          <textarea
            id="revoke-reason"
            rows={3}
            value={reason}
            disabled={busy}
            onChange={(e) => {
              setReason(e.target.value);
              setError(null);
            }}
            placeholder="Why is this evidence being withdrawn?"
            className="w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] resize-none focus:outline-none focus:ring-2 focus:ring-red-500"
          />
        </div>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="px-4 py-2 text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-tertiary)] rounded-lg disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={submit}
            className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white rounded-lg transition-colors"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Ban className="w-4 h-4" />}
            {busy ? 'Revoking…' : 'Revoke certificate'}
          </button>
        </div>
      </div>
    </div>
  );
}

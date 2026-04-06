'use client';

/**
 * Review Claim Modal
 * Modal for approving or rejecting a pending progress claim.
 * Extracted from ProgressClaimsSection for file-size compliance.
 */

import { useState } from 'react';
import { X, AlertCircle } from 'lucide-react';
import { reviewContractorClaim } from '@/services/contractor/contractorClaimsService';
import type { ContractorProgressClaimWithDetails } from '@/types/contractor-progress-claim.types';
import { log } from '@/lib/logger';

const INPUT_CLS =
  'w-full px-3 py-2 bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm';
const LABEL_CLS = 'block text-xs font-medium text-[var(--ff-text-secondary)] mb-1';

const fmt = (n: number) => `R ${n.toLocaleString('en-ZA', { minimumFractionDigits: 2 })}`;

export interface ReviewClaimModalProps {
  claim: ContractorProgressClaimWithDetails;
  contractorId: string;
  onClose: () => void;
  onReviewed: (updated: ContractorProgressClaimWithDetails) => void;
}

export function ReviewClaimModal({ claim, contractorId, onClose, onReviewed }: ReviewClaimModalProps) {
  const [action, setAction] = useState<'approve' | 'reject'>('approve');
  const [amountApproved, setAmountApproved] = useState(String(claim.amountClaimed));
  const [reviewNotes, setReviewNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (action === 'approve') {
      const amount = parseFloat(amountApproved);
      if (isNaN(amount) || amount < 0) {
        setFormError('Approved amount must be >= 0');
        return;
      }
    }

    if (action === 'reject' && !reviewNotes.trim()) {
      setFormError('Review notes are required when rejecting a claim');
      return;
    }

    setSubmitting(true);
    try {
      const updated = await reviewContractorClaim(contractorId, claim.id, {
        action,
        amountApproved: action === 'approve' ? parseFloat(amountApproved) : undefined,
        reviewNotes: reviewNotes.trim() || undefined,
      });
      onReviewed(updated);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to review claim';
      log.error('Failed to review progress claim', { error: err, claimId: claim.id }, 'ReviewClaimModal');
      setFormError(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full max-w-md bg-[var(--ff-bg-primary)] border border-[var(--ff-border-light)] rounded-xl shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--ff-border-light)]">
          <h2 className="text-base font-bold text-[var(--ff-text-primary)]">
            Review Claim #{claim.claimNumber}
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)]">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-6">
          <div className="mb-4 p-3 bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)]">
            <p className="text-xs text-[var(--ff-text-secondary)] mb-1">Amount Claimed</p>
            <p className="text-lg font-bold text-[var(--ff-text-primary)]">{fmt(claim.amountClaimed)}</p>
            {claim.description && (
              <p className="text-xs text-[var(--ff-text-tertiary)] mt-1 italic">{claim.description}</p>
            )}
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {formError && (
              <div className="flex items-center gap-2 text-red-400 text-sm p-3 bg-red-500/10 rounded-lg border border-red-500/30">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            <div>
              <label className={LABEL_CLS}>Action</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setAction('approve')}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${
                    action === 'approve'
                      ? 'bg-green-600 text-white border-green-600'
                      : 'bg-transparent text-[var(--ff-text-secondary)] border-[var(--ff-border-light)] hover:bg-[var(--ff-bg-tertiary)]'
                  }`}
                >
                  Approve
                </button>
                <button
                  type="button"
                  onClick={() => setAction('reject')}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${
                    action === 'reject'
                      ? 'bg-red-600 text-white border-red-600'
                      : 'bg-transparent text-[var(--ff-text-secondary)] border-[var(--ff-border-light)] hover:bg-[var(--ff-bg-tertiary)]'
                  }`}
                >
                  Reject
                </button>
              </div>
            </div>

            {action === 'approve' && (
              <div>
                <label className={LABEL_CLS}>Amount Approved (ZAR) <span className="text-red-400">*</span></label>
                <input
                  type="number"
                  required
                  min="0"
                  step="0.01"
                  value={amountApproved}
                  onChange={(e) => setAmountApproved(e.target.value)}
                  className={INPUT_CLS}
                />
              </div>
            )}

            <div>
              <label className={LABEL_CLS}>
                Review Notes {action === 'reject' && <span className="text-red-400">*</span>}
              </label>
              <textarea
                rows={3}
                value={reviewNotes}
                onChange={(e) => setReviewNotes(e.target.value)}
                placeholder={action === 'reject' ? 'Reason for rejection...' : 'Optional comments...'}
                className={`${INPUT_CLS} resize-none`}
              />
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button
                type="submit"
                disabled={submitting}
                className={`px-5 py-2 text-white text-sm rounded-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed ${
                  action === 'approve' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'
                }`}
              >
                {submitting ? 'Saving...' : action === 'approve' ? 'Approve Claim' : 'Reject Claim'}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm text-[var(--ff-text-secondary)] border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-tertiary)]"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

'use client';

/**
 * Submit Claim Modal
 * Form for submitting a new progress claim against a contractor.
 * Extracted from ProgressClaimsSection for file-size compliance.
 */

import { useState } from 'react';
import { X, AlertCircle } from 'lucide-react';
import { submitContractorClaim } from '@/services/contractor/contractorClaimsService';
import type {
  ContractorProgressClaimWithDetails,
  ContractorProgressClaimFormData,
} from '@/types/contractor-progress-claim.types';
import type { ContractorProjectWithDetails } from '@/types/contractor-project.types';
import { log } from '@/lib/logger';

const INPUT_CLS =
  'w-full px-3 py-2 bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm';
const LABEL_CLS = 'block text-xs font-medium text-[var(--ff-text-secondary)] mb-1';

export interface SubmitClaimModalProps {
  contractorId: string;
  projects: ContractorProjectWithDetails[];
  onClose: () => void;
  onSubmitted: (claim: ContractorProgressClaimWithDetails) => void;
}

export function SubmitClaimModal({ contractorId, projects, onClose, onSubmitted }: SubmitClaimModalProps) {
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [contractorProjectId, setContractorProjectId] = useState<number | undefined>(undefined);
  const [claimDate, setClaimDate] = useState<string>(new Date().toISOString().substring(0, 10));
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [description, setDescription] = useState('');
  const [amountClaimed, setAmountClaimed] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!periodStart || !periodEnd) {
      setFormError('Period start and end dates are required');
      return;
    }
    if (!description.trim()) {
      setFormError('Description is required');
      return;
    }
    const amount = parseFloat(amountClaimed);
    if (isNaN(amount) || amount <= 0) {
      setFormError('Amount must be a positive number');
      return;
    }

    const payload: ContractorProgressClaimFormData = {
      contractorProjectId,
      claimDate,
      periodStart,
      periodEnd,
      description: description.trim(),
      amountClaimed: amount,
    };

    setSubmitting(true);
    try {
      const created = await submitContractorClaim(contractorId, payload);
      onSubmitted(created);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to submit claim';
      log.error('Failed to submit progress claim', { error: err, contractorId }, 'SubmitClaimModal');
      setFormError(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-[var(--ff-bg-primary)] border border-[var(--ff-border-light)] rounded-xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--ff-border-light)] shrink-0">
          <h2 className="text-base font-bold text-[var(--ff-text-primary)]">Submit Progress Claim</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)]">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            {formError && (
              <div className="flex items-center gap-2 text-red-400 text-sm p-3 bg-red-500/10 rounded-lg border border-red-500/30">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            <div>
              <label className={LABEL_CLS}>Project Assignment</label>
              <select
                value={contractorProjectId ?? ''}
                onChange={(e) => setContractorProjectId(e.target.value ? Number(e.target.value) : undefined)}
                className={INPUT_CLS}
              >
                <option value="">— Not linked to a project —</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.projectName} ({p.projectCode}) — {p.role}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className={LABEL_CLS}>Claim Date <span className="text-red-400">*</span></label>
              <input type="date" required value={claimDate} onChange={(e) => setClaimDate(e.target.value)} className={INPUT_CLS} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={LABEL_CLS}>Period Start <span className="text-red-400">*</span></label>
                <input type="date" required value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} className={INPUT_CLS} />
              </div>
              <div>
                <label className={LABEL_CLS}>Period End <span className="text-red-400">*</span></label>
                <input type="date" required value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} className={INPUT_CLS} />
              </div>
            </div>

            <div>
              <label className={LABEL_CLS}>Description <span className="text-red-400">*</span></label>
              <textarea
                required
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe the work completed in this period..."
                className={`${INPUT_CLS} resize-none`}
              />
            </div>

            <div>
              <label className={LABEL_CLS}>Amount Claimed (ZAR) <span className="text-red-400">*</span></label>
              <input
                type="number"
                required
                min="0.01"
                step="0.01"
                value={amountClaimed}
                onChange={(e) => setAmountClaimed(e.target.value)}
                placeholder="0.00"
                className={INPUT_CLS}
              />
            </div>
          </div>

          <div className="shrink-0 px-6 py-4 border-t border-[var(--ff-border-light)] flex items-center gap-3 bg-[var(--ff-bg-secondary)]">
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
            >
              {submitting ? 'Submitting...' : 'Submit Claim'}
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
  );
}

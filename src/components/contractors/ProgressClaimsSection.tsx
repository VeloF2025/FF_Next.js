'use client';

/**
 * Progress Claims Section
 * Displays progress claims for a contractor with submit and review capabilities.
 * Used on the contractor detail page.
 *
 * Modals are extracted into:
 *   - SubmitClaimModal.tsx  — new claim submission
 *   - ReviewClaimModal.tsx  — approve/reject pending claims
 */

import { useState, useEffect, useCallback } from 'react';
import { FileText, Plus, AlertCircle, CheckCircle, XCircle, Clock } from 'lucide-react';
import {
  getContractorClaims,
} from '@/services/contractor/contractorClaimsService';
import { getContractorProjectsByContractor } from '@/services/contractor/contractorProjectsService';
import type {
  ContractorProgressClaimWithDetails,
  ContractorClaimStatus,
  ContractorClaimSummary,
} from '@/types/contractor-progress-claim.types';
import type { ContractorProjectWithDetails } from '@/types/contractor-project.types';
import { log } from '@/lib/logger';
import { SubmitClaimModal } from './SubmitClaimModal';
import { ReviewClaimModal } from './ReviewClaimModal';

// ==================== Status badge ====================

const STATUS_CONFIG: Record<ContractorClaimStatus, { label: string; className: string; icon: React.ReactNode }> = {
  pending:  { label: 'Pending',  className: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30', icon: <Clock className="h-3 w-3" /> },
  approved: { label: 'Approved', className: 'bg-green-500/20 text-green-300 border-green-500/30',   icon: <CheckCircle className="h-3 w-3" /> },
  rejected: { label: 'Rejected', className: 'bg-red-500/20 text-red-300 border-red-500/30',         icon: <XCircle className="h-3 w-3" /> },
  invoiced: { label: 'Invoiced', className: 'bg-blue-500/20 text-blue-300 border-blue-500/30',      icon: <FileText className="h-3 w-3" /> },
};

function StatusBadge({ status }: { status: ContractorClaimStatus }) {
  const cfg = STATUS_CONFIG[status];
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${cfg.className}`}>
      {cfg.icon}
      {cfg.label}
    </span>
  );
}

// ==================== Formatting helpers ====================

const fmt = (n: number) => `R ${n.toLocaleString('en-ZA', { minimumFractionDigits: 2 })}`;
const dateStr = (d: Date | string) => new Date(d).toISOString().substring(0, 10);

// ==================== Main Component ====================

interface ProgressClaimsSectionProps {
  contractorId: string;
}

export function ProgressClaimsSection({ contractorId }: ProgressClaimsSectionProps) {
  const [claims, setClaims] = useState<ContractorProgressClaimWithDetails[]>([]);
  const [summary, setSummary] = useState<ContractorClaimSummary | null>(null);
  const [projects, setProjects] = useState<ContractorProjectWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [reviewingClaim, setReviewingClaim] = useState<ContractorProgressClaimWithDetails | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [claimsResult, projectsList] = await Promise.all([
        getContractorClaims({ contractorId }),
        getContractorProjectsByContractor(contractorId),
      ]);
      setClaims(claimsResult.data);
      setSummary(claimsResult.summary);
      setProjects(projectsList);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load progress claims';
      log.error('Error loading contractor progress claims', { error: err, contractorId }, 'ProgressClaimsSection');
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [contractorId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleClaimSubmitted = (claim: ContractorProgressClaimWithDetails) => {
    setClaims((prev) => [claim, ...prev]);
    setSummary((prev) => prev ? {
      ...prev,
      totalClaimed: prev.totalClaimed + claim.amountClaimed,
      pendingCount: prev.pendingCount + 1,
    } : null);
    setShowSubmitModal(false);
  };

  const handleClaimReviewed = (updated: ContractorProgressClaimWithDetails) => {
    setClaims((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
    setReviewingClaim(null);
    getContractorClaims({ contractorId })
      .then((r) => setSummary(r.summary))
      .catch(() => { /* non-critical summary refresh */ });
  };

  if (loading) {
    return (
      <div className="bg-[var(--ff-bg-secondary)] p-6 rounded-lg border border-[var(--ff-border-light)]">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-[var(--ff-bg-tertiary)] rounded w-1/3" />
          <div className="h-16 bg-[var(--ff-bg-tertiary)] rounded" />
          <div className="h-16 bg-[var(--ff-bg-tertiary)] rounded" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-[var(--ff-bg-secondary)] p-6 rounded-lg border border-[var(--ff-border-light)]">
        <div className="flex items-center gap-2 text-red-400">
          <AlertCircle className="h-5 w-5" />
          <span>{error}</span>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="bg-[var(--ff-bg-secondary)] p-6 rounded-lg border border-[var(--ff-border-light)]">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-bold text-[var(--ff-text-primary)] flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Progress Claims
            </h2>
            {summary && (
              <p className="text-sm text-[var(--ff-text-secondary)] mt-1">
                {claims.length} claim{claims.length !== 1 ? 's' : ''} &mdash;
                Total claimed:{' '}
                <span className="font-semibold text-[var(--ff-text-primary)]">{fmt(summary.totalClaimed)}</span>
                {summary.totalApproved > 0 && (
                  <> &mdash; Approved:{' '}
                    <span className="font-semibold text-green-400">{fmt(summary.totalApproved)}</span>
                  </>
                )}
              </p>
            )}
          </div>
          <button
            onClick={() => setShowSubmitModal(true)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm"
          >
            <Plus className="h-4 w-4" />
            Submit Claim
          </button>
        </div>

        {/* Summary chips */}
        {summary && (summary.pendingCount + summary.approvedCount + summary.rejectedCount + summary.invoicedCount) > 0 && (
          <div className="flex flex-wrap gap-2 mb-4">
            {summary.pendingCount > 0 && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-yellow-500/20 text-yellow-300 border border-yellow-500/30">
                <Clock className="h-3 w-3" /> {summary.pendingCount} Pending
              </span>
            )}
            {summary.approvedCount > 0 && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-green-500/20 text-green-300 border border-green-500/30">
                <CheckCircle className="h-3 w-3" /> {summary.approvedCount} Approved
              </span>
            )}
            {summary.rejectedCount > 0 && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-red-500/20 text-red-300 border border-red-500/30">
                <XCircle className="h-3 w-3" /> {summary.rejectedCount} Rejected
              </span>
            )}
            {summary.invoicedCount > 0 && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-blue-500/20 text-blue-300 border border-blue-500/30">
                <FileText className="h-3 w-3" /> {summary.invoicedCount} Invoiced
              </span>
            )}
          </div>
        )}

        {/* Claims table */}
        {claims.length === 0 ? (
          <div className="text-center py-12 text-[var(--ff-text-tertiary)]">
            <FileText className="h-12 w-12 mx-auto mb-3 opacity-50" />
            <p>No progress claims submitted yet</p>
            <p className="text-sm mt-1">Click &ldquo;Submit Claim&rdquo; to add the first claim</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-[var(--ff-border-light)]">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)] text-xs">
                  <th className="text-left px-4 py-2.5 font-medium">Claim #</th>
                  <th className="text-left px-4 py-2.5 font-medium">Period</th>
                  <th className="text-left px-4 py-2.5 font-medium hidden md:table-cell">Description</th>
                  <th className="text-right px-4 py-2.5 font-medium">Claimed</th>
                  <th className="text-right px-4 py-2.5 font-medium hidden sm:table-cell">Approved</th>
                  <th className="text-left px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--ff-border-light)]">
                {claims.map((claim) => (
                  <tr key={claim.id} className="bg-[var(--ff-bg-secondary)] hover:bg-[var(--ff-bg-tertiary)] transition-colors">
                    <td className="px-4 py-3 font-medium text-[var(--ff-text-primary)]">
                      #{claim.claimNumber}
                      {claim.projectName && (
                        <div className="text-xs text-[var(--ff-text-tertiary)] mt-0.5">{claim.projectCode}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-[var(--ff-text-secondary)] text-xs whitespace-nowrap">
                      <div>{dateStr(claim.periodStart)}</div>
                      <div className="text-[var(--ff-text-tertiary)]">to {dateStr(claim.periodEnd)}</div>
                    </td>
                    <td className="px-4 py-3 text-[var(--ff-text-secondary)] max-w-xs hidden md:table-cell">
                      <span className="line-clamp-2 text-xs">{claim.description}</span>
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-[var(--ff-text-primary)] whitespace-nowrap">
                      {fmt(claim.amountClaimed)}
                    </td>
                    <td className="px-4 py-3 text-right hidden sm:table-cell whitespace-nowrap">
                      {claim.amountApproved !== null ? (
                        <span className="text-green-400 font-medium">{fmt(claim.amountApproved)}</span>
                      ) : (
                        <span className="text-[var(--ff-text-tertiary)]">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={claim.status} />
                      {claim.reviewNotes && claim.status === 'rejected' && (
                        <div className="text-xs text-red-400 mt-1 italic truncate max-w-[120px]">{claim.reviewNotes}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {claim.status === 'pending' && (
                        <button
                          onClick={() => setReviewingClaim(claim)}
                          className="px-3 py-1 text-xs bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)] border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-primary)] hover:text-[var(--ff-text-primary)] transition-colors whitespace-nowrap"
                        >
                          Review
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showSubmitModal && (
        <SubmitClaimModal
          contractorId={contractorId}
          projects={projects}
          onClose={() => setShowSubmitModal(false)}
          onSubmitted={handleClaimSubmitted}
        />
      )}

      {reviewingClaim && (
        <ReviewClaimModal
          claim={reviewingClaim}
          contractorId={contractorId}
          onClose={() => setReviewingClaim(null)}
          onReviewed={handleClaimReviewed}
        />
      )}
    </>
  );
}

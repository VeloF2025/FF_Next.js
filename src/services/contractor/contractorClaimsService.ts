/**
 * Contractor Progress Claims Service
 * Frontend service for submitting, fetching, and reviewing progress claims.
 */

import type {
  ContractorProgressClaimWithDetails,
  ContractorProgressClaimFormData,
  ContractorClaimFilter,
  ContractorClaimReviewPayload,
  ContractorClaimSummary,
} from '@/types/contractor-progress-claim.types';

// ==================== GET - List claims ====================

export interface GetClaimsResult {
  data: ContractorProgressClaimWithDetails[];
  summary: ContractorClaimSummary;
}

export async function getContractorClaims(
  filter: ContractorClaimFilter
): Promise<GetClaimsResult> {
  const params = new URLSearchParams();
  if (filter.status) params.append('status', filter.status);

  const url = `/api/contractors/${filter.contractorId}/claims?${params.toString()}`;
  const response = await fetch(url, { credentials: 'include' });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Request failed' }));
    throw new Error(error.message || error.error || `HTTP ${response.status}`);
  }

  return response.json() as Promise<GetClaimsResult>;
}

// ==================== POST - Submit claim ====================

export async function submitContractorClaim(
  contractorId: string,
  data: ContractorProgressClaimFormData
): Promise<ContractorProgressClaimWithDetails> {
  const response = await fetch(`/api/contractors/${contractorId}/claims`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Request failed' }));
    throw new Error(error.message || error.error || `HTTP ${response.status}`);
  }

  const result = await response.json();
  return result.data as ContractorProgressClaimWithDetails;
}

// ==================== PATCH - Review claim ====================

export async function reviewContractorClaim(
  contractorId: string,
  claimId: string,
  payload: ContractorClaimReviewPayload
): Promise<ContractorProgressClaimWithDetails> {
  const response = await fetch(`/api/contractors/${contractorId}/claims/${claimId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Request failed' }));
    throw new Error(error.message || error.error || `HTTP ${response.status}`);
  }

  const result = await response.json();
  return result.data as ContractorProgressClaimWithDetails;
}

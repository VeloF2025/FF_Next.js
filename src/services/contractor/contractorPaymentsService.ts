/**
 * Contractor Payments Service
 * Frontend service for recording and retrieving contractor payments.
 */

import type {
  ContractorPaymentWithDetails,
  ContractorPaymentFormData,
  ContractorPaymentSummary,
  ContractorPaymentFilter,
} from '@/types/contractor-payment.types';

// ==================== GET - List payments ====================

export interface GetPaymentsResult {
  data: ContractorPaymentWithDetails[];
  summary: ContractorPaymentSummary;
}

export async function getContractorPayments(
  filter: ContractorPaymentFilter
): Promise<GetPaymentsResult> {
  const params = new URLSearchParams();
  if (filter.fromDate) params.append('fromDate', filter.fromDate);
  if (filter.toDate) params.append('toDate', filter.toDate);

  const url = `/api/contractors/${filter.contractorId}/payments?${params.toString()}`;
  const response = await fetch(url);

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Request failed' }));
    throw new Error(error.message || error.error || `HTTP ${response.status}`);
  }

  return response.json() as Promise<GetPaymentsResult>;
}

// ==================== POST - Record a payment ====================

export async function recordContractorPayment(
  contractorId: string,
  data: ContractorPaymentFormData
): Promise<ContractorPaymentWithDetails> {
  const response = await fetch(`/api/contractors/${contractorId}/payments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Request failed' }));
    throw new Error(error.message || error.error || `HTTP ${response.status}`);
  }

  const result = await response.json();
  return result.data as ContractorPaymentWithDetails;
}

// ==================== CSV Export ====================

export function buildCsvExportUrl(contractorId: string, filter?: Omit<ContractorPaymentFilter, 'contractorId'>): string {
  const params = new URLSearchParams({ export: 'csv' });
  if (filter?.fromDate) params.append('fromDate', filter.fromDate);
  if (filter?.toDate) params.append('toDate', filter.toDate);
  return `/api/contractors/${contractorId}/payments?${params.toString()}`;
}

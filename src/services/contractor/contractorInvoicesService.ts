/**
 * Contractor Invoices Service
 * Frontend service for creating, fetching, and actioning contractor invoices.
 */

import type {
  ContractorInvoiceWithDetails,
  ContractorInvoiceFormData,
  ContractorInvoiceFilter,
  ContractorInvoiceActionPayload,
} from '@/types/contractor-invoice.types';

// ==================== GET - List invoices ====================

export interface GetInvoicesResult {
  data: ContractorInvoiceWithDetails[];
}

export async function getContractorInvoices(
  filter: ContractorInvoiceFilter
): Promise<GetInvoicesResult> {
  const params = new URLSearchParams();
  if (filter.status) params.append('status', filter.status);

  const url = `/api/contractors/${filter.contractorId}/invoices?${params.toString()}`;
  const response = await fetch(url, { credentials: 'include' });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Request failed' }));
    throw new Error(error.message || error.error || `HTTP ${response.status}`);
  }

  return response.json() as Promise<GetInvoicesResult>;
}

// ==================== GET - Invoice detail ====================

export async function getContractorInvoice(
  contractorId: string,
  invoiceId: string
): Promise<ContractorInvoiceWithDetails> {
  const response = await fetch(`/api/contractors/${contractorId}/invoices/${invoiceId}`, { credentials: 'include' });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Request failed' }));
    throw new Error(error.message || error.error || `HTTP ${response.status}`);
  }

  const result = await response.json();
  return result.data as ContractorInvoiceWithDetails;
}

// ==================== POST - Create invoice ====================

export async function createContractorInvoice(
  contractorId: string,
  data: ContractorInvoiceFormData
): Promise<ContractorInvoiceWithDetails> {
  const response = await fetch(`/api/contractors/${contractorId}/invoices`, {
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
  return result.data as ContractorInvoiceWithDetails;
}

// ==================== POST - Action (status transition) ====================

export async function applyInvoiceAction(
  contractorId: string,
  invoiceId: string,
  payload: ContractorInvoiceActionPayload
): Promise<ContractorInvoiceWithDetails> {
  const response = await fetch(
    `/api/contractors/${contractorId}/invoices/${invoiceId}/action`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload),
    }
  );

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Request failed' }));
    throw new Error(error.message || error.error || `HTTP ${response.status}`);
  }

  const result = await response.json();
  return result.data as ContractorInvoiceWithDetails;
}

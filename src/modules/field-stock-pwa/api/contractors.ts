/**
 * Contractor API helpers for the field-stock PWA.
 *
 * Uses /api/contractors-list (not /api/contractors which is a detail endpoint).
 */

import { request } from './request';

// =============================================================================
// Server row shape
// =============================================================================

interface ContractorRow {
  id: string;
  company_name: string;
  contact_person: string | null;
  status: string;
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Fetch the contractor dropdown list.
 * Uses /api/contractors-list (not /api/contractors which is a detail endpoint).
 */
export async function fetchContractors(): Promise<Array<{ id: string; name: string }>> {
  const rows = await request<ContractorRow[]>('/api/contractors-list');
  return rows.map((r) => ({ id: r.id, name: r.company_name }));
}

/**
 * Contractor API helpers for the field-stock PWA.
 *
 * Uses /api/my/stores/contractors (PWA-session equivalent of /api/contractors-list).
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
 * Uses /api/my/stores/contractors (PWA-session equivalent of /api/contractors-list).
 */
export async function fetchContractors(): Promise<Array<{ id: string; name: string }>> {
  const rows = await request<ContractorRow[]>('/api/my/stores/contractors');
  return rows.map((r) => ({ id: r.id, name: r.company_name }));
}

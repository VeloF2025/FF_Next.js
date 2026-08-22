import type { SiteInferenceProposal } from '../inference/proposalQueries';

const BASE = '/api/fleet/assignments/site-inference';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
  });
  const payload = await response.json().catch(() => null) as
    { data?: T; error?: { message?: string } } | null;
  if (!response.ok) {
    throw new Error(payload?.error?.message ?? `Request failed (${response.status})`);
  }
  return (payload?.data ?? null) as T;
}

export interface RecomputeSummaryResponse {
  windowStart: string;
  windowEnd: string;
  vehicles: number;
  counts: Record<string, number>;
}

export const siteInferenceApi = {
  list: (search = ''): Promise<SiteInferenceProposal[]> =>
    request(`${BASE}${search ? `?${search}` : ''}`),
  recompute: (windowDays?: number): Promise<RecomputeSummaryResponse> =>
    request(BASE, { method: 'POST', body: JSON.stringify({ windowDays }) }),
  decide: (
    vehicleId: string,
    body: {
      decision: string; overrideProjectId?: string | null; note?: string | null;
      expectedRevision: number | null;
    },
  ): Promise<SiteInferenceProposal> =>
    request(`${BASE}/${vehicleId}`, { method: 'PATCH', body: JSON.stringify(body) }),
  apply: (
    vehicleId: string, startDate: string, endDate: string, confirmWarnings = false,
  ): Promise<{ assignmentId: string }> =>
    request(`${BASE}/apply`, {
      method: 'POST', body: JSON.stringify({ vehicleId, startDate, endDate, confirmWarnings }),
    }),
  revert: (vehicleId: string, endDate: string): Promise<{ vehicleId: string }> =>
    request(`${BASE}/apply`, { method: 'DELETE', body: JSON.stringify({ vehicleId, endDate }) }),
};

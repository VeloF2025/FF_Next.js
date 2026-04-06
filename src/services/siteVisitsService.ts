/**
 * Site Visits Service
 * Frontend service for scheduling and retrieving site visits.
 */

import type {
  SiteVisitWithDetails,
  SiteVisitFormData,
  UpdateVisitFormData,
  SiteVisitFilter,
} from '@/types/site-visit.types';

// ==================== GET - List visits for project ====================

export async function getSiteVisitsByProject(
  projectId: string,
  filter?: Pick<SiteVisitFilter, 'status' | 'fromDate' | 'toDate'>
): Promise<SiteVisitWithDetails[]> {
  const params = new URLSearchParams();
  if (filter?.status) params.append('status', filter.status);
  if (filter?.fromDate) params.append('fromDate', filter.fromDate);
  if (filter?.toDate) params.append('toDate', filter.toDate);

  const qs = params.toString();
  const url = `/api/projects/${projectId}/site-visits${qs ? `?${qs}` : ''}`;
  const response = await fetch(url);

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Request failed' }));
    throw new Error(error.message || error.error || `HTTP ${response.status}`);
  }

  const result = await response.json();
  return result.data as SiteVisitWithDetails[];
}

// ==================== GET - List visits for contractor ====================

export async function getSiteVisitsByContractor(
  contractorId: string,
  filter?: Pick<SiteVisitFilter, 'status' | 'fromDate' | 'toDate'>
): Promise<SiteVisitWithDetails[]> {
  const params = new URLSearchParams();
  if (filter?.status) params.append('status', filter.status);
  if (filter?.fromDate) params.append('fromDate', filter.fromDate);
  if (filter?.toDate) params.append('toDate', filter.toDate);

  const qs = params.toString();
  const url = `/api/contractors/${contractorId}/site-visits${qs ? `?${qs}` : ''}`;
  const response = await fetch(url);

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Request failed' }));
    throw new Error(error.message || error.error || `HTTP ${response.status}`);
  }

  const result = await response.json();
  return result.data as SiteVisitWithDetails[];
}

// ==================== GET - Upcoming visits (next 7 days) ====================

export async function getUpcomingSiteVisits(): Promise<SiteVisitWithDetails[]> {
  const response = await fetch('/api/site-visits/upcoming');

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Request failed' }));
    throw new Error(error.message || error.error || `HTTP ${response.status}`);
  }

  const result = await response.json();
  return result.data as SiteVisitWithDetails[];
}

// ==================== POST - Schedule a visit ====================

export async function scheduleSiteVisit(
  data: SiteVisitFormData
): Promise<SiteVisitWithDetails> {
  const response = await fetch(`/api/projects/${data.projectId}/site-visits`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Request failed' }));
    throw new Error(error.message || error.error || `HTTP ${response.status}`);
  }

  const result = await response.json();
  return result.data as SiteVisitWithDetails;
}

// ==================== PATCH - Update a visit ====================

export async function updateSiteVisit(
  visitId: string,
  data: UpdateVisitFormData
): Promise<SiteVisitWithDetails> {
  const response = await fetch(`/api/site-visits/${visitId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Request failed' }));
    throw new Error(error.message || error.error || `HTTP ${response.status}`);
  }

  const result = await response.json();
  return result.data as SiteVisitWithDetails;
}

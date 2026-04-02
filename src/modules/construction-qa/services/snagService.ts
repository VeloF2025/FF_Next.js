/**
 * Snag Service — API client functions for the Snags module.
 * All functions call the /api/snags/* routes.
 */

import type {
  SnagProjectStats,
  SnagReport,
  Snag,
  SnagPhoto,
  CreateSnagReportRequest,
  CreateSnagRequest,
  UpdateSnagRequest,
  CreateSnagPhotoRequest,
  SnagFilters,
} from '../types/snag.types';

// ============================================================
// Stats
// ============================================================

/** Fetch per-project snag counts for the dashboard. */
export async function fetchSnagStats(): Promise<SnagProjectStats[]> {
  const res = await fetch('/api/snags/stats');
  if (!res.ok) throw new Error(`Failed to fetch snag stats: ${res.status}`);
  const json = await res.json() as { data: SnagProjectStats[] };
  return json.data;
}

// ============================================================
// Reports
// ============================================================

/** Fetch TQR reports for a project (paginated). */
export async function fetchSnagReports(
  projectId: number,
  page = 1,
  pageSize = 20
): Promise<{ reports: SnagReport[]; total: number }> {
  const params = new URLSearchParams({
    projectId: String(projectId),
    page: String(page),
    pageSize: String(pageSize),
  });
  const res = await fetch(`/api/snags/reports?${params.toString()}`);
  if (!res.ok) throw new Error(`Failed to fetch snag reports: ${res.status}`);
  const json = await res.json() as { data: SnagReport[]; pagination: { total: number } };
  return { reports: json.data, total: json.pagination.total };
}

/** Create a new TQR report record. */
export async function createSnagReport(data: CreateSnagReportRequest): Promise<SnagReport> {
  const res = await fetch('/api/snags/reports', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json() as { error?: { message?: string } };
    throw new Error(err.error?.message ?? 'Failed to create report');
  }
  const json = await res.json() as { data: SnagReport };
  return json.data;
}

// ============================================================
// Snags
// ============================================================

/** Fetch snags with filters (paginated). */
export async function fetchSnags(filters: Partial<SnagFilters>): Promise<{
  snags: Snag[];
  total: number;
}> {
  const params = new URLSearchParams();
  if (filters.reportId) params.set('reportId', filters.reportId);
  if (filters.projectId) params.set('projectId', filters.projectId);
  if (filters.status) params.set('status', filters.status);
  if (filters.category) params.set('category', filters.category);
  if (filters.severity) params.set('severity', filters.severity);
  if (filters.search) params.set('search', filters.search);
  if (filters.page) params.set('page', String(filters.page));
  if (filters.pageSize) params.set('pageSize', String(filters.pageSize));

  const res = await fetch(`/api/snags?${params.toString()}`);
  if (!res.ok) throw new Error(`Failed to fetch snags: ${res.status}`);
  const json = await res.json() as { data: Snag[]; pagination: { total: number } };
  return { snags: json.data, total: json.pagination.total };
}

/** Create a new snag linked to a report. */
export async function createSnag(data: CreateSnagRequest): Promise<Snag> {
  const res = await fetch('/api/snags', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json() as { error?: { message?: string } };
    throw new Error(err.error?.message ?? 'Failed to create snag');
  }
  const json = await res.json() as { data: Snag };
  return json.data;
}

/** Update snag status, assignment, or verification. */
export async function updateSnag(id: string, updates: Omit<UpdateSnagRequest, 'id'>): Promise<Snag> {
  const res = await fetch('/api/snags', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, ...updates }),
  });
  if (!res.ok) {
    const err = await res.json() as { error?: { message?: string } };
    throw new Error(err.error?.message ?? 'Failed to update snag');
  }
  const json = await res.json() as { data: Snag };
  return json.data;
}

// ============================================================
// Photos
// ============================================================

/** Fetch all photos for a snag, optionally filtered by phase. */
export async function fetchSnagPhotos(snagId: string, phase?: string): Promise<SnagPhoto[]> {
  const params = new URLSearchParams({ snagId });
  if (phase) params.set('phase', phase);
  const res = await fetch(`/api/snags/photos?${params.toString()}`);
  if (!res.ok) throw new Error(`Failed to fetch snag photos: ${res.status}`);
  const json = await res.json() as { data: SnagPhoto[] };
  return json.data;
}

/** Add a photo record to a snag (URL already uploaded to VF Storage). */
export async function uploadSnagPhoto(data: CreateSnagPhotoRequest): Promise<SnagPhoto> {
  const res = await fetch('/api/snags/photos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json() as { error?: { message?: string } };
    throw new Error(err.error?.message ?? 'Failed to upload photo');
  }
  const json = await res.json() as { data: SnagPhoto };
  return json.data;
}

// ============================================================
// Projects (for import dialog)
// ============================================================

interface ProjectOption {
  id: string;
  name: string;
}

/** Fetch all projects for the import dropdown. */
export async function fetchProjects(): Promise<ProjectOption[]> {
  const res = await fetch('/api/projects');
  if (!res.ok) throw new Error(`Failed to fetch projects: ${res.status}`);
  const json = await res.json() as { data: Array<{ id: string; name: string }> };
  return (json.data ?? []).map((p) => ({ id: p.id, name: p.name }));
}

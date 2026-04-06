/**
 * Snag Service — API client functions for the Snags module.
 * All functions call the /api/snags/* routes.
 */

import type {
  SnagProjectStats,
  SnagReport,
  Snag,
  SnagPhoto,
  PoleCandidate,
  CreateSnagReportRequest,
  CreateSnagRequest,
  UpdateSnagRequest,
  CreateSnagPhotoRequest,
  SnagFilters,
} from '../types/snag.types';

// ============================================================
// Stats
// ============================================================

export interface SnagSummary {
  total: number;
  open: number;
  in_progress: number;
  resolved: number;
  critical: number;
}

/** Fetch filter-aware 4-bucket count (no status filter — always shows full breakdown). */
export async function fetchSnagSummary(params: {
  projectId?: string;
  category?: string;
  severity?: string;
  search?: string;
}): Promise<SnagSummary> {
  const qs = new URLSearchParams();
  if (params.projectId) qs.set('projectId', params.projectId);
  if (params.category)  qs.set('category',  params.category);
  if (params.severity)  qs.set('severity',  params.severity);
  if (params.search)    qs.set('search',    params.search);
  const res = await fetch(`/api/snags/count-summary?${qs.toString()}`);
  if (!res.ok) throw new Error(`Failed to fetch snag summary: ${res.status}`);
  const json = await res.json() as { data: SnagSummary };
  return json.data;
}

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

/** Delete a snag report (and all its snags/photos via CASCADE). */
export async function deleteSnagReport(id: string): Promise<void> {
  const res = await fetch(`/api/snags/reports?id=${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const err = await res.json() as { error?: { message?: string } };
    throw new Error(err.error?.message ?? 'Failed to delete report');
  }
}

/** Delete a single snag photo record. */
export async function deleteSnagPhoto(id: string): Promise<void> {
  const res = await fetch(`/api/snags/photos?id=${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const err = await res.json() as { error?: { message?: string } };
    throw new Error(err.error?.message ?? 'Failed to delete photo');
  }
}

/** Upload a file directly to VF Storage and insert a snag_photo record. */
export async function uploadSnagPhotoFile(
  file: File,
  snagId: string,
  phase: string
): Promise<SnagPhoto> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('snag_id', snagId);
  formData.append('phase', phase);

  const res = await fetch('/api/snags/upload-photo', {
    method: 'POST',
    body: formData,
  });
  if (!res.ok) {
    const err = await res.json() as { error?: { message?: string } };
    throw new Error(err.error?.message ?? 'Failed to upload photo');
  }
  const json = await res.json() as { data: SnagPhoto };
  return json.data;
}

// ============================================================
// PDF Zero-Touch Import
// ============================================================

/** Preview result from /api/snags/preview-pdf — no DB writes */
export interface PdfPreviewResult {
  metadata: {
    reportNumber: string;
    auditDate: string;
    siteName: string | null;
    address: string | null;
    category: string;
    auditor: string | null;
    client: string | null;
    contractor: string | null;
  };
  project: { id: string; name: string } | null;
  projectCandidates: Array<{ id: string; name: string }>;
  findings: Array<{ number: number; description: string; category: string }>;
  photoCount: number;
  auditScores: {
    qualityAssurance: number;
    qualityNc: number;
    healthAssurance: number;
    healthNc: number;
    safetyAssurance: number;
    safetyNc: number;
    environmentAssurance: number;
    environmentNc: number;
    trafficAssurance: number;
    trafficNc: number;
  };
  isDuplicate: boolean;
  duplicateReportId: string | null;
}

/** POST a PDF to preview endpoint — no DB writes. */
export async function previewPdf(file: File): Promise<PdfPreviewResult> {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch('/api/snags/preview-pdf', { method: 'POST', body: formData });
  if (!res.ok) {
    const err = await res.json() as { error?: { message?: string } };
    throw new Error(err.error?.message ?? 'PDF preview failed');
  }
  const json = await res.json() as { data: PdfPreviewResult };
  return json.data;
}

/** POST a PDF + project_id to import endpoint — writes to DB. */
export async function importPdf(
  file: File,
  projectId: string
): Promise<{ reportId: string; snagCount: number; photoCount: number }> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('project_id', projectId);
  const res = await fetch('/api/snags/import-pdf', { method: 'POST', body: formData });
  if (!res.ok) {
    const err = await res.json() as { error?: { message?: string } };
    throw new Error(err.error?.message ?? 'PDF import failed');
  }
  const json = await res.json() as {
    data: { report: { id: string }; snags: unknown[]; photoCount: number };
  };
  return {
    reportId: json.data.report.id,
    snagCount: json.data.snags.length,
    photoCount: json.data.photoCount,
  };
}

// ============================================================
// NOC Ticket Integration
// ============================================================

/**
 * Create a NOC ticket for a single snag.
 * Returns the created ticket and the updated snag (with noc_ticket_uid).
 */
export async function createNocTicket(
  snagId: string
): Promise<{ ticket: Record<string, unknown>; snag: Snag }> {
  const res = await fetch('/api/snags/create-ticket', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ snag_id: snagId }),
  });
  if (!res.ok) {
    const err = await res.json() as { error?: { message?: string } };
    throw new Error(err.error?.message ?? 'Failed to create NOC ticket');
  }
  const json = await res.json() as { data: { ticket: Record<string, unknown>; snag: Snag } };
  return json.data;
}

/**
 * Create NOC tickets for all open snags in a report.
 * Returns count of tickets created.
 */
export async function createNocTicketsBulk(
  reportId: string
): Promise<{ created: number; skipped: number; errors: number }> {
  const res = await fetch('/api/snags/create-tickets-bulk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ report_id: reportId }),
  });
  if (!res.ok) {
    const err = await res.json() as { error?: { message?: string } };
    throw new Error(err.error?.message ?? 'Failed to bulk-create NOC tickets');
  }
  const json = await res.json() as { data: { created: number; skipped: number; errors: number } };
  return json.data;
}

// ============================================================
// Pole Resolution
// ============================================================

/**
 * Search for pole candidates matching a TQR pole reference.
 * Uses numeric suffix matching on the server.
 */
export async function searchPoles(
  projectId: string,
  poleRef: string
): Promise<PoleCandidate[]> {
  const params = new URLSearchParams({ projectId, poleRef });
  const res = await fetch(`/api/snags/resolve-poles?${params.toString()}`);
  if (!res.ok) throw new Error(`Failed to search poles: ${res.status}`);
  const json = await res.json() as { data: PoleCandidate[] };
  return json.data ?? [];
}

/**
 * Manually link a snag to a specific pole.
 * Updates snag.pole_ids, zone_id, pon_id server-side.
 */
export async function linkSnagToPole(snagId: string, poleId: string): Promise<Snag> {
  const res = await fetch('/api/snags/resolve-poles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ snag_id: snagId, pole_id: poleId }),
  });
  if (!res.ok) {
    const err = await res.json() as { error?: { message?: string } };
    throw new Error(err.error?.message ?? 'Failed to link snag to pole');
  }
  const json = await res.json() as { data: Snag };
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

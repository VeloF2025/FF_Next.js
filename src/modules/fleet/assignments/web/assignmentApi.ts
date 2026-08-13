import type { AssignmentProposalRow, AssignmentRosterEntry, PreviewResult, ProposalConflict } from '../types';
import type { AssignmentOptions } from '../rosterQueries';

interface Envelope<T> { success: boolean; data?: T; error?: { message?: string; details?: { conflicts?: ProposalConflict[] } } }
export class AssignmentApiError extends Error {
  constructor(message: string, public status: number, public conflicts: ProposalConflict[] = []) { super(message); this.name = 'AssignmentApiError'; }
}
async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: 'same-origin', ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } });
  const body = await response.json() as Envelope<T>;
  if (!response.ok || !body.success || body.data === undefined) throw new AssignmentApiError(body.error?.message ?? 'Assignment request failed', response.status, body.error?.details?.conflicts ?? []);
  return body.data;
}
export interface AssignmentPreview extends PreviewResult { excludedStaffIds: string[] }
export const assignmentApi = {
  roster: (query: string) => request<{ items: AssignmentRosterEntry[]; total: number }>(`/api/fleet/assignments?${query}`),
  options: (query: string) => request<AssignmentOptions>(`/api/fleet/assignments/options?${query}`),
  preview: (rows: AssignmentProposalRow[]) => request<AssignmentPreview>('/api/fleet/assignments/preview', { method: 'POST', body: JSON.stringify({ rows }) }),
  commit: (rows: AssignmentProposalRow[], preview: AssignmentPreview, confirmedWarnings: boolean) => request<{ batchId: string }>('/api/fleet/assignments/commit', { method: 'POST', body: JSON.stringify({ rows, fingerprint: preview.fingerprint, confirmedWarnings }) }),
  copyPreview: (assignmentIds: string[], destinationStartDate: string) => request<AssignmentPreview>('/api/fleet/assignments/copy-preview', { method: 'POST', body: JSON.stringify({ assignmentIds, destinationStartDate }) }),
  history: (assignmentId: string) => request<Record<string, unknown>[]>(`/api/fleet/assignments/${assignmentId}/history`),
  update: (assignmentId: string, body: Record<string, unknown>) => request<unknown>(`/api/fleet/assignments/${assignmentId}`, { method: 'PUT', body: JSON.stringify(body) }),
  createSite: (body: Record<string, unknown>) => request<unknown>('/api/fleet/assignments/project-sites', { method: 'POST', body: JSON.stringify(body) }),
};

/**
 * Hooks for Project Overview Tab (PRD-058)
 * Provides data for KPI cards, workflow checklist, and expiring documents
 */

import { useQuery } from '@tanstack/react-query';

// Types (mirrored from API for client-side use)
export interface ProjectRequirement {
  id: string;
  projectId: string;
  requirementType: string;
  requirementName: string;
  description: string | null;
  isCompleted: boolean;
  completedAt: string | null;
  completedBy: string | null;
  documentId: string | null;
  documentUrl: string | null;
  expiryDate: string | null;
  expiryAlertSent: boolean;
  stage: 'pipeline' | 'planning' | 'execution' | 'closure';
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface RequirementsResponse {
  requirements: ProjectRequirement[];
  summary: {
    total: number;
    completed: number;
    pending: number;
    byStage: Record<string, { total: number; completed: number }>;
  };
}

// Types for expiring documents
export type ExpiryUrgency = 'expired' | 'critical' | 'warning' | 'upcoming' | 'ok';

export interface ExpiringDocument {
  id: string;
  source: 'pipeline_approval' | 'contractor_document' | 'agreement' | 'project_requirement' | 'staff_document';
  document_type: string;
  document_name: string;
  expiry_date: string;
  days_until_expiry: number;
  urgency: ExpiryUrgency;
  project_id?: string;
  project_name?: string;
  contractor_id?: string;
  contractor_name?: string;
  staff_id?: string;
  staff_name?: string;
  document_url?: string;
  status?: string;
}

interface ExpiryStats {
  total: number;
  expired: number;
  critical: number;
  warning: number;
  upcoming: number;
}

interface ExpiringDocsResponse {
  stats: ExpiryStats;
  by_urgency: Record<ExpiryUrgency, ExpiringDocument[]>;
  by_source: Record<string, ExpiringDocument[]>;
  all: ExpiringDocument[];
}

interface TeamSummary {
  total: number;
  contractors: number;
  staff: number;
}

interface BudgetSummary {
  totalBudget: number;
  actualSpent: number;
  committed: number;
  percentUsed: number;
  health: 'healthy' | 'warning' | 'critical';
}

/**
 * Fetch project requirements (workflow checklist)
 */
export function useProjectRequirements(projectId: string | undefined, stage?: string) {
  return useQuery<RequirementsResponse>({
    queryKey: ['project-requirements', projectId, stage],
    queryFn: async () => {
      if (!projectId) throw new Error('Project ID required');
      const url = stage
        ? `/api/projects/${projectId}/requirements?stage=${stage}`
        : `/api/projects/${projectId}/requirements`;
      const res = await fetch(url);
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.message || 'Failed to fetch requirements');
      }
      const json = await res.json();
      return json.data || json;
    },
    enabled: !!projectId,
    staleTime: 30_000,
  });
}

/**
 * Fetch expiring documents for a project
 */
export function useProjectExpiringDocs(projectId: string | undefined, days: number = 90) {
  return useQuery<ExpiringDocsResponse>({
    queryKey: ['project-expiring-docs', projectId, days],
    queryFn: async () => {
      if (!projectId) throw new Error('Project ID required');
      const res = await fetch(`/api/projects/expiring-documents?project_id=${projectId}&days=${days}`);
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.message || 'Failed to fetch expiring documents');
      }
      const json = await res.json();
      return json.data || json;
    },
    enabled: !!projectId,
    staleTime: 60_000,
  });
}

/**
 * Fetch team summary for a project
 */
export function useProjectTeamSummary(projectId: string | undefined) {
  return useQuery<TeamSummary>({
    queryKey: ['project-team-summary', projectId],
    queryFn: async () => {
      if (!projectId) throw new Error('Project ID required');
      const res = await fetch(`/api/projects/${projectId}/team`);
      if (!res.ok) {
        return { total: 0, contractors: 0, staff: 0 };
      }
      const json = await res.json();
      const data = json.data || json;
      return {
        total: data.stats?.total || 0,
        contractors: data.stats?.contractors || 0,
        staff: data.stats?.staff || 0,
      };
    },
    enabled: !!projectId,
    staleTime: 60_000,
  });
}

/**
 * Fetch budget summary for a project
 */
export function useProjectBudgetSummary(projectId: string | undefined) {
  return useQuery<BudgetSummary>({
    queryKey: ['project-budget-summary', projectId],
    queryFn: async () => {
      if (!projectId) throw new Error('Project ID required');
      const res = await fetch(`/api/projects/${projectId}/budget`);
      if (!res.ok) {
        // Return defaults if budget API not available
        return {
          totalBudget: 0,
          actualSpent: 0,
          committed: 0,
          percentUsed: 0,
          health: 'healthy' as const,
        };
      }
      const json = await res.json();
      const data = json.data || json;
      // Handle both direct response and summary sub-object
      const summary = data.summary || data;
      const totalBudget = summary.totalBudget || 0;
      const actualSpent = summary.actual || summary.actualSpent || 0;
      const committed = summary.committed || 0;
      const percentUsed = totalBudget > 0
        ? Math.round((actualSpent / totalBudget) * 100)
        : 0;
      return {
        totalBudget,
        actualSpent,
        committed,
        percentUsed,
        health: percentUsed > 90 ? 'critical' : percentUsed > 75 ? 'warning' : 'healthy',
      };
    },
    enabled: !!projectId,
    staleTime: 60_000,
  });
}

/**
 * Mark a requirement as complete
 */
export async function completeRequirement(
  projectId: string,
  requirementId: string,
  documentUrl?: string
): Promise<ProjectRequirement> {
  const res = await fetch(`/api/projects/${projectId}/requirements/${requirementId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      isCompleted: true,
      documentUrl,
    }),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.message || 'Failed to complete requirement');
  }

  const json = await res.json();
  return json.data?.requirement || json.requirement;
}

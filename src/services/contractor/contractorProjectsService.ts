/**
 * Contractor Projects Service
 * Frontend service for managing contractor assignments to projects
 */

import type {
  ContractorProject,
  ContractorProjectWithDetails,
  ContractorProjectFormData,
  ContractorProjectUpdateData,
  ContractorProjectFilter,
} from '@/types/contractor-project.types';

const API_BASE = '/api/contractors-projects';

// ==================== GET - List Assignments ====================

export async function getContractorProjects(
  filter: ContractorProjectFilter
): Promise<ContractorProjectWithDetails[]> {
  const params = new URLSearchParams();

  if (filter.contractorId) params.append('contractorId', filter.contractorId);
  if (filter.projectId) params.append('projectId', filter.projectId);
  if (filter.assignmentStatus && filter.assignmentStatus.length > 0) {
    params.append('assignmentStatus', filter.assignmentStatus[0]!); // Take first status for now
  }
  if (filter.isActive !== undefined) params.append('isActive', String(filter.isActive));

  const response = await fetch(`${API_BASE}?${params.toString()}`);

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Request failed' }));
    throw new Error(error.message || error.error || `HTTP ${response.status}`);
  }

  const data = await response.json();
  return data.data || data;
}

/**
 * Get all projects for a specific contractor
 */
export async function getContractorProjectsByContractor(
  contractorId: string
): Promise<ContractorProjectWithDetails[]> {
  return getContractorProjects({ contractorId });
}

/**
 * Get all contractors assigned to a specific project
 */
export async function getContractorsByProject(
  projectId: string
): Promise<ContractorProjectWithDetails[]> {
  return getContractorProjects({ projectId });
}

/**
 * Get only active assignments for a contractor
 */
export async function getActiveContractorProjects(
  contractorId: string
): Promise<ContractorProjectWithDetails[]> {
  return getContractorProjects({ contractorId, isActive: true });
}

// ==================== POST - Create Assignment ====================

export async function createContractorProject(
  data: ContractorProjectFormData
): Promise<ContractorProject> {
  const response = await fetch(API_BASE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Request failed' }));
    throw new Error(error.message || error.error || `HTTP ${response.status}`);
  }

  const result = await response.json();
  return result.data || result;
}

// ==================== PUT - Update Assignment ====================

export async function updateContractorProject(
  id: number,
  data: ContractorProjectUpdateData
): Promise<ContractorProject> {
  const response = await fetch(`${API_BASE}-update?id=${id}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Request failed' }));
    throw new Error(error.message || error.error || `HTTP ${response.status}`);
  }

  const result = await response.json();
  return result.data || result;
}

// ==================== DELETE - Remove Assignment ====================

export async function deleteContractorProject(
  id: number,
  removedBy?: string,
  removalReason?: string,
  hardDelete = false
): Promise<void> {
  const response = await fetch(`${API_BASE}-delete?id=${id}`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      removedBy,
      removalReason,
      hardDelete,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Request failed' }));
    throw new Error(error.message || error.error || `HTTP ${response.status}`);
  }
}

/**
 * Soft delete - marks assignment as inactive and removed
 */
export async function removeContractorProject(
  id: number,
  removedBy?: string,
  removalReason?: string
): Promise<void> {
  return deleteContractorProject(id, removedBy, removalReason, false);
}

/**
 * Hard delete - permanently removes the assignment
 */
export async function permanentlyDeleteContractorProject(id: number): Promise<void> {
  return deleteContractorProject(id, undefined, undefined, true);
}

// ==================== HELPER FUNCTIONS ====================

/**
 * Mark assignment as completed
 */
export async function completeContractorProject(
  id: number,
  actualEndDate?: Date,
  performanceRating?: number,
  actualHours?: number
): Promise<ContractorProject> {
  return updateContractorProject(id, {
    assignmentStatus: 'completed',
    actualEndDate: actualEndDate || new Date(),
    performanceRating,
    actualHours,
  });
}

/**
 * Activate an assignment (change status to active)
 */
export async function activateContractorProject(id: number): Promise<ContractorProject> {
  return updateContractorProject(id, {
    assignmentStatus: 'active',
    isActive: true,
  });
}

/**
 * Suspend an assignment
 */
export async function suspendContractorProject(
  id: number,
  reason?: string
): Promise<ContractorProject> {
  return updateContractorProject(id, {
    assignmentStatus: 'suspended',
    notes: reason,
  });
}

/**
 * Update performance metrics
 */
export async function updatePerformanceMetrics(
  id: number,
  metrics: {
    performanceRating?: number;
    qualityScore?: number;
    safetyIncidents?: number;
    actualHours?: number;
  }
): Promise<ContractorProject> {
  return updateContractorProject(id, metrics);
}

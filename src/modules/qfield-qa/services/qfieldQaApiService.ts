/**
 * QField QA API Service
 */

import type {
  PhotoValidation,
  QAStats,
  QAProject,
  QAAssignment,
  QAFilters,
  ActionRequest,
} from '../types';

const BASE_URL = '/api/qfield';

interface PaginatedResponse<T> {
  success: boolean;
  data: T[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

interface ActionResult {
  action: string;
  total: number;
  success: number;
  failed: number;
  results: Array<{ id: string; success: boolean; error?: string }>;
}

export const qfieldQaApiService = {
  /**
   * Get photo validations with filtering and pagination
   */
  async getValidations(filters: QAFilters = {}): Promise<PaginatedResponse<PhotoValidation>> {
    const params = new URLSearchParams();

    if (filters.projectId) params.set('projectId', filters.projectId);
    if (filters.workType) params.set('workType', filters.workType);
    if (filters.workflowStatus) params.set('workflowStatus', filters.workflowStatus);
    if (filters.assignedTo) params.set('assignedTo', filters.assignedTo);
    if (filters.priority) params.set('priority', filters.priority);
    if (filters.needsRetake !== undefined) params.set('needsRetake', String(filters.needsRetake));
    if (filters.search) params.set('search', filters.search);
    if (filters.page) params.set('page', String(filters.page));
    if (filters.pageSize) params.set('pageSize', String(filters.pageSize));

    const response = await fetch(`${BASE_URL}/qa-validations?${params.toString()}`);
    if (!response.ok) throw new Error('Failed to fetch validations');
    return response.json();
  },

  /**
   * Get a single validation by ID
   */
  async getValidation(id: string): Promise<ApiResponse<PhotoValidation>> {
    const response = await fetch(`${BASE_URL}/qa-validations?validationId=${id}`);
    if (!response.ok) throw new Error('Failed to fetch validation');
    const data = await response.json();
    return { success: true, data: data.data[0] };
  },

  /**
   * Get QA statistics
   */
  async getStats(projectId?: string): Promise<ApiResponse<QAStats>> {
    const params = projectId ? `?projectId=${projectId}` : '';
    const response = await fetch(`${BASE_URL}/qa-stats${params}`);
    if (!response.ok) throw new Error('Failed to fetch stats');
    return response.json();
  },

  /**
   * Get QField projects
   */
  async getProjects(): Promise<ApiResponse<QAProject[]>> {
    const response = await fetch(`${BASE_URL}/qa-projects`);
    if (!response.ok) throw new Error('Failed to fetch projects');
    return response.json();
  },

  /**
   * Get assignments
   */
  async getAssignments(params: {
    assignee?: string;
    validationId?: string;
    pending?: boolean;
  } = {}): Promise<ApiResponse<QAAssignment[]>> {
    const searchParams = new URLSearchParams();
    if (params.assignee) searchParams.set('assignee', params.assignee);
    if (params.validationId) searchParams.set('validationId', params.validationId);
    if (params.pending !== undefined) searchParams.set('pending', String(params.pending));

    const response = await fetch(`${BASE_URL}/qa-assignments?${searchParams.toString()}`);
    if (!response.ok) throw new Error('Failed to fetch assignments');
    return response.json();
  },

  /**
   * Execute QA action (approve, reject, escalate, assign, revalidate)
   */
  async executeAction(request: ActionRequest): Promise<ApiResponse<ActionResult>> {
    const response = await fetch(`${BASE_URL}/qa-actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    if (!response.ok) throw new Error('Failed to execute action');
    return response.json();
  },

  /**
   * Trigger VLM validation for photos
   */
  async triggerValidation(params: {
    validationIds?: string[];
    photoKeys?: string[];
    workType?: string;
  }): Promise<ApiResponse<ActionResult>> {
    const response = await fetch(`${BASE_URL}/qa-validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    if (!response.ok) throw new Error('Failed to trigger validation');
    return response.json();
  },

  /**
   * Assign photos to reviewer
   */
  async assignPhotos(params: {
    validationIds: string[];
    assignee: string;
    dueDate?: string;
    priority?: string;
    notes?: string;
  }): Promise<ApiResponse<ActionResult>> {
    const response = await fetch(`${BASE_URL}/qa-assignments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    if (!response.ok) throw new Error('Failed to assign photos');
    return response.json();
  },

  /**
   * Get photo proxy URL
   */
  getPhotoUrl(photoKey: string): string {
    return `${BASE_URL}/photo-proxy?key=${encodeURIComponent(photoKey)}`;
  },
};

export default qfieldQaApiService;

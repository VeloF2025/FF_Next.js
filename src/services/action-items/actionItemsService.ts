/**
 * Action Items Service
 * Frontend service for action items API
 */

import {
  ActionItem,
  ActionItemCreateInput,
  ActionItemUpdateInput,
  ActionItemFilters,
  ActionItemStats,
} from '@/types/action-items.types';

const API_BASE = '/api/action-items';

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Request failed' }));
    throw new Error(error.message || error.error || `HTTP ${response.status}`);
  }

  const data = await response.json();
  return data.data || data;
}

export const actionItemsService = {
  /**
   * Fetch action items with optional filters.
   * Supports new fields: source_type, assigned_to_user_id, project_id (migration 256).
   */
  async getActionItems(filters?: ActionItemFilters): Promise<ActionItem[]> {
    const params = new URLSearchParams();

    if (filters?.status) {
      const statuses = Array.isArray(filters.status)
        ? filters.status.join(',')
        : filters.status;
      params.append('status', statuses);
    }
    if (filters?.assignee_name) params.append('assignee_name', filters.assignee_name);
    if (filters?.meeting_id) params.append('meeting_id', filters.meeting_id.toString());
    if (filters?.priority) params.append('priority', filters.priority);
    if (filters?.search) params.append('search', filters.search);
    if (filters?.overdue) params.append('overdue', 'true');

    // New filters (migration 256)
    if (filters?.assigned_to_user_id) {
      params.append('assigned_to_user_id', filters.assigned_to_user_id);
    }
    if (filters?.source_type) params.append('source_type', filters.source_type);
    if (filters?.project_id) params.append('project_id', filters.project_id);

    const url = params.toString() ? `${API_BASE}?${params}` : API_BASE;
    const response = await fetch(url);
    return handleResponse<ActionItem[]>(response);
  },

  /**
   * Fetch action items assigned to the currently authenticated user.
   * Matches on assigned_to_user_id and legacy assignee_email.
   */
  async getMyItems(): Promise<ActionItem[]> {
    const response = await fetch(`${API_BASE}/my-items`);
    return handleResponse<ActionItem[]>(response);
  },

  /**
   * Get action item by ID
   */
  async getActionItem(id: string): Promise<ActionItem> {
    const response = await fetch(`${API_BASE}/${id}`);
    return handleResponse<ActionItem>(response);
  },

  /**
   * Create new action item
   */
  async createActionItem(input: ActionItemCreateInput): Promise<ActionItem> {
    const response = await fetch(API_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    return handleResponse<ActionItem>(response);
  },

  /**
   * Update action item
   */
  async updateActionItem(id: string, updates: ActionItemUpdateInput): Promise<ActionItem> {
    const response = await fetch(`${API_BASE}/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    return handleResponse<ActionItem>(response);
  },

  /**
   * Delete action item
   */
  async deleteActionItem(id: string): Promise<void> {
    const response = await fetch(`${API_BASE}/${id}`, {
      method: 'DELETE',
    });
    await handleResponse<void>(response);
  },

  /**
   * Get action items statistics (includes source breakdown from migration 256)
   */
  async getStats(): Promise<ActionItemStats> {
    const response = await fetch(`${API_BASE}/stats`);
    return handleResponse<ActionItemStats>(response);
  },

  /**
   * Extract action items from a meeting
   */
  async extractFromMeeting(meeting_id: number): Promise<ActionItem[]> {
    const response = await fetch(`${API_BASE}/extract`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ meeting_id }),
    });
    return handleResponse<ActionItem[]>(response);
  },

  /**
   * Mark action item as completed
   */
  async markCompleted(id: string): Promise<ActionItem> {
    return this.updateActionItem(id, {
      status: 'completed',
      completed_date: new Date().toISOString(),
    });
  },

  /**
   * Update action item status
   */
  async updateStatus(id: string, status: ActionItem['status']): Promise<ActionItem> {
    return this.updateActionItem(id, { status });
  },
};

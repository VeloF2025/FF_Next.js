/**
 * Action Items Types
 * Extracted from Fireflies meeting summaries and other module sources.
 * Table: action_items (renamed from meeting_action_items in migration 256)
 */

export type ActionItemStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';
export type ActionItemPriority = 'low' | 'medium' | 'high' | 'urgent';
export type ActionItemSourceType =
  | 'meeting'
  | 'procurement'
  | 'noc'
  | 'hns'
  | 'qa'
  | 'project'
  | 'manual';

export interface ActionItem {
  id: string;
  meeting_id: number;

  // Core fields
  description: string;
  assignee_name?: string;
  assignee_email?: string;
  status: ActionItemStatus;
  priority: ActionItemPriority;

  // User linking (migration 256)
  assigned_to_user_id?: string;
  source_type?: ActionItemSourceType;
  source_id?: string;
  project_id?: string;
  category?: string;

  // Timestamps
  due_date?: string;
  completed_date?: string;
  mentioned_at?: string; // e.g., "16:17" - timestamp in meeting

  // Tracking
  created_at: string;
  updated_at: string;
  created_by?: string;
  completed_by?: string;

  // Metadata
  tags?: string[];
  notes?: string;

  // Joined data (from meetings table)
  meeting_title?: string;
  meeting_date?: string;
  transcript_url?: string;

  // Joined data (from users table)
  assigned_user_name?: string;
  assigned_user_avatar?: string;
}

export interface ActionItemCreateInput {
  meeting_id?: number;
  description: string;
  assignee_name?: string;
  assignee_email?: string;
  status?: ActionItemStatus;
  priority?: ActionItemPriority;
  due_date?: string;
  mentioned_at?: string;
  tags?: string[];
  notes?: string;

  // User linking (migration 256)
  assigned_to_user_id?: string;
  source_type?: ActionItemSourceType;
  source_id?: string;
  project_id?: string;
  category?: string;
}

export interface ActionItemUpdateInput {
  description?: string;
  assignee_name?: string;
  assignee_email?: string;
  status?: ActionItemStatus;
  priority?: ActionItemPriority;
  due_date?: string;
  completed_date?: string;
  tags?: string[];
  notes?: string;
}

export interface ActionItemFilters {
  status?: ActionItemStatus | ActionItemStatus[];
  assignee_name?: string;
  meeting_id?: number;
  priority?: ActionItemPriority;
  search?: string;
  overdue?: boolean;

  // User linking filters (migration 256)
  assigned_to_user_id?: string;
  source_type?: string;
  project_id?: string;
}

export interface ActionItemStats {
  total: number;
  pending: number;
  in_progress: number;
  completed: number;
  overdue: number;

  // Source breakdown (migration 256)
  from_meetings?: number;
  from_procurement?: number;
  from_noc?: number;
  user_linked?: number;
}

// For parsing Fireflies action items text
export interface ParsedActionItem {
  assignee: string;
  description: string;
  mentioned_at?: string;
}

export type MancoActionItemStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

export interface MancoActionItem {
  id: string;
  action_item: string;
  department?: string;
  logged_date?: string;
  completion_eta?: string;
  completion_date?: string;
  responsible_person?: string;
  fibreflow_dev: boolean;
  fibreflow_module?: string;
  fibreflow_link?: string;
  fibreflow_responsible?: string;
  fibreflow_priority?: string;
  fibreflow_dev_status?: string;
  comment?: string;
  reference_link?: string;
  document_url?: string;
  document_name?: string;
  status: MancoActionItemStatus;
  is_ongoing: boolean;
  source_meeting_id?: number;
  created_at: string;
  updated_at: string;
}

export interface MancoActionItemComment {
  id: string;
  manco_action_item_id: string;
  author_name: string;
  author_user_id?: string;
  content: string;
  created_at: string;
}

export interface MancoActionItemFilters {
  status?: MancoActionItemStatus;
  department?: string;
  responsible_person?: string;
  search?: string;
}

export interface MancoActionItemStats {
  /** All items (excluding ongoing) */
  total: number;
  pending: number;
  in_progress: number;
  completed: number;
  overdue: number;
  /** Ongoing items (shown only on the ONGOING tab) */
  ongoing: number;
}

export interface MancoMeetingContext {
  meeting: {
    id: number;
    title: string;
    meeting_date: string;
  } | null;
  excerpts: Array<{
    timestamp: string;
    speaker: string;
    text: string;
  }>;
  summary: {
    overview: string;
    decisions: string[];
    action_items: string[];
  } | null;
}

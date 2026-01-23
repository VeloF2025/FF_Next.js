/**
 * Wishlist Module Types
 */

export type WishlistPriority = 'low' | 'medium' | 'high';
export type WishlistEffort = 'XS' | 'S' | 'M' | 'L' | 'XL';
export type WishlistStatus = 'Backlog' | 'Under Review' | 'Approved' | 'POC Validation' | 'Building' | 'Done';
export type WishlistWorkType = 'feature' | 'fix' | 'amendment' | 'refactor';
export type PocStatus = 'pending' | 'running' | 'passed' | 'failed';

export interface WishlistColumn {
  id: string;
  name: string;
  position: number;
  color?: string;
  wip_limit?: number;
  items: WishlistItem[];
  created_at: string;
  updated_at: string;
}

export type MvpBuildStatus = 'pending' | 'building' | 'complete' | 'failed';

export interface WishlistItem {
  id: string;
  title: string;
  description?: string;
  status: WishlistStatus;
  column_position: number;
  priority: WishlistPriority;
  effort_estimate?: WishlistEffort;
  work_type?: WishlistWorkType;
  business_value?: number;
  votes: number;
  created_by?: string;
  created_by_name?: string;
  creator_email?: string;
  assigned_to?: string;
  assigned_to_name?: string;
  created_at: string;
  updated_at: string;
  // Agent OS Spec fields
  problem_statement?: string;
  acceptance_criteria?: string;
  target_module?: string;
  test_scenarios?: string;
  // MVP Pipeline fields
  github_issue_url?: string;
  github_pr_url?: string;
  build_status?: MvpBuildStatus;
  build_progress?: number;
  build_started_at?: string;
  build_completed_at?: string;
  build_error?: string;
  // 2-Stage Pipeline fields
  poc_status?: PocStatus;
  poc_run_id?: string;
  harness_run_id?: string;
  pr_url?: string;
  // UI state
  has_voted?: boolean;
  comments_count?: number;
  attachments_count?: number;
}

export interface WishlistVote {
  id: string;
  item_id: string;
  user_id: string;
  user_name?: string;
  vote_date: string;
}

export interface WishlistComment {
  id: string;
  item_id: string;
  user_id: string;
  user_name?: string;
  comment: string;
  created_at: string;
}

export type WishlistAttachmentType = 'image' | 'url' | 'file';

export interface WishlistAttachment {
  id: string;
  item_id: string;
  type: WishlistAttachmentType;
  url: string;
  filename?: string;
  file_size?: number;
  mime_type?: string;
  uploaded_by: string;
  uploaded_by_name?: string;
  created_at: string;
}

export interface WishlistBoard {
  columns: WishlistColumn[];
  stats: WishlistStats;
}

export interface WishlistStats {
  total: number;
  totalVotes: number;
  inProgress: number;
  completed: number;
  byPriority: {
    low: number;
    medium: number;
    high: number;
  };
  byStatus: {
    [key in WishlistStatus]: number;
  };
}

// Form types
export interface CreateWishlistItemInput {
  title: string;
  description?: string;
  priority?: WishlistPriority;
  effort_estimate?: WishlistEffort;
  work_type?: WishlistWorkType;
  business_value?: number;
  // Agent OS Spec fields
  problem_statement?: string;
  acceptance_criteria?: string;
  target_module?: string;
  test_scenarios?: string;
}

export interface UpdateWishlistItemInput {
  title?: string;
  description?: string;
  status?: WishlistStatus;
  priority?: WishlistPriority;
  effort_estimate?: WishlistEffort;
  work_type?: WishlistWorkType;
  business_value?: number;
  assigned_to?: string;
  assigned_to_name?: string;
  // Agent OS Spec fields
  problem_statement?: string;
  acceptance_criteria?: string;
  target_module?: string;
  test_scenarios?: string;
}

export interface MoveWishlistItemInput {
  itemId: string;
  targetColumn: string;
  position: number;
}

// API Response types
export interface WishlistApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}
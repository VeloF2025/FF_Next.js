/**
 * Wishlist Module Types
 */

export type WishlistPriority = 'low' | 'medium' | 'high';
export type WishlistEffort = 'XS' | 'S' | 'M' | 'L' | 'XL';
export type WishlistStatus = 'Backlog' | 'Under Review' | 'Approved' | 'In Progress' | 'Testing' | 'Completed';

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

export interface WishlistItem {
  id: string;
  title: string;
  description?: string;
  status: WishlistStatus;
  column_position: number;
  priority: WishlistPriority;
  effort_estimate?: WishlistEffort;
  business_value?: number;
  votes: number;
  created_by?: string;
  created_by_name?: string;
  assigned_to?: string;
  assigned_to_name?: string;
  created_at: string;
  updated_at: string;
  // Agent OS Spec fields
  problem_statement?: string;
  acceptance_criteria?: string;
  target_module?: string;
  test_scenarios?: string;
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
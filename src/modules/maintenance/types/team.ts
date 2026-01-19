/**
 * Team Types for Ticketing Module
 *
 * Supports both internal (Velocity Fibre) teams and contractor teams.
 */

/**
 * Team type enumeration
 */
export enum TeamType {
  INTERNAL = 'internal',
  CONTRACTOR = 'contractor',
  FIELD = 'field',
  SUPPORT = 'support',
  MAINTENANCE = 'maintenance',
  INSTALLATION = 'installation',
}

/**
 * Core Team interface matching database schema
 */
export interface Team {
  id: string;
  name: string;
  description: string | null;
  team_type: TeamType | string;
  lead_user_id: string | null;
  contractor_id: string | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
  // Enriched fields from joins
  lead_user?: {
    id: string;
    name: string;
    email: string;
  };
  member_count?: number;
}

/**
 * Team member interface
 */
export interface TeamMember {
  id: string;
  team_id: string;
  user_id: string | null;       // For internal team members
  contractor_id: string | null;  // For contractor team members
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  role: string | null;
  skill_level: string | null;
  is_active: boolean;
  is_team_lead: boolean;
  created_at: Date;
  updated_at: Date;
}

/**
 * Team dropdown option for selectors
 */
export interface TeamDropdownOption {
  id: string;
  name: string;
  type: 'internal' | 'contractor';
  team_type: string;
  member_count: number;
  lead_name?: string;
  contractor_name?: string;
}

/**
 * User dropdown option for assignment selector
 */
export interface UserDropdownOption {
  id: string;
  name: string;
  email: string;
  role: string | null;
  department: string | null;
}

/**
 * Create team payload
 */
export interface CreateTeamPayload {
  name: string;
  description?: string;
  team_type: TeamType | string;
  lead_user_id?: string;
  contractor_id?: string;
}

/**
 * Update team payload
 */
export interface UpdateTeamPayload {
  name?: string;
  description?: string;
  team_type?: TeamType | string;
  lead_user_id?: string;
  contractor_id?: string;
  is_active?: boolean;
}

/**
 * Team filters for listing
 */
export interface TeamFilters {
  team_type?: TeamType | string;
  contractor_id?: string;
  is_active?: boolean;
  search?: string;
}

/**
 * Add team member payload
 */
export interface AddTeamMemberPayload {
  team_id: string;
  user_id?: string;
  contractor_id?: string;
  first_name: string;
  last_name: string;
  email?: string;
  phone?: string;
  role?: string;
  skill_level?: string;
  is_team_lead?: boolean;
}

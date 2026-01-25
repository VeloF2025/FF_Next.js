/**
 * Pipeline Service Authority Types
 * Contacts database for service providers per municipality
 */

// ============================================================================
// Core Types
// ============================================================================

export interface ServiceAuthority {
  id: string;
  approval_type_id: string;

  // Location
  province: string | null;
  municipality: string | null;
  region: string | null;

  // Authority Details
  authority_name: string;
  department: string | null;

  // Contact Information
  contact_name: string | null;
  contact_title: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  contact_mobile: string | null;

  // Address
  physical_address: string | null;
  postal_address: string | null;

  // Office Details
  office_hours: string | null;
  website: string | null;

  // Processing Info
  typical_turnaround_days: number | null;
  application_fee: number | null;
  notes: string | null;

  // Status
  is_active: boolean;
  verified_at: string | null;
  verified_by: string | null;

  // Audit
  created_at: string;
  created_by: string | null;
  updated_at: string;
  updated_by: string | null;
}

// ============================================================================
// Extended Types (with joins)
// ============================================================================

export interface ServiceAuthorityWithType extends ServiceAuthority {
  approval_type_name?: string;
  approval_type_code?: string;
  approval_type_category?: string;
}

// ============================================================================
// Form Types
// ============================================================================

export interface CreateServiceAuthorityInput {
  approval_type_id: string;
  province?: string;
  municipality?: string;
  region?: string;
  authority_name: string;
  department?: string;
  contact_name?: string;
  contact_title?: string;
  contact_email?: string;
  contact_phone?: string;
  contact_mobile?: string;
  physical_address?: string;
  postal_address?: string;
  office_hours?: string;
  website?: string;
  typical_turnaround_days?: number;
  application_fee?: number;
  notes?: string;
  created_by?: string;
}

export interface UpdateServiceAuthorityInput {
  approval_type_id?: string;
  province?: string | null;
  municipality?: string | null;
  region?: string | null;
  authority_name?: string;
  department?: string | null;
  contact_name?: string | null;
  contact_title?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  contact_mobile?: string | null;
  physical_address?: string | null;
  postal_address?: string | null;
  office_hours?: string | null;
  website?: string | null;
  typical_turnaround_days?: number | null;
  application_fee?: number | null;
  notes?: string | null;
  is_active?: boolean;
  updated_by?: string;
}

// ============================================================================
// Query Types
// ============================================================================

export interface ServiceAuthorityFilters {
  search?: string;
  approval_type_id?: string;
  province?: string;
  municipality?: string;
  is_active?: boolean;
}

export interface ServiceAuthorityQueryParams {
  filters?: ServiceAuthorityFilters;
  page?: number;
  limit?: number;
}

export interface ServiceAuthorityListResponse {
  authorities: ServiceAuthorityWithType[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// ============================================================================
// Search Types
// ============================================================================

export interface ServiceAuthoritySearchResult {
  id: string;
  authority_name: string;
  department: string | null;
  municipality: string | null;
  province: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  typical_turnaround_days: number | null;
  application_fee: number | null;
}

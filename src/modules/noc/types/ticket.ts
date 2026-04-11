/**
 * Maintenance Module - Core Ticket Types
 * 🟢 WORKING: Type definitions match database schema from migrations
 *
 * Defines TypeScript types for maintenance tickets, status tracking, priorities,
 * fault attribution, and all ticket-related enums.
 */

/**
 * DR (Drop) Lookup Result
 * Result from querying SOW module for DR details
 * 🟢 WORKING: Type definition for DR lookup service response
 */
export interface DRLookupData {
  dr_number: string;
  pole_number: string | null;
  pon_number: number | null;
  zone_number: number | null;
  project_id: string | null;
  project_name: string | null;
  project_code: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  municipality: string | null;
  cable_type: string | null;
  cable_length: string | null;
  status: string | null;
}

export interface DRLookupResult {
  success: boolean;
  data: DRLookupData | null;
  error?: string;
}

/**
 * Ticket Source - Where the ticket originated from
 */
export enum TicketSource {
  QCONTACT = 'qcontact',
  WEEKLY_REPORT = 'weekly_report',
  CONSTRUCTION = 'construction',
  AD_HOC = 'ad_hoc',
  INCIDENT = 'incident',
  REVENUE = 'revenue',
  ONT_SWAP = 'ont_swap',
  MANUAL = 'manual', // Manually created tickets via UI
  OFFLINE_REPORT = 'offline_report', // From Offline Devices (ARCH) report
  QA_REVIEW = 'qa_review', // From QA Centre review process
  HSE_REPORT = 'hse_report', // From Health & Safety module
  WA_MAINTENANCE = 'wa_maintenance', // From WhatsApp maintenance tracking group
  PP_DATA = 'pp_data', // From PP Data investigation
  OLT_MISMATCH = 'olt_mismatch', // From OLT report serial mismatch
  DEV_OPS = 'dev_ops', // FibreFlow application issues
  SNAGS = 'snags', // From TQR snag reports
}

/**
 * Ticket Type — which discipline resolves the ticket.
 *
 * Five-value vocabulary introduced by the April-11 two-axis taxonomy refactor
 * (PR 2 / migration 278, shrunk to these values by PR 4 / migration 279).
 * Each value is the auto-assign key for the teams.discipline column.
 *
 * The complementary axis (what *kind* of ticket) is TicketCategory, stored in
 * maintenance_tickets.ticket_category.
 */
export enum TicketType {
  CIVILS = 'civils',
  OPTICAL = 'optical',
  ACTIVATIONS = 'activations',
  MAINTENANCE = 'maintenance',
  DEV_OPS = 'dev_ops',
  UNSPECIFIED = 'unspecified',
}

/**
 * Ticket Category — the "what kind of ticket" axis of the two-axis taxonomy.
 *
 * Persisted to maintenance_tickets.ticket_category (added by migration 277).
 * Manual form creation and auto-ingest pipelines both write one of these
 * values. The complementary axis, TicketType, stores which discipline team
 * resolves the ticket.
 */
export enum TicketCategory {
  MAINTENANCE = 'maintenance',
  SNAG = 'snag',
  HSE_INCIDENT = 'hse_incident',
  DEV_OPS = 'dev_ops',
  SALES_LEAD = 'sales_lead',
  UNSPECIFIED = 'unspecified',
}


/**
 * Ticket Priority Levels
 */
export enum TicketPriority {
  LOW = 'low',
  NORMAL = 'normal',
  HIGH = 'high',
  URGENT = 'urgent',
  CRITICAL = 'critical',
}

/**
 * Ticket Status - Workflow states
 */
export enum TicketStatus {
  OPEN = 'open',
  ASSIGNED = 'assigned',
  IN_PROGRESS = 'in_progress',
  PENDING_QA = 'pending_qa',
  QA_IN_PROGRESS = 'qa_in_progress',
  QA_REJECTED = 'qa_rejected',
  QA_APPROVED = 'qa_approved',
  PENDING_HANDOVER = 'pending_handover',
  HANDED_TO_OPS = 'handed_to_ops', // Renamed from HANDED_TO_MAINTENANCE
  RESOLVED = 'resolved', // Work completed, pending formal closure
  VERIFIED = 'verified',
  CLOSED = 'closed',
  CANCELLED = 'cancelled',
}

/**
 * Fault Cause Categories - 7 attribution types
 * Critical for preventing blanket contractor blame
 */
export enum FaultCause {
  WORKMANSHIP = 'workmanship',
  MATERIAL_FAILURE = 'material_failure',
  CLIENT_DAMAGE = 'client_damage',
  THIRD_PARTY = 'third_party',
  ENVIRONMENTAL = 'environmental',
  VANDALISM = 'vandalism',
  UNKNOWN = 'unknown',
}

/**
 * Guarantee Status
 */
export enum GuaranteeStatus {
  UNDER_GUARANTEE = 'under_guarantee',
  OUT_OF_GUARANTEE = 'out_of_guarantee',
  PENDING_CLASSIFICATION = 'pending_classification',
}

/**
 * GPS Coordinates
 */
export interface GPSCoordinates {
  latitude: number;
  longitude: number;
}

/**
 * Core Ticket Interface
 * Matches tickets table schema exactly
 */
export interface Ticket {
  // Primary identification
  id: string; // UUID
  ticket_uid: string; // e.g., FT406824

  // Source tracking
  source: TicketSource;
  external_id: string | null; // QContact ticket ID, report line ID, etc.

  // Core fields
  title: string;
  description: string | null;
  ticket_type: TicketType;
  /**
   * T1 — what KIND of ticket this is. Added by migration 277 as
   * `ticket_category` (not `category`) because maintenance_tickets already
   * has a `category` column for QContact's category hierarchy.
   */
  ticket_category: TicketCategory | null;
  priority: TicketPriority;
  status: TicketStatus;

  // Contact Information (from QContact)
  client_name: string | null;
  client_contact: string | null; // Phone number
  client_email: string | null;

  // Location
  dr_number: string | null;
  project_id: string | null; // UUID reference to projects
  zone_id: string | null; // UUID
  pole_number: string | null;
  pon_number: string | null;
  address: string | null;
  gps_coordinates: GPSCoordinates | null;

  // Equipment
  ont_serial: string | null;
  ont_rx_level: number | null; // Fiber power level in dBm
  ont_model: string | null;

  // Assignment
  assigned_to: string | null; // UUID reference to users
  assigned_contractor_id: string | null; // UUID reference to contractors
  assigned_team: string | null; // Legacy text field
  assigned_team_id: string | null; // UUID reference to teams table

  // Guarantee
  guarantee_status: GuaranteeStatus | null;
  guarantee_expires_at: Date | null;
  is_billable: boolean | null;
  billing_classification: string | null;

  // Verification (QA Readiness)
  qa_ready: boolean;
  qa_readiness_check_at: Date | null;
  qa_readiness_failed_reasons: string[] | null; // JSONB array

  // Fault Attribution
  fault_cause: FaultCause | null;
  fault_cause_details: string | null;

  // Rectification tracking
  rectification_count: number;

  // SLA
  sla_due_at: Date | null;
  sla_first_response_at: Date | null;
  sla_breached: boolean;

  // Timestamps
  created_at: Date;
  created_by: string | null; // UUID reference to users
  updated_at: Date;
  closed_at: Date | null;
  closed_by: string | null; // UUID reference to users

  // Joined fields (from list/detail queries)
  assigned_user?: { id: string; name: string; email: string } | null;
  created_user?: { id: string; name: string } | null;
  assigned_team_name?: string | null;
}

/**
 * Ticket creation payload - required fields only
 */
export interface CreateTicketPayload {
  source: TicketSource;
  title: string;
  ticket_type: TicketType;
  description?: string;
  priority?: TicketPriority;
  external_id?: string;
  dr_number?: string;
  project_id?: string;
  zone_id?: string;
  pole_number?: string;
  pon_number?: string;
  address?: string;
  assigned_to?: string;
  assigned_contractor_id?: string;
  assigned_team?: string;
  assigned_team_id?: string;
  created_by?: string;
  ont_serial?: string;
  /** Override UID prefix (default: 'VF'). E.g. 'HS' → HS-20260301-001 */
  uid_prefix?: string;
  /** Override initial status (default: 'open') */
  status?: TicketStatus;
  /** H&S source_type field for sub-type filtering */
  source_type?: string;
  /** Client info */
  client_name?: string;
  client_contact?: string;
  client_email?: string;
  // DevOps fields (dev_ops tickets only)
  error_url?: string;
  stack_trace?: string;
  affected_module?: string;
  environment?: 'production' | 'dev' | 'local';
  steps_to_reproduce?: string;
  browser_info?: string;
  /**
   * T1 category — what kind of ticket. Stored in
   * maintenance_tickets.ticket_category (added by migration 277).
   */
  ticket_category?: TicketCategory | string;
}

/**
 * Ticket update payload - all fields optional
 */
export interface UpdateTicketPayload {
  title?: string;
  description?: string;
  status?: TicketStatus;
  priority?: TicketPriority;
  assigned_to?: string | null;
  assigned_contractor_id?: string | null;
  assigned_team?: string | null;
  assigned_team_id?: string | null;
  dr_number?: string;
  project_id?: string;
  zone_id?: string;
  pole_number?: string;
  pon_number?: string;
  address?: string;
  gps_coordinates?: GPSCoordinates;
  ont_serial?: string;
  ont_rx_level?: number;
  ont_model?: string;
  guarantee_status?: GuaranteeStatus;
  guarantee_expires_at?: Date;
  is_billable?: boolean;
  billing_classification?: string;
  fault_cause?: FaultCause;
  fault_cause_details?: string;
  qa_ready?: boolean;
  sla_due_at?: Date;
  sla_first_response_at?: Date;
  sla_breached?: boolean;
}

/** Meta-status groups used by Active/Completed sub-tabs */
export type TicketStatusGroup = 'active' | 'completed';

/**
 * Ticket list filters
 */
export interface TicketFilters {
  status?: TicketStatus | TicketStatus[] | TicketStatusGroup;
  ticket_type?: TicketType | TicketType[];
  /**
   * T1 category filter — client-side virtual filter that expands to the
   * underlying ticket_type values for the selected category.
   * Handled by the TicketFilters component before sending to the API.
   */
  t1_category?: string;
  priority?: TicketPriority | TicketPriority[];
  source?: TicketSource | TicketSource[];
  assigned_to?: string; // User ID
  assigned_contractor_id?: string; // Contractor ID
  assigned_team_id?: string; // Team ID
  project_id?: string;
  dr_number?: string;
  qa_ready?: boolean;
  sla_breached?: boolean;
  fault_cause?: FaultCause;
  created_after?: Date;
  created_before?: Date;
  guarantee_status?: GuaranteeStatus;
  // Extended filters used by hooks/API
  search?: string;
  sort?: string;
  page?: number;
  pageSize?: number;
}

/**
 * Ticket list pagination
 */
export interface TicketPagination {
  page: number;
  limit: number;
  sort_by?: 'created_at' | 'updated_at' | 'sla_due_at' | 'priority';
  sort_order?: 'asc' | 'desc';
}

/**
 * Ticket list response (from service)
 */
export interface TicketListResponse {
  tickets: Ticket[];
  total: number;
  page: number;
  limit: number;
  total_pages: number;
}

/**
 * Ticket list result (for hooks/frontend)
 */
export interface TicketListResult {
  tickets: Ticket[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

/**
 * Ticket with related data (for detail views)
 */
export interface TicketWithRelations extends Ticket {
  verification_steps?: any[]; // Will be typed in verification.ts
  qa_readiness_checks?: any[]; // Will be typed in verification.ts
  risk_acceptances?: any[]; // Will be typed in riskAcceptance.ts
  handover_snapshots?: any[]; // Will be typed in handover.ts
  attachments?: any[]; // Will be typed separately
  notes?: any[]; // Will be typed separately
  assigned_user?: {
    id: string;
    name: string;
    email: string;
  };
  assigned_contractor?: {
    id: string;
    name: string;
  };
  assigned_team_info?: {
    id: string;
    name: string;
    team_type: string;
  };
  project?: {
    id: string;
    name: string;
  };
}

/**
 * Ticket statistics for dashboard
 */
export interface TicketStats {
  total: number;
  by_status: Record<TicketStatus, number>;
  by_priority: Record<TicketPriority, number>;
  by_type: Record<TicketType, number>;
  sla_breached: number;
  qa_ready: number;
  avg_resolution_time_hours: number;
}

/**
 * GPS coordinates from FibreFlow data sources
 */
export interface GPSEnrichmentData {
  latitude: number;
  longitude: number;
  address: string | null;
}

/**
 * Project info from enrichment lookup
 */
export interface ProjectEnrichmentInfo {
  project_id: string;
  project_name: string;
  project_code: string | null;
}

/**
 * FibreFlow enrichment data - cross-referenced from DR number
 */
export interface FibreFlowEnrichment {
  // From FibreFlow SOW drops
  fibreflow_gps: GPSEnrichmentData | null;
  fibreflow_pole_number: string | null;
  fibreflow_pon: number | null;
  fibreflow_zone: number | null;
  fibreflow_contractor: string | null;
  fibreflow_municipality: string | null;

  // From 1Map data
  onemap_customer_name: string | null;
  onemap_contact_number: string | null;
  onemap_address: string | null;
  onemap_gps: GPSEnrichmentData | null;

  // Project info (from DR number lookup or pattern matching)
  project: ProjectEnrichmentInfo | null;

  // Cross-reference success flags
  sow_match_found: boolean;
  onemap_match_found: boolean;
  project_match_found: boolean;
}

/**
 * Enriched Ticket - Ticket with FibreFlow cross-references
 */
export interface EnrichedTicket extends Ticket {
  fibreflow_enrichment?: FibreFlowEnrichment;
}

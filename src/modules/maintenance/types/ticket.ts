/**
 * Ticketing Module - Core Ticket Types
 * 🟢 WORKING: Type definitions match database schema from migrations
 *
 * Defines TypeScript types for tickets, status tracking, priorities,
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
}

/**
 * Ticket Type - Classification of ticket
 */
export enum TicketType {
  MAINTENANCE = 'maintenance',
  NEW_INSTALLATION = 'new_installation',
  MODIFICATION = 'modification',
  ONT_SWAP = 'ont_swap',
  INCIDENT = 'incident',
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
  HANDED_TO_MAINTENANCE = 'handed_to_maintenance',
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
  created_by?: string;
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

/**
 * Ticket list filters
 */
export interface TicketFilters {
  status?: TicketStatus | TicketStatus[];
  ticket_type?: TicketType | TicketType[];
  priority?: TicketPriority | TicketPriority[];
  source?: TicketSource | TicketSource[];
  assigned_to?: string; // User ID
  assigned_contractor_id?: string; // Contractor ID
  project_id?: string;
  dr_number?: string;
  qa_ready?: boolean;
  sla_breached?: boolean;
  fault_cause?: FaultCause;
  created_after?: Date;
  created_before?: Date;
  guarantee_status?: GuaranteeStatus;
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
 * Ticket list response
 */
export interface TicketListResponse {
  tickets: Ticket[];
  total: number;
  page: number;
  limit: number;
  total_pages: number;
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

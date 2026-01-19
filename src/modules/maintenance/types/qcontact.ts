/**
 * Ticketing Module - QContact Integration Types
 * 🟢 WORKING: Type definitions match database schema from migrations
 *
 * Defines TypeScript types for QContact API integration, bidirectional
 * sync, audit logging, and webhook handling.
 */

/**
 * Sync Direction
 */
export enum SyncDirection {
  INBOUND = 'inbound', // QContact -> FibreFlow
  OUTBOUND = 'outbound', // FibreFlow -> QContact
}

/**
 * Sync Type - Type of synchronization operation
 */
export enum SyncType {
  CREATE = 'create',
  STATUS_UPDATE = 'status_update',
  ASSIGNMENT = 'assignment',
  NOTE_ADD = 'note_add',
  FULL_SYNC = 'full_sync',
}

/**
 * Sync Status
 */
export enum SyncStatus {
  SUCCESS = 'success',
  FAILED = 'failed',
  PARTIAL = 'partial',
}

/**
 * QContact Sync Log Interface
 * Audit trail for bidirectional sync with QContact
 */
export interface QContactSyncLog {
  // Primary identification
  id: string; // UUID
  ticket_id: string | null; // UUID reference to tickets
  qcontact_ticket_id: string | null;

  // Sync details
  sync_direction: SyncDirection;
  sync_type: SyncType;

  // Payload data (JSONB)
  request_payload: Record<string, any> | null;
  response_payload: Record<string, any> | null;

  // Result tracking
  status: SyncStatus;
  error_message: string | null;

  // Timestamp
  synced_at: Date;
}

/**
 * Create sync log payload
 */
export interface CreateSyncLogPayload {
  ticket_id?: string;
  qcontact_ticket_id?: string;
  sync_direction: SyncDirection;
  sync_type: SyncType;
  request_payload?: Record<string, any>;
  response_payload?: Record<string, any>;
  status: SyncStatus;
  error_message?: string;
}

/**
 * QContact ticket data structure
 * Structure of ticket data from QContact API
 */
export interface QContactTicket {
  id: string; // QContact ticket ID
  title: string;
  description: string | null;
  status: string;
  priority: string;
  created_at: string;
  updated_at: string;
  customer_name: string | null;
  customer_phone: string | null;
  customer_email: string | null;
  address: string | null;
  assigned_to: string | null;
  category: string | null;
  subcategory: string | null;
  custom_fields: Record<string, any> | null;
}

/**
 * QContact API configuration
 */
export interface QContactAPIConfig {
  base_url: string;
  api_key: string;
  timeout_ms: number;
  retry_attempts: number;
}

/**
 * QContact field mapping
 * Maps FibreFlow fields to QContact fields
 */
export interface QContactFieldMapping {
  fibreflow_field: string;
  qcontact_field: string;
  transform?: (value: any) => any;
  bidirectional: boolean;
}

/**
 * Sync operation request
 */
export interface SyncOperationRequest {
  ticket_id?: string;
  qcontact_ticket_id?: string;
  sync_type: SyncType;
  data: Record<string, any>;
}

/**
 * Sync operation result
 */
export interface SyncOperationResult {
  success: boolean;
  sync_log_id: string;
  ticket_id: string | null;
  qcontact_ticket_id: string | null;
  error_message: string | null;
  synced_at: Date;
}

/**
 * Full sync request
 */
export interface FullSyncRequest {
  sync_direction?: SyncDirection; // If not specified, both directions
  start_date?: Date;
  end_date?: Date;
  ticket_ids?: string[]; // Specific tickets to sync
  force_resync?: boolean; // Re-sync even if already synced
}

/**
 * Full sync result
 */
export interface FullSyncResult {
  started_at: Date;
  completed_at: Date;
  duration_seconds: number;
  inbound_stats: SyncStats;
  outbound_stats: SyncStats;
  total_success: number;
  total_failed: number;
  success_rate: number;
  errors: SyncError[];
}

/**
 * Sync statistics
 */
export interface SyncStats {
  total_processed: number;
  successful: number;
  failed: number;
  partial: number;
  skipped: number;
  created: number;
  updated: number;
}

/**
 * Sync error detail
 */
export interface SyncError {
  ticket_id: string | null;
  qcontact_ticket_id: string | null;
  sync_type: SyncType;
  error_message: string;
  error_code: string | null;
  timestamp: Date;
  recoverable: boolean;
}

/**
 * Sync status overview
 */
export interface SyncStatusOverview {
  last_sync_at: Date | null;
  last_sync_status: SyncStatus | null;
  last_sync_duration_seconds: number | null;
  pending_outbound: number;
  pending_inbound: number;
  failed_last_24h: number;
  success_rate_last_7d: number;
  is_healthy: boolean;
  health_issues: string[];
}

/**
 * Sync log filters for querying
 */
export interface SyncLogFilters {
  ticket_id?: string;
  qcontact_ticket_id?: string;
  sync_direction?: SyncDirection | SyncDirection[];
  sync_type?: SyncType | SyncType[];
  status?: SyncStatus | SyncStatus[];
  synced_after?: Date;
  synced_before?: Date;
}

/**
 * Sync log list response
 */
export interface SyncLogListResponse {
  logs: QContactSyncLog[];
  total: number;
  by_direction: Record<SyncDirection, number>;
  by_status: Record<SyncStatus, number>;
  success_rate: number;
}

/**
 * QContact webhook payload
 * Incoming webhook from QContact for real-time updates
 */
export interface QContactWebhookPayload {
  event: 'ticket.created' | 'ticket.updated' | 'ticket.closed' | 'ticket.assigned';
  ticket_id: string;
  timestamp: Date;
  data: QContactTicket;
  signature: string; // For webhook verification
}

/**
 * Webhook verification result
 */
export interface WebhookVerificationResult {
  is_valid: boolean;
  error_message: string | null;
}

/**
 * Sync retry configuration
 */
export interface SyncRetryConfig {
  max_retries: number;
  retry_delay_seconds: number;
  exponential_backoff: boolean;
  retry_on_status_codes: number[];
}

/**
 * Sync schedule configuration
 */
export interface SyncScheduleConfig {
  enabled: boolean;
  cron_expression: string; // e.g., '*/15 * * * *' for every 15 minutes
  full_sync_enabled: boolean;
  full_sync_cron: string; // e.g., '0 2 * * *' for 2 AM daily
}

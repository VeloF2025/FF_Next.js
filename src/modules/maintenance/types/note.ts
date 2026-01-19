/**
 * Ticketing Module - Ticket Note Types
 * 🟢 WORKING: Type definitions match database schema from migrations
 *
 * Defines TypeScript types for ticket notes - internal comments,
 * client communications, and system-generated activity log.
 *
 * Notes have visibility control:
 * - PRIVATE: Internal Velocity Fibre use only, never synced externally
 * - PUBLIC: May be synced to QContact or other external systems
 */

/**
 * Note Type
 */
export enum NoteType {
  INTERNAL = 'internal', // Internal team notes
  CLIENT = 'client', // Client-visible notes
  SYSTEM = 'system', // System-generated notes
}

/**
 * Note Visibility
 * Controls whether notes can be synced to external systems
 */
export enum NoteVisibility {
  PRIVATE = 'private', // Internal use only - never synced to external systems
  PUBLIC = 'public', // May be synced to QContact or other apps
}

/**
 * System Event Types
 * Events that trigger automatic system notes
 */
export enum SystemEvent {
  STATUS_CHANGE = 'status_change',
  ASSIGNMENT = 'assignment',
  SLA_WARNING = 'sla_warning',
  SLA_BREACH = 'sla_breach',
  QA_REJECTION = 'qa_rejection',
  QA_APPROVAL = 'qa_approval',
  RISK_CREATED = 'risk_created',
  RISK_RESOLVED = 'risk_resolved',
  ESCALATION_CREATED = 'escalation_created',
  HANDOVER = 'handover',
  ATTACHMENT_ADDED = 'attachment_added',
  VERIFICATION_COMPLETE = 'verification_complete',
}

/**
 * Ticket Note Interface
 * Internal/client notes and system activity log
 */
export interface TicketNote {
  // Primary identification
  id: string; // UUID
  ticket_id: string; // UUID reference to tickets

  // Note content
  note_type: NoteType;
  visibility: NoteVisibility; // Private (internal only) or Public (can be synced)
  content: string;

  // Author (NULL for system notes)
  created_by: string | null; // UUID reference to users
  created_at: Date;
  updated_at: Date;

  // For system-generated notes
  system_event: SystemEvent | null;
  event_data: SystemEventData | null; // JSONB

  // Resolution flag
  is_resolution: boolean;

  // Attachments
  attachments: string[] | null;
}

/**
 * System event data structure
 * Varies by event type
 */
export interface SystemEventData {
  event_type: SystemEvent;
  [key: string]: any; // Additional event-specific data
}

/**
 * Status change event data
 */
export interface StatusChangeEventData extends SystemEventData {
  event_type: SystemEvent.STATUS_CHANGE;
  old_status: string;
  new_status: string;
  changed_by: string; // User ID
  reason?: string;
}

/**
 * Assignment event data
 */
export interface AssignmentEventData extends SystemEventData {
  event_type: SystemEvent.ASSIGNMENT;
  assigned_to?: string; // User ID
  assigned_contractor_id?: string;
  assigned_team?: string;
  assigned_by: string; // User ID
  previous_assignee?: string;
}

/**
 * SLA event data
 */
export interface SLAEventData extends SystemEventData {
  event_type: SystemEvent.SLA_WARNING | SystemEvent.SLA_BREACH;
  sla_due_at: Date;
  hours_overdue?: number;
  severity: 'warning' | 'breach';
}

/**
 * QA event data
 */
export interface QAEventData extends SystemEventData {
  event_type: SystemEvent.QA_REJECTION | SystemEvent.QA_APPROVAL;
  qa_user_id: string;
  qa_decision: 'approved' | 'rejected';
  rejection_reason?: string;
  risk_acceptance_id?: string; // If approved with conditions
}

/**
 * Handover event data
 */
export interface HandoverEventData extends SystemEventData {
  event_type: SystemEvent.HANDOVER;
  handover_type: string;
  from_owner_type: string;
  to_owner_type: string;
  handover_snapshot_id: string;
}

/**
 * Create note payload
 */
export interface CreateNotePayload {
  ticket_id: string;
  note_type: NoteType;
  visibility: NoteVisibility;
  content: string;
  created_by?: string; // Required for internal/client notes, NULL for system
  is_resolution?: boolean;
  attachments?: string[];
  system_event?: SystemEvent;
  event_data?: SystemEventData;
}

/**
 * Update note payload
 */
export interface UpdateNotePayload {
  content: string;
}

/**
 * Note with author details
 */
export interface NoteWithAuthor extends TicketNote {
  author_name?: string;
  author_email?: string;
  is_system_note: boolean;
  is_editable: boolean;
  visibility_label: string; // "Private" or "Public"
}

/**
 * Note filters for listing
 */
export interface NoteFilters {
  ticket_id?: string;
  note_type?: NoteType | NoteType[];
  visibility?: NoteVisibility | NoteVisibility[];
  system_event?: SystemEvent | SystemEvent[];
  created_by?: string;
  created_after?: Date;
  created_before?: Date;
  search_content?: string;
}

/**
 * Note list response
 */
export interface NoteListResponse {
  notes: TicketNote[];
  total: number;
  by_type: Record<NoteType, number>;
  by_visibility: Record<NoteVisibility, number>;
  by_system_event: Record<SystemEvent, number>;
}

/**
 * Ticket timeline entry
 * Combines notes and events for a unified activity log
 */
export interface TimelineEntry {
  id: string;
  timestamp: Date;
  entry_type: 'note' | 'event' | 'attachment' | 'verification';
  note_type?: NoteType;
  system_event?: SystemEvent;
  content: string;
  author_name?: string;
  author_id?: string;
  metadata?: Record<string, any>;
  icon?: string; // Icon identifier for UI
  color?: string; // Color for UI
}

/**
 * Ticket activity timeline
 */
export interface TicketActivityTimeline {
  ticket_id: string;
  entries: TimelineEntry[];
  total_entries: number;
  date_range: {
    earliest: Date;
    latest: Date;
  };
}

/**
 * Note mention (@ mentions in notes)
 */
export interface NoteMention {
  note_id: string;
  user_id: string; // User being mentioned
  user_name: string;
  mentioned_at: Date;
}

/**
 * Note attachment reference
 * Links notes to attachments
 */
export interface NoteAttachmentReference {
  note_id: string;
  attachment_id: string;
  attachment_url: string;
  filename: string;
}

/**
 * System note template
 */
export interface SystemNoteTemplate {
  event_type: SystemEvent;
  template: string; // Template string with {{variables}}
  variables: string[]; // Required variables
}

/**
 * Note statistics
 */
export interface NoteStatistics {
  total_notes: number;
  by_type: Record<NoteType, number>;
  by_system_event: Record<SystemEvent, number>;
  notes_this_week: number;
  avg_notes_per_ticket: number;
  most_active_authors: Array<{
    user_id: string;
    user_name: string;
    note_count: number;
  }>;
}

/**
 * Comment thread (for related notes)
 */
export interface CommentThread {
  ticket_id: string;
  thread_id: string;
  root_note_id: string;
  replies: TicketNote[];
  total_replies: number;
  last_reply_at: Date;
}

/**
 * Note notification preference
 */
export interface NoteNotificationPreference {
  user_id: string;
  notify_on_client_notes: boolean;
  notify_on_mentions: boolean;
  notify_on_ticket_updates: boolean;
  notification_method: 'email' | 'whatsapp' | 'both';
}

/**
 * Bulk note creation payload
 */
export interface BulkNoteCreationPayload {
  ticket_ids: string[];
  note_type: NoteType;
  content: string;
  created_by: string; // User ID
}

/**
 * Bulk note creation result
 */
export interface BulkNoteCreationResult {
  total_tickets: number;
  notes_created: number;
  failed: number;
  note_ids: string[];
  errors: Array<{
    ticket_id: string;
    error: string;
  }>;
}

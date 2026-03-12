/**
 * Shared types, constants, and DB access for activity log services
 * Private - not re-exported from barrel
 */

import { neon } from '@/lib/db-neon';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Activity event types
 */
export type ActivityEventType =
  | 'whatsapp_submitted'
  | 'dr_acknowledged'
  | 'photos_fetched'
  | 'PHOTOS_SYNCED'
  | 'attribute_categorized'
  | 'vlm_qa_started'
  | 'vlm_qa_completed'
  | 'vlm_qa_failed'
  | 'human_review_started'
  | 'human_review_completed'
  | 'step_approved'
  | 'step_rejected'
  | 'feedback_generated'
  | 'feedback_sent'
  | 'error'
  | 'SERIAL_UPDATE'
  | 'SWAP_DETECTED'
  | 'INSTALLATION_MISMATCH'
  | 'SERIAL_HISTORY_ENTRY'
  | 'WA_PHOTO_VLM_PROCESSED'
  | 'SERIAL_CONFIRMED'
  | 'SERIAL_VERIFIED'
  | 'INVESTIGATE'
  | 'MANUAL_SERIAL_EDIT'
  | 'SERIAL_VERIFICATION_COMPUTED'
  | 'STATUS_UPDATE'
  | 'ONT_SWAP_REPORTED'
  | 'auto_qa_completed'
  | 'auto_qa_reset';

/**
 * Serial change source types
 */
export type SerialChangeSource =
  | 'onemap_sync'
  | 'manual_edit'
  | 'vlm_extraction'
  | 'wa_photo_vlm'
  | 'swap_correction'
  | 'migration';

/**
 * Serial change reason types
 */
export type SerialChangeReason =
  | 'technician_update'
  | 'swap_correction'
  | 'replacement'
  | 'data_fix'
  | 'initial_capture';

/**
 * Activity log entry
 */
export interface ActivityLogEntry {
  id: string;
  drop_number: string;
  event_type: ActivityEventType;
  event_data: Record<string, unknown>;
  actor: string | null;
  created_at: Date;
}

/**
 * Activity timeline entry (for UI display)
 */
export interface TimelineEntry {
  id: string;
  timestamp: Date;
  eventType: ActivityEventType;
  title: string;
  description: string;
  icon: string;
  iconColor: string;
  actor: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Activity summary for a DR
 */
export interface ActivitySummary {
  drNumber: string;
  totalEvents: number;
  firstEvent: Date | null;
  lastEvent: Date | null;
  currentPhase: 'submitted' | 'categorizing' | 'qa_validation' | 'human_review' | 'complete';
  phaseTimestamps: {
    submitted?: Date;
    categorized?: Date;
    qaStarted?: Date;
    qaCompleted?: Date;
    reviewStarted?: Date;
    reviewCompleted?: Date;
    feedbackSent?: Date;
  };
}

// ============================================================================
// EVENT METADATA
// ============================================================================

/**
 * Event display metadata
 */
export const EVENT_METADATA: Record<ActivityEventType, { title: string; icon: string; iconColor: string }> = {
  whatsapp_submitted: {
    title: 'DR Submitted',
    icon: '📱',
    iconColor: 'text-green-500',
  },
  dr_acknowledged: {
    title: 'Acknowledgment Sent',
    icon: '✓',
    iconColor: 'text-blue-500',
  },
  photos_fetched: {
    title: 'Photos Fetched',
    icon: '📷',
    iconColor: 'text-purple-500',
  },
  PHOTOS_SYNCED: {
    title: 'Photos Synced',
    icon: '🔄',
    iconColor: 'text-blue-500',
  },
  attribute_categorized: {
    title: 'Photos Categorized',
    icon: '🏷️',
    iconColor: 'text-indigo-500',
  },
  vlm_qa_started: {
    title: 'QA Validation Started',
    icon: '🔍',
    iconColor: 'text-yellow-500',
  },
  vlm_qa_completed: {
    title: 'QA Validation Complete',
    icon: '✅',
    iconColor: 'text-green-500',
  },
  vlm_qa_failed: {
    title: 'QA Validation Failed',
    icon: '❌',
    iconColor: 'text-red-500',
  },
  human_review_started: {
    title: 'Human Review Started',
    icon: '👤',
    iconColor: 'text-blue-500',
  },
  human_review_completed: {
    title: 'Human Review Complete',
    icon: '✅',
    iconColor: 'text-green-500',
  },
  step_approved: {
    title: 'Step Approved',
    icon: '👍',
    iconColor: 'text-green-500',
  },
  step_rejected: {
    title: 'Step Rejected',
    icon: '👎',
    iconColor: 'text-red-500',
  },
  feedback_generated: {
    title: 'Feedback Generated',
    icon: '💬',
    iconColor: 'text-purple-500',
  },
  feedback_sent: {
    title: 'Feedback Sent',
    icon: '📤',
    iconColor: 'text-green-500',
  },
  error: {
    title: 'Error',
    icon: '⚠️',
    iconColor: 'text-red-500',
  },
  SERIAL_UPDATE: {
    title: 'Serial Changed',
    icon: '🔄',
    iconColor: 'text-orange-500',
  },
  SWAP_DETECTED: {
    title: 'Serials Swapped',
    icon: '⚠️',
    iconColor: 'text-red-500',
  },
  INSTALLATION_MISMATCH: {
    title: 'Installation Mismatch',
    icon: '🔴',
    iconColor: 'text-red-500',
  },
  SERIAL_HISTORY_ENTRY: {
    title: 'Serial Change Logged',
    icon: '📝',
    iconColor: 'text-blue-500',
  },
  WA_PHOTO_VLM_PROCESSED: {
    title: 'WA Photo Analyzed',
    icon: '🤖',
    iconColor: 'text-purple-500',
  },
  SERIAL_CONFIRMED: {
    title: 'Serial Confirmed',
    icon: '✓',
    iconColor: 'text-green-500',
  },
  MANUAL_SERIAL_EDIT: {
    title: 'Serial Manually Edited',
    icon: '✏️',
    iconColor: 'text-yellow-500',
  },
  SERIAL_VERIFIED: {
    title: '1Map Serial Verified',
    icon: '✓',
    iconColor: 'text-green-500',
  },
  INVESTIGATE: {
    title: 'Needs Investigation',
    icon: '🔎',
    iconColor: 'text-orange-500',
  },
  SERIAL_VERIFICATION_COMPUTED: {
    title: 'Serial Verification Updated',
    icon: '🔒',
    iconColor: 'text-blue-500',
  },
  STATUS_UPDATE: {
    title: '1Map Status Updated',
    icon: '🔄',
    iconColor: 'text-blue-500',
  },
  ONT_SWAP_REPORTED: {
    title: 'ONT Swap Reported',
    icon: '🔄',
    iconColor: 'text-orange-500',
  },
  auto_qa_completed: {
    title: 'Auto-QA Completed',
    icon: '🤖',
    iconColor: 'text-blue-500',
  },
  auto_qa_reset: {
    title: 'Auto-QA Reset',
    icon: '↩',
    iconColor: 'text-yellow-500',
  },
};

// ============================================================================
// DATABASE
// ============================================================================

/**
 * Get database connection
 */
export function getDb() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL not configured');
  }
  return neon(connectionString);
}

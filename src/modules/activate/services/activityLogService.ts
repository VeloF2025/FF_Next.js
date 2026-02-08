/**
 * Activity Log Service - Barrel Re-export
 *
 * All functions have been split into activity-log/ subdirectory.
 * This file re-exports everything for zero-import-change compatibility.
 */

// Types (re-exported for consumers)
export type {
  ActivityEventType,
  SerialChangeSource,
  SerialChangeReason,
  ActivityLogEntry,
  TimelineEntry,
  ActivitySummary,
} from './activity-log/_shared';

// Core logger functions
export { logActivity, getActivityHistory, getActivitySummary, getRecentActivity } from './activity-log/coreLogger';

// Timeline builder
export { getActivityTimeline } from './activity-log/timelineBuilder';

// Convenience event loggers
export {
  logWhatsAppSubmission,
  logAcknowledgment,
  logPhotosFetched,
  logPhotosSynced,
  logAttributeCategorization,
  logVlmQaStarted,
  logVlmQaCompleted,
  logVlmQaFailed,
  logHumanReviewStarted,
  logHumanReviewCompleted,
  logStepApproval,
  logStepRejection,
  logFeedbackGenerated,
  logFeedbackSent,
  logError,
} from './activity-log/eventLoggers';

// Serial change tracking
export { logSerialChange, getSerialHistory, logWaPhotoVlmProcessed, detectSwapPattern } from './activity-log/serialHistory';

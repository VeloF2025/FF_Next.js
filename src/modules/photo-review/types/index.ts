/**
 * FibreFlow - Foto Review Module Types
 *
 * TypeScript type definitions for the DR Photo AI Review system.
 * These types ensure type safety across the entire module.
 */

/**
 * Represents metadata about a single installation photo
 */
export interface PhotoMetadata {
  /** Unique photo identifier */
  id: string;
  /** Full URL to the photo file */
  url: string;
  /** Installation step this photo represents (e.g., 'house_photo', 'ont_barcode') */
  step: string;
  /** Human-readable step label */
  stepLabel: string;
  /** Timestamp when photo was taken */
  timestamp: string | Date;
  /** Original filename */
  filename: string;
  /** File size in bytes */
  fileSize?: number;
  /** Image dimensions (width x height) */
  dimensions?: {
    width: number;
    height: number;
  };
}

/**
 * Photo type alias for backward compatibility
 */
export type Photo = PhotoMetadata;

/**
 * Represents a Drop Record with associated photos
 */
export interface DropRecord {
  /** DR number (e.g., 'DR1234567') */
  dr_number: string;
  /** Project name (e.g., 'Lawley', 'Mohadin') */
  project: string;
  /** Installation date */
  installation_date?: Date;
  /** Installation date (alias for filtering compatibility) */
  date?: Date;
  /** Customer name */
  customer_name?: string;
  /** Customer address */
  address?: string;
  /** Pole number */
  pole_number?: string;
  /** Array of photos associated with this DR */
  photos: PhotoMetadata[];
  /** Whether this DR has been evaluated */
  evaluated: boolean;
  /** Last evaluation date if evaluated */
  last_evaluation_date?: Date;
  /** Evaluation date (ISO string) */
  evaluation_date?: string;
  /** Whether feedback has been sent */
  feedback_sent?: boolean;
  /** Overall evaluation status */
  overall_status?: 'PASS' | 'FAIL';
}

/**
 * Represents the result of evaluating a single installation step
 */
export interface StepEvaluationResult {
  /** Step number (1-12) */
  step_number: number;
  /** Step name/identifier */
  step_name: string;
  /** Human-readable step label */
  step_label: string;
  /** Whether this step passed the evaluation */
  passed: boolean;
  /** Numerical score for this step (0-10) */
  score: number;
  /** AI-generated comment explaining the evaluation */
  comment: string;
  /** Timestamp of evaluation */
  evaluated_at?: Date;
}

/**
 * Represents the complete evaluation results for a DR
 */
export interface EvaluationResult {
  /** DR number that was evaluated */
  dr_number: string;
  /** Project name (for WhatsApp feedback routing) */
  project?: string;
  /** Overall status: PASS or FAIL */
  overall_status: 'PASS' | 'FAIL';
  /** Average score across all steps (0-10) */
  average_score: number;
  /** Total number of steps evaluated (always 12) */
  total_steps: number;
  /** Number of steps that passed */
  passed_steps: number;
  /** Detailed results for each step */
  step_results: StepEvaluationResult[];
  /** Markdown-formatted report */
  markdown_report?: string;
  /** Whether feedback has been sent for this evaluation */
  feedback_sent: boolean;
  /** When feedback was sent */
  feedback_sent_at?: Date;
  /** When this evaluation was performed */
  evaluation_date: Date;
  /** Database record creation timestamp */
  created_at?: Date;
  /** Database record last update timestamp */
  updated_at?: Date;
}

/**
 * Represents the status of a feedback sending operation
 */
export interface FeedbackStatus {
  /** Whether feedback was sent successfully */
  sent: boolean;
  /** Timestamp when feedback was sent */
  sent_at?: Date;
  /** Error message if sending failed */
  error?: string;
  /** WhatsApp message ID if available */
  message_id?: string;
}

/**
 * Request body for triggering an evaluation
 */
export interface EvaluateRequest {
  /** DR number to evaluate */
  dr_number: string;
}

/**
 * Request body for sending feedback
 */
export interface SendFeedbackRequest {
  /** DR number to send feedback for */
  dr_number: string;
  /** Optional custom feedback message (overrides auto-generated) */
  message?: string;
  /** Optional project name for routing to correct WhatsApp group */
  project?: string;
}

/**
 * Response from the photos API endpoint
 */
export interface PhotosResponse {
  /** Whether the request was successful */
  success: boolean;
  /** Array of drop records with photos */
  data: DropRecord[];
  /** Total count of DRs (for pagination) */
  total?: number;
  /** Error message if request failed */
  error?: string;
}

/**
 * Response from the evaluate API endpoint
 */
export interface EvaluateResponse {
  /** Whether the request was successful */
  success: boolean;
  /** Evaluation results */
  data?: EvaluationResult;
  /** Error message if request failed */
  error?: string;
}

/**
 * Response from the feedback API endpoint
 */
export interface FeedbackResponse {
  /** Whether the request was successful */
  success: boolean;
  /** Feedback status */
  data?: FeedbackStatus;
  /** Success message */
  message?: string;
  /** Error message if request failed */
  error?: string;
}

/**
 * Filters for querying photos/DRs
 */
export interface PhotoFilters {
  /** Filter by project name */
  project?: string;
  /** Filter by start date (inclusive) */
  startDate?: Date;
  /** Filter by end date (inclusive) */
  endDate?: Date;
  /** Filter by evaluation status */
  evaluationStatus?: 'all' | 'evaluated' | 'pending';
  /** Search term for DR number or customer name */
  search?: string;
}

/**
 * State for the foto evaluation hook
 */
export interface FotoEvaluationState {
  /** Current evaluation result */
  evaluation: EvaluationResult | null;
  /** Whether an evaluation is currently in progress */
  loading: boolean;
  /** Error message if evaluation failed */
  error: string | null;
  /** Function to trigger evaluation */
  evaluate: (drNumber: string) => Promise<void>;
  /** Function to clear evaluation state */
  clear: () => void;
}

/**
 * State for the photos hook
 */
export interface PhotosState {
  /** Array of drop records */
  photos: DropRecord[];
  /** Whether photos are currently being loaded */
  loading: boolean;
  /** Error message if loading failed */
  error: string | null;
  /** Function to refresh photos */
  refresh: () => Promise<void>;
  /** Function to apply filters */
  applyFilters: (filters: PhotoFilters) => Promise<void>;
}

/**
 * Props for PhotoGallery component
 */
export interface PhotoGalleryProps {
  /** Array of photos to display */
  photos: PhotoMetadata[];
  /** DR number for the photos */
  dr_number: string;
  /** Callback when a photo is clicked */
  onPhotoClick?: (photo: PhotoMetadata) => void;
  /** Whether to show loading state */
  loading?: boolean;
  /** Custom class name for styling */
  className?: string;
}

/**
 * Props for AIEvaluationCard component
 */
export interface AIEvaluationCardProps {
  /** DR number being evaluated */
  dr_number?: string;
  /** Evaluation result to display (null if not yet evaluated) */
  evaluation: EvaluationResult | null;
  /** Whether evaluation is in progress */
  isEvaluating?: boolean;
  /** Callback when Evaluate button is clicked */
  onEvaluate?: () => void;
  /** Callback when Send Feedback button is clicked */
  onSendFeedback?: (dr_number: string) => Promise<void>;
  /** Whether feedback is currently being sent */
  isSendingFeedback?: boolean;
  /** Custom class name for styling */
  className?: string;
}

/**
 * Props for EvaluationResults component
 */
export interface EvaluationResultsProps {
  /** Evaluation result to display */
  evaluation: EvaluationResult;
  /** Whether to show in compact mode */
  compact?: boolean;
  /** Custom class name for styling */
  className?: string;
}

/**
 * Props for FeedbackButton component
 */
export interface FeedbackButtonProps {
  /** DR number to send feedback for */
  dr_number: string;
  /** Evaluation results to include in feedback message */
  evaluation: EvaluationResult | null;
  /** Callback to send feedback */
  onSendFeedback: (dr_number: string) => Promise<void>;
  /** Whether feedback is currently being sent */
  isSending?: boolean;
  /** Whether the button is disabled */
  disabled?: boolean;
}

/**
 * The 12 standard installation photo steps
 */
export const PHOTO_STEPS = [
  { id: 'step_01', name: 'house_photo', label: 'House Photo' },
  { id: 'step_02', name: 'cable_span', label: 'Cable Span' },
  { id: 'step_03', name: 'ont_barcode', label: 'ONT Barcode' },
  { id: 'step_04', name: 'ont_installation', label: 'ONT Installation' },
  { id: 'step_05', name: 'power_supply', label: 'Power Supply' },
  { id: 'step_06', name: 'cable_management', label: 'Cable Management' },
  { id: 'step_07', name: 'drop_cable', label: 'Drop Cable' },
  { id: 'step_08', name: 'splice_closure', label: 'Splice Closure' },
  { id: 'step_09', name: 'inside_wiring', label: 'Inside Wiring' },
  { id: 'step_10', name: 'speed_test', label: 'Speed Test' },
  { id: 'step_11', name: 'customer_equipment', label: 'Customer Equipment' },
  { id: 'step_12', name: 'customer_signature', label: 'Customer Signature' },
] as const;

/**
 * Type for photo step IDs
 */
export type PhotoStepId = typeof PHOTO_STEPS[number]['id'];

/**
 * Type for photo step names
 */
export type PhotoStepName = typeof PHOTO_STEPS[number]['name'];

/**
 * VLM Learning System - Type Definitions
 *
 * Enterprise-wide types for the VLM learning system that uses
 * HITL (Human-in-the-Loop) corrections for few-shot prompting.
 *
 * @module types/vlm-learning
 */

// ============================================================================
// Module & Analysis Type Enums
// ============================================================================

/**
 * Modules that use VLM extraction
 */
export type VlmModule = 'activate' | 'fleet' | 'procurement' | 'assets' | 'staff';

/**
 * Analysis types by module
 */
export type VlmAnalysisType =
  // Activate module
  | 'photo_categorization'
  | 'power_meter_dbm'
  | 'ont_serial_back'
  | 'ont_serial_front'
  | 'dr_number'
  | 'dr_qa_validation'
  | 'green_lights_check'
  // Fleet module
  | 'odometer'
  | 'license_plate'
  | 'fuel_gauge'
  | 'fuel_receipt'
  | 'license_disk'
  // Procurement module
  | 'quote_supplier'
  | 'quote_line_item'
  | 'quote_totals'
  // Assets module
  | 'equipment_label'
  // Staff module
  | 'id_extraction'
  | 'photo_match';

/**
 * Analysis types grouped by module (for UI filtering)
 */
export const ANALYSIS_TYPES_BY_MODULE: Record<VlmModule, VlmAnalysisType[]> = {
  activate: [
    'photo_categorization',
    'power_meter_dbm',
    'ont_serial_back',
    'ont_serial_front',
    'dr_number',
    'dr_qa_validation',
    'green_lights_check',
  ],
  fleet: ['odometer', 'license_plate', 'fuel_gauge', 'fuel_receipt', 'license_disk'],
  procurement: ['quote_supplier', 'quote_line_item', 'quote_totals'],
  assets: ['equipment_label'],
  staff: ['id_extraction', 'photo_match'],
};

// ============================================================================
// Correction Types
// ============================================================================

/**
 * Reasons why a correction was made
 */
export type CorrectionReason =
  | 'digit_confusion'      // VLM misread digits (1/6, 2/3, 7/1, 8/0)
  | 'wrong_field'          // VLM extracted from wrong field (SSID instead of Serial)
  | 'partial_extraction'   // VLM only got part of the value
  | 'format_error'         // VLM got wrong format (decimal, spacing)
  | 'interpretation_error' // VLM misinterpreted the data (gauge direction)
  | 'ocr_failure'          // VLM couldn't read the text
  | 'hallucination'        // VLM made up a value
  | 'other';

/**
 * Common error patterns (for categorization and learning)
 */
export type ErrorPattern =
  // Digit confusion patterns
  | 'digit_1_6'
  | 'digit_1_7'
  | 'digit_2_3'
  | 'digit_6_8'
  | 'digit_8_0'
  | 'digit_9_4'
  // Format patterns
  | 'missed_decimal'
  | 'extra_decimal'
  | 'wrong_unit'
  // Field confusion patterns
  | 'ssid_not_serial'
  | 'part_number_not_serial'
  | 'mac_not_serial'
  // Interpretation patterns
  | 'gauge_reversed'
  | 'trip_not_odometer'
  | 'wrong_line_item';

// ============================================================================
// Database Records
// ============================================================================

/**
 * VLM Correction record (matches vlm_corrections table)
 */
export interface VlmCorrection {
  id: string;
  module: VlmModule;
  analysisType: VlmAnalysisType;

  // Source reference
  sourceId?: string | null;
  sourceTable?: string | null;
  photoUrl?: string | null;

  // VLM output
  vlmExtractedValue: string | null;
  vlmConfidence: number | null;
  vlmModel?: string | null;
  vlmPromptHash?: string | null;

  // Human correction
  correctedValue: string;
  correctionReason?: CorrectionReason | null;
  errorPattern?: ErrorPattern | null;
  correctionNotes?: string | null;

  // Context for few-shot matching
  contextJson: Record<string, unknown>;

  // Quality & curation
  isCanonical: boolean;
  priority: number;
  reviewedBy?: string | null;
  correctedByName?: string | null;

  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Input for recording a new correction
 */
export interface RecordCorrectionInput {
  module: VlmModule;
  analysisType: VlmAnalysisType;

  // Source reference
  sourceId?: string;
  sourceTable?: string;
  photoUrl?: string;

  // VLM output
  vlmExtractedValue: string | null;
  vlmConfidence?: number;
  vlmModel?: string;
  vlmPromptHash?: string;

  // Human correction
  correctedValue: string;
  correctionReason?: CorrectionReason;
  correctionNotes?: string;

  // Context
  context?: Record<string, unknown>;

  // Who made the correction
  correctedByName?: string;
  correctedById?: string;
}

// ============================================================================
// Metrics Types
// ============================================================================

/**
 * Daily metrics record (matches vlm_metrics table)
 */
export interface VlmMetricsRecord {
  id: string;
  metricDate: Date;
  module: VlmModule;
  analysisType: VlmAnalysisType;

  totalExtractions: number;
  correctExtractions: number;
  correctedExtractions: number;
  failedExtractions: number;

  accuracyRate: number | null;
  avgConfidence: number | null;

  // Error breakdown
  digitConfusionCount: number;
  formatErrorCount: number;
  partialExtractionCount: number;
  fieldConfusionCount: number;

  createdAt: Date;
  updatedAt: Date;
}

/**
 * Aggregated metrics summary
 */
export interface VlmMetricsSummary {
  module: VlmModule | 'all';
  analysisType: VlmAnalysisType | 'all';
  period: {
    from: Date;
    to: Date;
  };

  totals: {
    extractions: number;
    correct: number;
    corrected: number;
    failed: number;
  };

  accuracy: {
    overall: number;
    byDay: Array<{
      date: string;
      rate: number;
      count: number;
    }>;
  };

  topErrors: Array<{
    pattern: ErrorPattern;
    count: number;
    percentage: number;
  }>;
}

// ============================================================================
// Few-Shot Learning Types
// ============================================================================

/**
 * Few-shot example for prompt injection
 */
export interface FewShotExample {
  /** What the VLM incorrectly extracted */
  incorrect: string | null;
  /** The correct value (ground truth) */
  correct: string;
  /** Optional context (e.g., "Digital dashboard", "Nokia ONT label") */
  context?: string;
  /** Error pattern for learning */
  errorPattern?: ErrorPattern;
  /** Photo URL for visual example (optional, for multi-modal) */
  photoUrl?: string;
}

/**
 * Options for retrieving few-shot examples
 */
export interface GetFewShotOptions {
  module: VlmModule;
  analysisType: VlmAnalysisType;
  /** Context for similarity matching */
  context?: Record<string, unknown>;
  /** Maximum examples to return */
  maxExamples?: number;
  /** Prioritize canonical examples */
  prioritizeCanonical?: boolean;
  /** Include photo URLs for visual few-shot */
  includePhotos?: boolean;
}

// ============================================================================
// API Request/Response Types
// ============================================================================

/**
 * API request for listing corrections
 */
export interface ListCorrectionsRequest {
  module?: VlmModule;
  analysisType?: VlmAnalysisType;
  errorPattern?: ErrorPattern;
  isCanonical?: boolean;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
  offset?: number;
}

/**
 * API response for listing corrections
 */
export interface ListCorrectionsResponse {
  corrections: VlmCorrection[];
  total: number;
  hasMore: boolean;
}

/**
 * API request for metrics
 */
export interface GetMetricsRequest {
  module?: VlmModule;
  analysisType?: VlmAnalysisType;
  dateFrom?: string;
  dateTo?: string;
  groupBy?: 'day' | 'week' | 'month';
}

/**
 * Module-level accuracy summary
 */
export interface ModuleAccuracySummary {
  module: VlmModule;
  displayName: string;
  totalExtractions: number;
  accuracy: number;
  correctionCount: number;
  trend: 'up' | 'down' | 'stable';
  trendValue: number;
}

// ============================================================================
// UI State Types
// ============================================================================

/**
 * Filter state for corrections browser
 */
export interface CorrectionFilters {
  module: VlmModule | null;
  analysisType: VlmAnalysisType | null;
  errorPattern: ErrorPattern | null;
  isCanonical: boolean | null;
  dateRange: {
    from: Date | null;
    to: Date | null;
  };
  search: string;
}

/**
 * Correction list item for UI
 */
export interface CorrectionListItem {
  id: string;
  module: VlmModule;
  analysisType: VlmAnalysisType;
  vlmValue: string | null;
  correctedValue: string;
  errorPattern: ErrorPattern | null;
  isCanonical: boolean;
  createdAt: string;
  correctedByName: string | null;
}

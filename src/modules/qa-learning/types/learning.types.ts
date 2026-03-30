/**
 * QA Learning Types
 *
 * Purpose: Type definitions for HITL few-shot learning system
 * Used by: correctionService, fewShotService, categorizationVlmService
 *
 * Workflow Support:
 * - dr_photo: DR Photo QA (current)
 * - civil_works: Civil Works QA (future)
 * - optical_works: Optical Works QA (future)
 */

// ============================================================================
// WORKFLOW TYPES
// ============================================================================

/**
 * Supported QA workflow types
 * Each workflow has its own step definitions and isolated learning
 */
export type WorkflowType = 'dr_photo' | 'civil_works' | 'optical_works';

/**
 * Step definition for a workflow
 * Loaded from qa_workflow_steps table
 */
export interface WorkflowStepDefinition {
  id: string;
  workflowType: WorkflowType;
  stepNumber: number;
  stepLabel: string;
  stepDescription: string | null;
  createdAt: Date;
}

// ============================================================================
// CORRECTION RECORDS
// ============================================================================

/**
 * Human correction record stored in database
 * Created when a human overrides VLM categorization
 */
export interface CorrectionRecord {
  id: string;

  // Workflow identification
  workflowType: WorkflowType;

  // Photo context
  photoFilename: string;
  photoDescription: string | null; // VLM's vlm_identified_as

  // VLM prediction (what was wrong)
  vlmPredictedStep: number;
  vlmPredictedCategory: string;
  vlmConfidence: number;
  vlmReasoning: string | null;

  // Human correction (ground truth)
  correctStep: number;
  correctCategory: string;
  correctionReason: string | null;

  // Quality signals
  correctedBy: string;
  reviewedCount: number;
  isCanonical: boolean;

  // Metadata
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Input for recording a new correction
 */
export interface RecordCorrectionInput {
  workflowType: WorkflowType;
  photoFilename: string;
  photoDescription?: string;

  // VLM's wrong prediction
  vlmPredictedStep: number;
  vlmPredictedCategory: string;
  vlmConfidence: number;
  vlmReasoning?: string;

  // Human's correct answer
  correctStep: number;
  correctCategory: string;
  correctionReason?: string;

  // Who made the correction
  correctedBy: string;
}

// ============================================================================
// FEW-SHOT EXAMPLES
// ============================================================================

/**
 * Few-shot example for VLM prompt injection
 * Simplified format for prompt building
 */
export interface FewShotExample {
  photoDescription: string;
  wrongStep: number;
  wrongCategory: string;
  correctStep: number;
  correctCategory: string;
  correctionReason: string;
}

/**
 * Options for selecting few-shot examples
 */
export interface FewShotSelectionOptions {
  workflowType: WorkflowType;

  /** Maximum number of examples to return (default: 5) */
  maxExamples?: number;

  /** Include examples for commonly confused step pairs */
  includeConfusionPairs?: boolean;

  /** Only include canonical (curated) examples */
  canonicalOnly?: boolean;

  /** Minimum confidence threshold for "confident mistakes" */
  minConfidenceForMistake?: number;
}

/**
 * Result of few-shot example selection
 */
export interface FewShotSelectionResult {
  examples: FewShotExample[];
  totalAvailable: number;
  selectionCriteria: string[];
}

// ============================================================================
// CONFUSION PAIRS
// ============================================================================

/**
 * Known confusion pairs for DR Photo workflow
 * Steps that VLM commonly confuses with each other
 *
 * Source: vlm-accuracy-audit.ts (auto-generated from 2336 corrections)
 * Last updated: 2026-03-30
 */
export const DR_PHOTO_CONFUSION_PAIRS: Array<[number, number]> = [
  [0, 2], // Discard vs Cable from Pole (297 corrections — #1 error)
  [0, 1], // Discard vs House Photo (190 corrections)
  [0, 9], // Discard vs Green Lights (169 corrections)
  [0, 10], // Discard vs Signature (140 corrections)
  [0, 7], // Discard vs Power Meter (131 corrections)
  [0, 6], // Discard vs ONT Back (126 corrections)
  [2, 3], // Cable from Pole vs Entry Outside (aerial vs wall entry)
  [3, 4], // Entry Outside vs Entry Inside
  [6, 8], // ONT Back vs Final Installation
  [1, 8], // House Photo vs Final Installation
  [6, 9], // ONT Back (cables) vs Green Lights (front)
];

/**
 * Get confusion pairs for a workflow type
 */
export function getConfusionPairs(workflowType: WorkflowType): Array<[number, number]> {
  switch (workflowType) {
    case 'dr_photo':
      return DR_PHOTO_CONFUSION_PAIRS;
    case 'civil_works':
      // TODO: Define when Civil Works workflow is implemented
      return [];
    case 'optical_works':
      // TODO: Define when Optical Works workflow is implemented
      return [];
    default:
      return [];
  }
}

// ============================================================================
// UTILITY TYPES
// ============================================================================

/**
 * Correction statistics for a workflow
 */
export interface CorrectionStats {
  workflowType: WorkflowType;
  totalCorrections: number;
  canonicalCount: number;
  recentCorrections: number; // Last 30 days
  topConfusedSteps: Array<{
    vlmStep: number;
    correctStep: number;
    count: number;
  }>;
}

/**
 * Database row format (snake_case) for qa_correction_examples
 */
export interface CorrectionRecordRow {
  id: string;
  workflow_type: string;
  photo_filename: string;
  photo_description: string | null;
  vlm_predicted_step: number;
  vlm_predicted_category: string;
  vlm_confidence: string; // DECIMAL comes as string from DB
  vlm_reasoning: string | null;
  correct_step: number;
  correct_category: string;
  correction_reason: string | null;
  corrected_by: string;
  reviewed_count: number;
  is_canonical: boolean;
  created_at: Date;
  updated_at: Date;
}

/**
 * Database row format for qa_workflow_steps
 */
export interface WorkflowStepRow {
  id: string;
  workflow_type: string;
  step_number: number;
  step_label: string;
  step_description: string | null;
  created_at: Date;
}

// ============================================================================
// CONVERTERS
// ============================================================================

/**
 * Convert database row to CorrectionRecord
 */
export function rowToCorrectionRecord(row: CorrectionRecordRow): CorrectionRecord {
  return {
    id: row.id,
    workflowType: row.workflow_type as WorkflowType,
    photoFilename: row.photo_filename,
    photoDescription: row.photo_description,
    vlmPredictedStep: row.vlm_predicted_step,
    vlmPredictedCategory: row.vlm_predicted_category,
    vlmConfidence: parseFloat(row.vlm_confidence),
    vlmReasoning: row.vlm_reasoning,
    correctStep: row.correct_step,
    correctCategory: row.correct_category,
    correctionReason: row.correction_reason,
    correctedBy: row.corrected_by,
    reviewedCount: row.reviewed_count,
    isCanonical: row.is_canonical,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Convert database row to WorkflowStepDefinition
 */
export function rowToWorkflowStep(row: WorkflowStepRow): WorkflowStepDefinition {
  return {
    id: row.id,
    workflowType: row.workflow_type as WorkflowType,
    stepNumber: row.step_number,
    stepLabel: row.step_label,
    stepDescription: row.step_description,
    createdAt: row.created_at,
  };
}

/**
 * Convert CorrectionRecord to FewShotExample
 */
export function correctionToFewShot(correction: CorrectionRecord): FewShotExample {
  return {
    photoDescription: correction.photoDescription || 'Unknown photo content',
    wrongStep: correction.vlmPredictedStep,
    wrongCategory: correction.vlmPredictedCategory,
    correctStep: correction.correctStep,
    correctCategory: correction.correctCategory,
    correctionReason:
      correction.correctionReason ||
      `VLM incorrectly classified as Step ${correction.vlmPredictedStep} instead of Step ${correction.correctStep}`,
  };
}

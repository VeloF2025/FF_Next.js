/**
 * QA Learning Module
 *
 * Purpose: HITL (Human-In-The-Loop) few-shot learning for VLM categorization
 *
 * How it works:
 * 1. Human corrects VLM categorization → recorded as correction example
 * 2. Next VLM request → few-shot examples injected into prompt
 * 3. VLM learns from corrections without fine-tuning
 *
 * Workflow Support:
 * - dr_photo: DR Photo QA (current)
 * - civil_works: Civil Works QA (future)
 * - optical_works: Optical Works QA (future)
 *
 * Each workflow has isolated learning - corrections from one workflow
 * won't pollute another workflow's prompts.
 */

// ============================================================================
// TYPES
// ============================================================================

export type {
  WorkflowType,
  WorkflowStepDefinition,
  CorrectionRecord,
  RecordCorrectionInput,
  FewShotExample,
  FewShotSelectionOptions,
  FewShotSelectionResult,
  CorrectionStats,
} from './types/learning.types';

export {
  DR_PHOTO_CONFUSION_PAIRS,
  getConfusionPairs,
  correctionToFewShot,
} from './types/learning.types';

// ============================================================================
// CORRECTION SERVICE
// ============================================================================

export {
  recordCorrection,
  getCorrections,
  getCorrectionsForStep,
  getConfusionPairCorrections,
  markAsCanonical,
  incrementReviewCount,
  getCorrectionStats,
  CorrectionServiceError,
} from './services/correctionService';

// ============================================================================
// FEW-SHOT SERVICE
// ============================================================================

export {
  getRelevantExamples,
  buildFewShotPromptSection,
  hasCorrections,
} from './services/fewShotService';

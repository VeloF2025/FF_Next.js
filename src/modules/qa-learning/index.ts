/**
 * QA Learning Module
 *
 * Purpose: HITL (Human-In-The-Loop) few-shot learning for VLM tasks
 *
 * Two learning systems:
 *
 * 1. PHOTO CATEGORIZATION LEARNING (step-based)
 *    - VLM predicted step X → Human corrected to step Y
 *    - Used for: DR Photo QA, Civil Works, Optical Works
 *    - Table: qa_correction_examples
 *
 * 2. OCR FIELD EXTRACTION LEARNING (field-based) - NEW
 *    - VLM extracted "ABC" for fieldName → Human corrected to "XYZ"
 *    - Used for: Staff documents, Fleet check-in, Activate data extraction
 *    - Table: ocr_field_corrections
 *
 * Both systems work without fine-tuning - corrections are injected as
 * few-shot examples into future VLM prompts.
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
// FEW-SHOT SERVICE (Photo Categorization)
// ============================================================================

export {
  getRelevantExamples,
  buildFewShotPromptSection,
  hasCorrections,
} from './services/fewShotService';

// ============================================================================
// CONFIRMED CORRECT SERVICE (Positive Examples)
// ============================================================================

export type {
  ConfirmedCorrectRecord,
  RecordConfirmedCorrectInput,
  PositiveExample,
} from './types/learning.types';

export {
  confirmedToPositiveExample,
} from './types/learning.types';

export {
  recordConfirmedCorrectBatch,
  hasConfirmedCorrect,
} from './services/confirmedCorrectService';

export {
  getPositiveExamples,
  buildPositiveExamplesPromptSection,
} from './services/positiveExampleService';

export type {
  PositiveExampleOptions,
  PositiveExampleResult,
} from './services/positiveExampleService';

// ============================================================================
// OCR LEARNING SERVICE (Field Extraction) - NEW
// ============================================================================

export type {
  OcrModuleName,
  OcrDocumentType,
  StaffDocumentType,
  FleetDocumentType,
  ActivateDocumentType,
  OcrCorrectionInput,
  OcrCorrectionRecord,
  OcrFewShotExample,
  OcrFieldDefinition,
} from './services/ocrLearningService';

export {
  recordOcrCorrection,
  recordOcrCorrections,
  getOcrFewShotExamples,
  hasOcrCorrections,
  buildOcrFewShotPrompt,
  getOcrFieldDefinitions,
  buildExtractionHintsPrompt,
  getOcrCorrectionStats,
  OcrLearningError,
} from './services/ocrLearningService';

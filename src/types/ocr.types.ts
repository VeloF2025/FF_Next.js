/**
 * OCR Document Extraction Types
 * PRD Reference: PRD-032 OCR Document Extraction System
 */

// ============================================================================
// Enums
// ============================================================================

/**
 * OCR processing status for workflow tracking
 */
export enum OcrStatus {
  /** Awaiting user review */
  PENDING = 'pending',
  /** User accepted and applied extraction */
  CONFIRMED = 'confirmed',
  /** User rejected extraction */
  REJECTED = 'rejected',
  /** Auto-applied due to high confidence (>95%) */
  AUTO_APPLIED = 'auto_applied',
  /** OCR processing failed */
  FAILED = 'failed',
}

/**
 * OCR tier used for processing (4-tier cascade)
 */
export enum OcrTier {
  /** Tesseract - Local, free */
  TESSERACT = 'tesseract',
  /** PaddleOCR - Local, free */
  PADDLEOCR = 'paddleocr',
  /** OCR.space API - Free tier */
  OCRSPACE = 'ocrspace',
  /** Gemini Vision API - Paid fallback */
  GEMINI = 'gemini',
}

/**
 * Entity types that can have documents processed
 */
export enum OcrEntityType {
  STAFF = 'staff',
  CONTRACTOR = 'contractor',
}

/**
 * Document tables for polymorphic reference
 */
export enum OcrDocumentTable {
  STAFF_DOCUMENTS = 'staff_documents',
  CONTRACTOR_DOCUMENTS = 'contractor_documents',
}

// ============================================================================
// Core Interfaces
// ============================================================================

/**
 * Individual extracted field with metadata
 */
export interface ExtractedField {
  /** The extracted value */
  value: string | number | boolean | null;
  /** Confidence score (0-1) */
  confidence: number;
  /** Source location in document (e.g., "line_42", "page_1_region_3") */
  source: string;
  /** Whether this field was validated */
  validated?: boolean;
  /** Validation message if any */
  validationMessage?: string;
}

/**
 * Map of field names to extracted values
 */
export interface ExtractedFields {
  [fieldName: string]: ExtractedField;
}

/**
 * Fields selected for application with user decisions
 */
export interface FieldsToApply {
  [fieldName: string]: {
    /** The value to apply */
    value: string | number | boolean | null;
    /** Whether to use extracted value (true) or keep existing (false) */
    useExtracted: boolean;
  };
}

/**
 * Applied fields record for audit
 */
export interface AppliedFields {
  [fieldName: string]: {
    /** Original value before update */
    previousValue: string | number | boolean | null;
    /** New value that was applied */
    newValue: string | number | boolean | null;
    /** When the field was applied */
    appliedAt: string;
  };
}

// ============================================================================
// OCR Result (Database Record)
// ============================================================================

/**
 * OCR Result stored in document_ocr_results table
 */
export interface OcrResult {
  id: string;

  // Document reference
  documentId: string;
  documentTable: OcrDocumentTable;

  // Entity reference
  entityType: OcrEntityType;
  entityId: string;

  // Classification
  detectedDocumentType: string | null;
  classificationConfidence: number | null;

  // Raw OCR
  rawText: string | null;
  ocrTierUsed: OcrTier | null;

  // Extracted data
  extractedFields: ExtractedFields;

  // Metadata
  overallConfidence: number | null;
  processingTimeMs: number | null;
  pageCount: number;

  // Workflow
  status: OcrStatus;

  // Audit
  confirmedBy: string | null;
  confirmedAt: string | null;
  appliedFields: AppliedFields | null;

  // Timestamps
  createdAt: string;
  updatedAt: string;
}

/**
 * OCR Result from database (snake_case)
 */
export interface OcrResultRow {
  id: string;
  document_id: string;
  document_table: string;
  entity_type: string;
  entity_id: string;
  detected_document_type: string | null;
  classification_confidence: number | null;
  raw_text: string | null;
  ocr_tier_used: string | null;
  extracted_fields: ExtractedFields;
  overall_confidence: number | null;
  processing_time_ms: number | null;
  page_count: number;
  status: string;
  confirmed_by: string | null;
  confirmed_at: string | null;
  applied_fields: AppliedFields | null;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// API Request/Response Types
// ============================================================================

/**
 * Request to process OCR for a document
 * POST /api/documents/process-ocr
 */
export interface OcrProcessRequest {
  documentId: string;
  documentTable: OcrDocumentTable;
  entityType: OcrEntityType;
  entityId: string;
  /** Re-run OCR even if results exist */
  forceReprocess?: boolean;
}

/**
 * Response from OCR processing request
 */
export interface OcrProcessResponse {
  success: boolean;
  ocrResultId: string;
  status: 'processing' | 'completed' | 'failed';
  estimatedTime?: number;
  error?: string;
}

/**
 * Response from get OCR results
 * GET /api/documents/[id]/ocr-results
 */
export interface OcrResultsResponse {
  success: boolean;
  result: OcrResult | null;
  currentEntityData: Record<string, unknown>;
  error?: string;
}

/**
 * Request to confirm and apply OCR fields
 * POST /api/documents/[id]/ocr-results/confirm
 */
export interface OcrConfirmRequest {
  ocrResultId: string;
  fieldsToApply: FieldsToApply;
}

/**
 * Response from confirm OCR fields
 */
export interface OcrConfirmResponse {
  success: boolean;
  appliedFields: string[];
  updatedEntity: Record<string, unknown>;
  error?: string;
}

// ============================================================================
// Document Classification
// ============================================================================

/**
 * Document classification result
 */
export interface DocumentClassification {
  /** Detected document type */
  documentType: string;
  /** Classification confidence (0-1) */
  confidence: number;
  /** Keywords that matched */
  matchedKeywords: string[];
  /** Patterns that matched */
  matchedPatterns: string[];
}

// ============================================================================
// Field Mapping Configuration Types
// ============================================================================

/**
 * Validation rule for extracted fields
 */
export interface ValidationRule {
  /** Rule type */
  type: 'regex' | 'checksum' | 'range' | 'enum' | 'custom';
  /** Rule value (regex pattern, enum values, etc.) */
  value: string | string[] | number[];
  /** Error message if validation fails */
  errorMessage: string;
}

/**
 * Field mapping from OCR label to entity field
 */
export interface FieldMapping {
  /** Label in OCR output */
  ocrLabel: string;
  /** Field name in staff/contractor entity */
  entityField: string;
  /** Optional transformation function name */
  transform?: string;
  /** Validation rules */
  validationRules?: ValidationRule[];
}

/**
 * Document type configuration for OCR
 */
export interface DocumentTypeConfig {
  /** Document type identifier */
  documentType: string;
  /** Display name */
  displayName: string;
  /** Keywords for classification */
  keywords: string[];
  /** Regex patterns for classification */
  patterns: RegExp[];
  /** Field mappings for this document type */
  fieldMappings: FieldMapping[];
  /** Entity type this document applies to */
  entityType: OcrEntityType;
}

// ============================================================================
// OCR Service Types
// ============================================================================

/**
 * OCR service health response
 */
export interface OcrServiceHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  tiers: {
    tesseract: boolean;
    paddleocr: boolean;
    ocrspace: boolean;
    gemini: boolean;
  };
  version: string;
}

/**
 * Raw OCR extraction request
 */
export interface OcrExtractRequest {
  /** URL of the document in VF Storage */
  fileUrl: string;
  /** Preferred tier (optional, will cascade if fails) */
  preferredTier?: OcrTier;
}

/**
 * Raw OCR extraction response
 */
export interface OcrExtractResponse {
  success: boolean;
  text: string;
  confidence: number;
  tierUsed: OcrTier;
  processingTimeMs: number;
  pageCount: number;
  error?: string;
}

/**
 * Field extraction request
 */
export interface OcrFieldExtractionRequest {
  /** URL of the document */
  fileUrl: string;
  /** Document type (if known) for optimized extraction */
  documentType?: string;
  /** Entity type for field mapping */
  entityType: OcrEntityType;
}

/**
 * Field extraction response
 */
export interface OcrFieldExtractionResponse {
  success: boolean;
  classification: DocumentClassification;
  extractedFields: ExtractedFields;
  rawText: string;
  tierUsed: OcrTier;
  overallConfidence: number;
  processingTimeMs: number;
  pageCount: number;
  error?: string;
}

// ============================================================================
// Utility Types
// ============================================================================

/**
 * Map database row to OcrResult interface
 */
export function mapRowToOcrResult(row: OcrResultRow): OcrResult {
  return {
    id: row.id,
    documentId: row.document_id,
    documentTable: row.document_table as OcrDocumentTable,
    entityType: row.entity_type as OcrEntityType,
    entityId: row.entity_id,
    detectedDocumentType: row.detected_document_type,
    classificationConfidence: row.classification_confidence,
    rawText: row.raw_text,
    ocrTierUsed: row.ocr_tier_used as OcrTier | null,
    extractedFields: row.extracted_fields || {},
    overallConfidence: row.overall_confidence,
    processingTimeMs: row.processing_time_ms,
    pageCount: row.page_count || 1,
    status: row.status as OcrStatus,
    confirmedBy: row.confirmed_by,
    confirmedAt: row.confirmed_at,
    appliedFields: row.applied_fields,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Check if confidence meets auto-apply threshold
 */
export function meetsAutoApplyThreshold(confidence: number, threshold = 0.95): boolean {
  return confidence >= threshold;
}

/**
 * Check if confidence meets minimum threshold
 */
export function meetsMinConfidence(confidence: number, threshold = 0.70): boolean {
  return confidence >= threshold;
}

/**
 * OCR Learning Service
 *
 * Universal HITL (Human-In-The-Loop) learning for OCR field extraction.
 * Records human corrections and provides few-shot examples for VLM prompts.
 *
 * Supports multiple modules:
 * - staff_documents: SA ID, passport, driver's license, bank confirmation
 * - fleet_checkin: License plates, odometers, fuel gauges
 * - activate: DR data extraction (power meters, serials)
 *
 * Usage:
 * ```typescript
 * import { recordOcrCorrection, getOcrFewShotExamples } from '@/modules/qa-learning';
 *
 * // Record a human correction
 * await recordOcrCorrection({
 *   moduleName: 'staff_documents',
 *   documentType: 'sa_id',
 *   fieldName: 'saIdNumber',
 *   vlmExtractedValue: '780203S087081',
 *   correctedValue: '7802035087081',
 *   correctedBy: 'user@example.com',
 * });
 *
 * // Get few-shot examples for VLM prompt
 * const examples = await getOcrFewShotExamples('staff_documents', 'sa_id');
 * const promptSection = buildOcrFewShotPrompt(examples);
 * ```
 */

import { log } from '@/lib/logger';
import db from '@/lib/db';

// ============================================================================
// TYPES
// ============================================================================

export type OcrModuleName = 'staff_documents' | 'fleet_checkin' | 'activate' | string;

export type StaffDocumentType = 'sa_id' | 'passport' | 'drivers_license' | 'bank_confirmation' | 'employment_contract';
export type FleetDocumentType = 'license_plate' | 'odometer' | 'fuel_gauge';
export type ActivateDocumentType = 'power_meter' | 'ont_serial' | 'ups_serial' | 'dr_number';

export type OcrDocumentType = StaffDocumentType | FleetDocumentType | ActivateDocumentType | string;

export interface OcrCorrectionInput {
  moduleName: OcrModuleName;
  documentType: OcrDocumentType;
  fieldName: string;

  // VLM's extraction
  vlmExtractedValue?: string | null;
  vlmConfidence?: number;

  // Human's correction (ground truth)
  correctedValue: string;

  // Context
  imageDescription?: string;
  extractionContext?: Record<string, unknown>;
  correctionReason?: string;

  // Who made the correction
  correctedBy: string;

  // Optional reference to source record
  sourceRecordId?: string;
  sourceTable?: string;
}

export interface OcrCorrectionRecord {
  id: string;
  moduleName: string;
  documentType: string;
  fieldName: string;
  vlmExtractedValue: string | null;
  vlmConfidence: number | null;
  correctedValue: string;
  imageDescription: string | null;
  extractionContext: Record<string, unknown> | null;
  correctionReason: string | null;
  correctedBy: string | null;
  reviewedCount: number;
  isCanonical: boolean;
  sourceRecordId: string | null;
  sourceTable: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface OcrFewShotExample {
  fieldName: string;
  vlmExtractedValue: string | null;
  correctedValue: string;
  imageDescription: string | null;
  correctionReason: string | null;
}

export interface OcrFieldDefinition {
  id: string;
  moduleName: string;
  documentType: string;
  fieldName: string;
  displayLabel: string;
  fieldDescription: string | null;
  expectedFormat: string | null;
  validationRegex: string | null;
  isRequired: boolean;
  extractionHints: string | null;
  commonMistakes: string | null;
}

// ============================================================================
// DATABASE ROW TYPES
// ============================================================================

interface OcrCorrectionRow {
  id: string;
  module_name: string;
  document_type: string;
  field_name: string;
  vlm_extracted_value: string | null;
  vlm_confidence: string | null;
  corrected_value: string;
  image_description: string | null;
  extraction_context: Record<string, unknown> | null;
  correction_reason: string | null;
  corrected_by: string | null;
  reviewed_count: number;
  is_canonical: boolean;
  source_record_id: string | null;
  source_table: string | null;
  created_at: Date;
  updated_at: Date;
}

interface OcrFieldDefinitionRow {
  id: string;
  module_name: string;
  document_type: string;
  field_name: string;
  display_label: string;
  field_description: string | null;
  expected_format: string | null;
  validation_regex: string | null;
  is_required: boolean;
  extraction_hints: string | null;
  common_mistakes: string | null;
  created_at: Date;
}

// ============================================================================
// ERROR HANDLING
// ============================================================================

export class OcrLearningError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'OcrLearningError';
  }
}

// ============================================================================
// RECORD CORRECTIONS
// ============================================================================

/**
 * Record a human correction to VLM OCR extraction
 *
 * Only records corrections where the human changed the value.
 * If VLM was correct (vlmExtractedValue === correctedValue), this is a no-op.
 *
 * @param input - Correction details
 * @returns Created correction record, or null if no correction needed
 */
export async function recordOcrCorrection(
  input: OcrCorrectionInput
): Promise<OcrCorrectionRecord | null> {
  const startTime = Date.now();

  // Skip if VLM was correct
  if (input.vlmExtractedValue === input.correctedValue) {
    log.debug('OcrLearningService', 'Skipping correction - VLM was correct', {
      moduleName: input.moduleName,
      documentType: input.documentType,
      fieldName: input.fieldName,
    });
    return null;
  }

  // Skip if no meaningful correction
  if (!input.correctedValue || input.correctedValue.trim() === '') {
    log.debug('OcrLearningService', 'Skipping correction - empty corrected value');
    return null;
  }

  try {
    const result = await db.query<OcrCorrectionRow>(
      `INSERT INTO ocr_field_corrections (
        module_name,
        document_type,
        field_name,
        vlm_extracted_value,
        vlm_confidence,
        corrected_value,
        image_description,
        extraction_context,
        correction_reason,
        corrected_by,
        source_record_id,
        source_table
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *`,
      [
        input.moduleName,
        input.documentType,
        input.fieldName,
        input.vlmExtractedValue || null,
        input.vlmConfidence || null,
        input.correctedValue,
        input.imageDescription || null,
        input.extractionContext ? JSON.stringify(input.extractionContext) : null,
        input.correctionReason || null,
        input.correctedBy,
        input.sourceRecordId || null,
        input.sourceTable || null,
      ]
    );

    const correction = rowToOcrCorrection(result.rows[0]);
    const duration = Date.now() - startTime;

    log.info('OcrLearningService', 'Recorded OCR correction', {
      moduleName: input.moduleName,
      documentType: input.documentType,
      fieldName: input.fieldName,
      vlmValue: input.vlmExtractedValue?.substring(0, 20),
      correctedValue: input.correctedValue.substring(0, 20),
      duration,
    });

    return correction;
  } catch (error) {
    log.error('OcrLearningService', 'Failed to record correction', {
      error: error instanceof Error ? error.message : String(error),
      input: { ...input, correctedValue: input.correctedValue.substring(0, 20) },
    });

    throw new OcrLearningError(
      `Failed to record OCR correction: ${error instanceof Error ? error.message : String(error)}`,
      'DB_INSERT_FAILED',
      error
    );
  }
}

/**
 * Record multiple corrections at once (batch insert)
 *
 * @param corrections - Array of correction inputs
 * @returns Array of created correction records
 */
export async function recordOcrCorrections(
  corrections: OcrCorrectionInput[]
): Promise<OcrCorrectionRecord[]> {
  const results: OcrCorrectionRecord[] = [];

  for (const correction of corrections) {
    try {
      const result = await recordOcrCorrection(correction);
      if (result) {
        results.push(result);
      }
    } catch (error) {
      log.warn('OcrLearningService', 'Failed to record one correction in batch', {
        fieldName: correction.fieldName,
        error: error instanceof Error ? error.message : String(error),
      });
      // Continue with other corrections
    }
  }

  return results;
}

// ============================================================================
// FEW-SHOT EXAMPLES
// ============================================================================

/**
 * Get few-shot examples for VLM prompt enhancement
 *
 * @param moduleName - Module name (e.g., 'staff_documents')
 * @param documentType - Document type (e.g., 'sa_id')
 * @param options - Query options
 * @returns Array of few-shot examples
 */
export async function getOcrFewShotExamples(
  moduleName: OcrModuleName,
  documentType: OcrDocumentType,
  options: {
    fieldName?: string;
    maxExamples?: number;
    canonicalOnly?: boolean;
  } = {}
): Promise<OcrFewShotExample[]> {
  const { fieldName, maxExamples = 5, canonicalOnly = false } = options;

  try {
    let query = `
      SELECT
        field_name,
        vlm_extracted_value,
        corrected_value,
        image_description,
        correction_reason
      FROM ocr_field_corrections
      WHERE module_name = $1
        AND document_type = $2
        AND corrected_value IS NOT NULL
        AND corrected_value != ''
    `;
    const params: (string | number | boolean)[] = [moduleName, documentType];
    let paramIndex = 3;

    if (fieldName) {
      query += ` AND field_name = $${paramIndex}`;
      params.push(fieldName);
      paramIndex++;
    }

    if (canonicalOnly) {
      query += ` AND is_canonical = true`;
    }

    query += ` ORDER BY
      is_canonical DESC,
      reviewed_count DESC,
      vlm_confidence DESC NULLS LAST,
      created_at DESC
      LIMIT $${paramIndex}`;
    params.push(maxExamples);

    const result = await db.query<{
      field_name: string;
      vlm_extracted_value: string | null;
      corrected_value: string;
      image_description: string | null;
      correction_reason: string | null;
    }>(query, params);

    return result.rows.map((row) => ({
      fieldName: row.field_name,
      vlmExtractedValue: row.vlm_extracted_value,
      correctedValue: row.corrected_value,
      imageDescription: row.image_description,
      correctionReason: row.correction_reason,
    }));
  } catch (error) {
    log.error('OcrLearningService', 'Failed to get few-shot examples', {
      moduleName,
      documentType,
      error: error instanceof Error ? error.message : String(error),
    });

    return []; // Return empty array on error to not break VLM calls
  }
}

/**
 * Check if there are any corrections for a module/document type
 */
export async function hasOcrCorrections(
  moduleName: OcrModuleName,
  documentType?: OcrDocumentType
): Promise<boolean> {
  try {
    let query = `SELECT 1 FROM ocr_field_corrections WHERE module_name = $1`;
    const params: string[] = [moduleName];

    if (documentType) {
      query += ` AND document_type = $2`;
      params.push(documentType);
    }

    query += ` LIMIT 1`;

    const result = await db.query(query, params);
    return result.rows.length > 0;
  } catch {
    return false;
  }
}

// ============================================================================
// PROMPT BUILDING
// ============================================================================

/**
 * Build a few-shot prompt section from examples
 *
 * @param examples - Few-shot examples
 * @param documentType - Document type for context
 * @returns Formatted prompt section
 */
export function buildOcrFewShotPrompt(
  examples: OcrFewShotExample[],
  documentType: string
): string {
  if (examples.length === 0) {
    return '';
  }

  const lines = [
    `\n## Learning from Previous Corrections (${documentType})`,
    'These are examples of common OCR mistakes and their corrections:',
    '',
  ];

  for (const example of examples) {
    lines.push(`- Field: ${example.fieldName}`);
    lines.push(`  VLM extracted: "${example.vlmExtractedValue || '(empty)'}"`);
    lines.push(`  Correct value: "${example.correctedValue}"`);
    if (example.correctionReason) {
      lines.push(`  Note: ${example.correctionReason}`);
    }
    lines.push('');
  }

  lines.push('Please apply these learnings to avoid similar mistakes.');
  lines.push('');

  return lines.join('\n');
}

// ============================================================================
// FIELD DEFINITIONS
// ============================================================================

/**
 * Get field definitions for a document type
 *
 * @param moduleName - Module name
 * @param documentType - Document type
 * @returns Array of field definitions
 */
export async function getOcrFieldDefinitions(
  moduleName: OcrModuleName,
  documentType: OcrDocumentType
): Promise<OcrFieldDefinition[]> {
  try {
    const result = await db.query<OcrFieldDefinitionRow>(
      `SELECT * FROM ocr_field_definitions
       WHERE module_name = $1 AND document_type = $2
       ORDER BY is_required DESC, field_name ASC`,
      [moduleName, documentType]
    );

    return result.rows.map((row) => ({
      id: row.id,
      moduleName: row.module_name,
      documentType: row.document_type,
      fieldName: row.field_name,
      displayLabel: row.display_label,
      fieldDescription: row.field_description,
      expectedFormat: row.expected_format,
      validationRegex: row.validation_regex,
      isRequired: row.is_required,
      extractionHints: row.extraction_hints,
      commonMistakes: row.common_mistakes,
    }));
  } catch (error) {
    log.error('OcrLearningService', 'Failed to get field definitions', {
      moduleName,
      documentType,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/**
 * Build extraction hints prompt from field definitions
 */
export function buildExtractionHintsPrompt(definitions: OcrFieldDefinition[]): string {
  if (definitions.length === 0) {
    return '';
  }

  const lines = ['\n## Field Extraction Guidelines', ''];

  for (const def of definitions) {
    lines.push(`### ${def.displayLabel} (${def.fieldName})`);
    if (def.expectedFormat) {
      lines.push(`- Expected format: ${def.expectedFormat}`);
    }
    if (def.extractionHints) {
      lines.push(`- Hint: ${def.extractionHints}`);
    }
    if (def.commonMistakes) {
      lines.push(`- Watch out: ${def.commonMistakes}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ============================================================================
// STATISTICS
// ============================================================================

/**
 * Get correction statistics for a module/document type
 */
export async function getOcrCorrectionStats(
  moduleName: OcrModuleName,
  documentType?: OcrDocumentType
): Promise<{
  totalCorrections: number;
  canonicalCount: number;
  recentCorrections: number;
  topCorrectedFields: Array<{ fieldName: string; count: number }>;
}> {
  try {
    let whereClause = 'module_name = $1';
    const params: string[] = [moduleName];

    if (documentType) {
      whereClause += ' AND document_type = $2';
      params.push(documentType);
    }

    const countsResult = await db.query<{
      total: string;
      canonical: string;
      recent: string;
    }>(
      `SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE is_canonical = true) as canonical,
        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '30 days') as recent
       FROM ocr_field_corrections
       WHERE ${whereClause}`,
      params
    );

    const topFieldsResult = await db.query<{ field_name: string; count: string }>(
      `SELECT field_name, COUNT(*) as count
       FROM ocr_field_corrections
       WHERE ${whereClause}
       GROUP BY field_name
       ORDER BY count DESC
       LIMIT 5`,
      params
    );

    const counts = countsResult.rows[0] || { total: '0', canonical: '0', recent: '0' };

    return {
      totalCorrections: parseInt(counts.total, 10),
      canonicalCount: parseInt(counts.canonical, 10),
      recentCorrections: parseInt(counts.recent, 10),
      topCorrectedFields: topFieldsResult.rows.map((row) => ({
        fieldName: row.field_name,
        count: parseInt(row.count, 10),
      })),
    };
  } catch (error) {
    log.error('OcrLearningService', 'Failed to get correction stats', {
      moduleName,
      documentType,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      totalCorrections: 0,
      canonicalCount: 0,
      recentCorrections: 0,
      topCorrectedFields: [],
    };
  }
}

// ============================================================================
// CONVERTERS
// ============================================================================

function rowToOcrCorrection(row: OcrCorrectionRow): OcrCorrectionRecord {
  return {
    id: row.id,
    moduleName: row.module_name,
    documentType: row.document_type,
    fieldName: row.field_name,
    vlmExtractedValue: row.vlm_extracted_value,
    vlmConfidence: row.vlm_confidence ? parseFloat(row.vlm_confidence) : null,
    correctedValue: row.corrected_value,
    imageDescription: row.image_description,
    extractionContext: row.extraction_context,
    correctionReason: row.correction_reason,
    correctedBy: row.corrected_by,
    reviewedCount: row.reviewed_count,
    isCanonical: row.is_canonical,
    sourceRecordId: row.source_record_id,
    sourceTable: row.source_table,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

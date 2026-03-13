/**
 * VLM Learning Service
 *
 * Enterprise-wide service for VLM learning using HITL corrections.
 * Provides:
 * - Correction recording across all modules
 * - Few-shot example retrieval for prompt enhancement
 * - Error pattern classification
 * - Metrics recording and aggregation
 *
 * @module services/vlmLearningService
 */

import { neon } from '@/lib/db-neon';
import { log } from '@/lib/logger';
import { createHash } from 'crypto';
import type {
  VlmModule,
  VlmAnalysisType,
  VlmCorrection,
  RecordCorrectionInput,
  FewShotExample,
  GetFewShotOptions,
  VlmMetricsSummary,
  CorrectionReason,
  ErrorPattern,
  ModuleAccuracySummary,
} from '@/types/vlm-learning';

const sql = neon(process.env.DATABASE_URL!);

// ============================================================================
// CORRECTION RECORDING
// ============================================================================

/**
 * Record a VLM correction for learning
 *
 * @param input - Correction details
 * @returns The created correction record
 */
export async function recordVlmCorrection(
  input: RecordCorrectionInput
): Promise<VlmCorrection> {
  const {
    module,
    analysisType,
    sourceId,
    sourceTable,
    photoUrl,
    vlmExtractedValue,
    vlmConfidence,
    vlmModel,
    vlmPromptHash,
    correctedValue,
    correctionReason,
    correctionNotes,
    context,
    correctedByName,
    correctedById,
  } = input;

  // Auto-classify error pattern if not provided
  const errorPattern = classifyErrorPattern(vlmExtractedValue, correctedValue, analysisType);

  try {
    const result = await sql`
      INSERT INTO vlm_corrections (
        module, analysis_type, source_id, source_table, photo_url,
        vlm_extracted_value, vlm_confidence, vlm_model, vlm_prompt_hash,
        corrected_value, correction_reason, error_pattern, correction_notes,
        context_json, reviewed_by, corrected_by_name
      ) VALUES (
        ${module}, ${analysisType}, ${sourceId || null}, ${sourceTable || null}, ${photoUrl || null},
        ${vlmExtractedValue}, ${vlmConfidence || null}, ${vlmModel || null}, ${vlmPromptHash || null},
        ${correctedValue}, ${correctionReason || null}, ${errorPattern}, ${correctionNotes || null},
        ${JSON.stringify(context || {})}, ${correctedById || null}, ${correctedByName || null}
      )
      RETURNING *
    `;

    const row = result[0];
    log.info(`Recorded correction: ${module}/${analysisType} - "${vlmExtractedValue}" → "${correctedValue}"`);

    // Record metric for the correction
    await recordExtractionMetric({
      module,
      analysisType,
      wasCorrect: false,
      wasCorrected: true,
      errorPattern: errorPattern || undefined,
    });

    return mapCorrectionRow(row as Record<string, unknown>);
  } catch (error) {
    log.error(`Failed to record correction: ${error}`);
    throw error;
  }
}

/**
 * Mark a correction as canonical (high-quality example)
 */
export async function markAsCanonical(
  correctionId: string,
  isCanonical: boolean,
  priority?: number
): Promise<void> {
  try {
    await sql`
      UPDATE vlm_corrections
      SET is_canonical = ${isCanonical}, priority = COALESCE(${priority}, priority)
      WHERE id = ${correctionId}
    `;
    log.info(`Updated correction ${correctionId} canonical=${isCanonical}`);
  } catch (error) {
    log.error(`Failed to update canonical status: ${error}`);
    throw error;
  }
}

// ============================================================================
// FEW-SHOT RETRIEVAL
// ============================================================================

/**
 * Get few-shot examples for prompt enhancement
 *
 * Retrieves relevant correction examples to inject into VLM prompts.
 * Prioritizes canonical examples and matches by context when available.
 *
 * @param options - Retrieval options
 * @returns Array of few-shot examples
 */
export async function getVlmFewShotExamples(
  options: GetFewShotOptions
): Promise<FewShotExample[]> {
  const {
    module,
    analysisType,
    context,
    maxExamples = 3,
    prioritizeCanonical = true,
    includePhotos = false,
  } = options;

  try {
    // Query: prioritize canonical, then recent, with context matching
    const rows = await sql`
      SELECT
        vlm_extracted_value,
        corrected_value,
        correction_notes,
        error_pattern,
        context_json,
        photo_url,
        is_canonical,
        priority
      FROM vlm_corrections
      WHERE module = ${module}
        AND analysis_type = ${analysisType}
        AND corrected_value IS NOT NULL
      ORDER BY
        is_canonical DESC,
        priority DESC,
        created_at DESC
      LIMIT ${maxExamples * 2}
    `;

    // If we have context, score by similarity
    let examples = rows.map((row) => ({
      incorrect: row.vlm_extracted_value,
      correct: row.corrected_value,
      context: row.correction_notes || undefined,
      errorPattern: row.error_pattern as ErrorPattern | undefined,
      photoUrl: includePhotos ? row.photo_url : undefined,
      isCanonical: row.is_canonical,
      priority: row.priority || 0,
      contextJson: row.context_json || {},
    }));

    // Score by context similarity if context provided
    if (context && Object.keys(context).length > 0) {
      examples = examples.map((ex) => ({
        ...ex,
        _score: calculateContextSimilarity(ex.contextJson, context),
      }));
      examples.sort((a, b) => {
        // Canonical first, then by score, then by priority
        if (a.isCanonical !== b.isCanonical) return a.isCanonical ? -1 : 1;
        const aScore = (a as { _score?: number })._score || 0;
        const bScore = (b as { _score?: number })._score || 0;
        if (aScore !== bScore) return bScore - aScore;
        return b.priority - a.priority;
      });
    }

    // Take top N examples
    const result: FewShotExample[] = examples.slice(0, maxExamples).map((ex) => ({
      incorrect: ex.incorrect,
      correct: ex.correct,
      context: ex.context,
      errorPattern: ex.errorPattern,
      photoUrl: ex.photoUrl,
    }));

    log.info(`Retrieved ${result.length} few-shot examples for ${module}/${analysisType}`);
    return result;
  } catch (error) {
    log.error(`Failed to get few-shot examples: ${error}`);
    return [];
  }
}

/**
 * Build a few-shot prompt section from examples
 *
 * @param examples - Few-shot examples
 * @param format - Output format
 * @returns Formatted prompt section
 */
export function buildVlmFewShotPrompt(
  examples: FewShotExample[],
  format: 'markdown' | 'json' = 'markdown'
): string {
  if (examples.length === 0) return '';

  if (format === 'json') {
    return JSON.stringify(
      {
        correction_examples: examples.map((ex) => ({
          incorrect: ex.incorrect,
          correct: ex.correct,
          note: ex.context,
        })),
      },
      null,
      2
    );
  }

  // Markdown format
  const lines = ['### CORRECTION EXAMPLES (Learn from past mistakes):', ''];

  for (const ex of examples) {
    if (ex.incorrect) {
      lines.push(`❌ WRONG: "${ex.incorrect}"`);
    }
    lines.push(`✅ CORRECT: "${ex.correct}"`);
    if (ex.context) {
      lines.push(`   Note: ${ex.context}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Calculate similarity between two context objects
 */
function calculateContextSimilarity(
  storedContext: Record<string, unknown>,
  queryContext: Record<string, unknown>
): number {
  if (!storedContext || !queryContext) return 0;

  const storedKeys = Object.keys(storedContext);
  const queryKeys = Object.keys(queryContext);

  if (storedKeys.length === 0 || queryKeys.length === 0) return 0;

  let matches = 0;
  let total = 0;

  for (const key of queryKeys) {
    if (key in storedContext) {
      total++;
      if (storedContext[key] === queryContext[key]) {
        matches++;
      }
    }
  }

  return total > 0 ? matches / total : 0;
}

// ============================================================================
// ERROR CLASSIFICATION
// ============================================================================

/**
 * Classify the error pattern based on VLM vs correct value
 *
 * @param vlmValue - What VLM extracted
 * @param correctValue - The correct value
 * @param analysisType - Type of analysis
 * @returns Classified error pattern or null
 */
export function classifyErrorPattern(
  vlmValue: string | null,
  correctValue: string,
  analysisType: VlmAnalysisType
): ErrorPattern | null {
  if (!vlmValue) return null;

  const vlm = vlmValue.toString().trim();
  const correct = correctValue.toString().trim();

  // Check for ONT serial field confusion
  if (analysisType === 'ont_serial_back' || analysisType === 'ont_serial_front') {
    if (vlm.startsWith('ALHN-')) return 'ssid_not_serial';
    if (vlm.startsWith('STN')) return 'part_number_not_serial';
    if (/^[0-9A-F]{12}$/i.test(vlm)) return 'mac_not_serial';

    // Serial-specific digit confusion (hex chars, not just numeric)
    if (vlm.length !== correct.length) return 'length_mismatch' as ErrorPattern;
    let diffCount = 0;
    const diffs: string[] = [];
    for (let i = 0; i < vlm.length; i++) {
      if (vlm[i] !== correct[i]) {
        diffCount++;
        diffs.push(`${vlm[i]}${correct[i]}`);
      }
    }
    if (diffCount === 1 && diffs[0]) {
      const pair = diffs[0];
      const confusions: Record<string, ErrorPattern> = {
        '17': 'digit_1_7', '71': 'digit_1_7',
        '16': 'digit_1_6', '61': 'digit_1_6',
        '68': 'digit_6_8', '86': 'digit_6_8',
        '80': 'digit_8_0', '08': 'digit_8_0',
        '94': 'digit_9_4', '49': 'digit_9_4',
        '23': 'digit_2_3', '32': 'digit_2_3',
      };
      return confusions[pair] || `single_char_${diffCount}` as ErrorPattern;
    }
    if (diffCount <= 3) return `multi_char_${diffCount}` as ErrorPattern;
    return 'totally_wrong' as ErrorPattern;
  }

  // Check for odometer digit confusion
  if (analysisType === 'odometer') {
    const pattern = detectDigitConfusionPattern(vlm, correct);
    if (pattern) return pattern;

    // Check for trip meter vs odometer
    if (vlm.length < correct.length - 1) return 'trip_not_odometer';
  }

  // Check for fuel gauge reversed
  if (analysisType === 'fuel_gauge') {
    const vlmNum = parseFloat(vlm);
    const correctNum = parseFloat(correct);
    if (!isNaN(vlmNum) && !isNaN(correctNum)) {
      // If difference is roughly 100 - x, gauge might be read backwards
      if (Math.abs(vlmNum + correctNum - 100) < 10) return 'gauge_reversed';
    }
  }

  // Check for decimal issues
  if (vlm.includes('.') !== correct.includes('.')) {
    return vlm.includes('.') ? 'extra_decimal' : 'missed_decimal';
  }

  return null;
}

/**
 * Detect digit confusion patterns between two number strings
 */
function detectDigitConfusionPattern(vlm: string, correct: string): ErrorPattern | null {
  // Must be same length for digit confusion
  if (vlm.length !== correct.length) return null;

  // Only consider numeric strings
  if (!/^\d+$/.test(vlm) || !/^\d+$/.test(correct)) return null;

  const confusionPairs: Record<string, ErrorPattern> = {
    '16': 'digit_1_6',
    '61': 'digit_1_6',
    '17': 'digit_1_7',
    '71': 'digit_1_7',
    '23': 'digit_2_3',
    '32': 'digit_2_3',
    '68': 'digit_6_8',
    '86': 'digit_6_8',
    '80': 'digit_8_0',
    '08': 'digit_8_0',
    '94': 'digit_9_4',
    '49': 'digit_9_4',
  };

  for (let i = 0; i < vlm.length; i++) {
    const vlmChar = vlm[i];
    const correctChar = correct[i];
    if (vlmChar && correctChar && vlmChar !== correctChar) {
      const pair = vlmChar + correctChar;
      if (confusionPairs[pair]) {
        return confusionPairs[pair];
      }
    }
  }

  return null;
}

// ============================================================================
// METRICS RECORDING
// ============================================================================

interface RecordMetricInput {
  module: VlmModule;
  analysisType: VlmAnalysisType;
  wasCorrect: boolean;
  wasCorrected?: boolean;
  confidence?: number;
  errorPattern?: ErrorPattern;
}

/**
 * Record a VLM extraction metric
 *
 * Upserts into daily metrics table for aggregation.
 */
export async function recordExtractionMetric(input: RecordMetricInput): Promise<void> {
  const { module, analysisType, wasCorrect, wasCorrected, confidence, errorPattern } = input;

  const today = new Date().toISOString().split('T')[0];

  try {
    // Build error count increments
    const digitConfusionInc = errorPattern?.startsWith('digit_') ? 1 : 0;
    const formatErrorInc =
      errorPattern === 'missed_decimal' || errorPattern === 'extra_decimal' ? 1 : 0;
    const partialExtractionInc = 0; // TODO: detect partial extractions
    const fieldConfusionInc =
      errorPattern === 'ssid_not_serial' ||
      errorPattern === 'part_number_not_serial' ||
      errorPattern === 'mac_not_serial'
        ? 1
        : 0;

    await sql`
      INSERT INTO vlm_metrics (
        metric_date, module, analysis_type,
        total_extractions, correct_extractions, corrected_extractions, failed_extractions,
        avg_confidence,
        digit_confusion_count, format_error_count, partial_extraction_count, field_confusion_count
      ) VALUES (
        ${today}::date, ${module}, ${analysisType},
        1,
        ${wasCorrect && !wasCorrected ? 1 : 0},
        ${wasCorrected ? 1 : 0},
        ${!wasCorrect && !wasCorrected ? 1 : 0},
        ${confidence || null},
        ${digitConfusionInc}, ${formatErrorInc}, ${partialExtractionInc}, ${fieldConfusionInc}
      )
      ON CONFLICT (metric_date, module, analysis_type) DO UPDATE SET
        total_extractions = vlm_metrics.total_extractions + 1,
        correct_extractions = vlm_metrics.correct_extractions + ${wasCorrect && !wasCorrected ? 1 : 0},
        corrected_extractions = vlm_metrics.corrected_extractions + ${wasCorrected ? 1 : 0},
        failed_extractions = vlm_metrics.failed_extractions + ${!wasCorrect && !wasCorrected ? 1 : 0},
        avg_confidence = CASE
          WHEN ${confidence || null}::numeric IS NOT NULL THEN
            (COALESCE(vlm_metrics.avg_confidence, 0) * vlm_metrics.total_extractions + ${confidence || 0}) / (vlm_metrics.total_extractions + 1)
          ELSE vlm_metrics.avg_confidence
        END,
        digit_confusion_count = vlm_metrics.digit_confusion_count + ${digitConfusionInc},
        format_error_count = vlm_metrics.format_error_count + ${formatErrorInc},
        partial_extraction_count = vlm_metrics.partial_extraction_count + ${partialExtractionInc},
        field_confusion_count = vlm_metrics.field_confusion_count + ${fieldConfusionInc},
        updated_at = NOW()
    `;
  } catch (error) {
    // Don't fail the main operation if metrics recording fails
    log.error(`Failed to record metric: ${error}`);
  }
}

/**
 * Record a correct extraction (no correction needed)
 */
export async function recordCorrectExtraction(
  module: VlmModule,
  analysisType: VlmAnalysisType,
  confidence?: number
): Promise<void> {
  await recordExtractionMetric({
    module,
    analysisType,
    wasCorrect: true,
    confidence,
  });
}

// ============================================================================
// METRICS RETRIEVAL
// ============================================================================

interface GetMetricsOptions {
  module?: VlmModule;
  analysisType?: VlmAnalysisType;
  dateFrom?: Date;
  dateTo?: Date;
  groupBy?: 'day' | 'week' | 'month';
}

/**
 * Get aggregated VLM metrics
 */
export async function getVlmMetrics(options: GetMetricsOptions): Promise<VlmMetricsSummary> {
  const { module, analysisType, dateFrom, dateTo, groupBy = 'day' } = options;

  const from = dateFrom || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days ago
  const to = dateTo || new Date();

  try {
    // Get totals
    const totalsResult = await sql`
      SELECT
        COALESCE(SUM(total_extractions), 0) as total,
        COALESCE(SUM(correct_extractions), 0) as correct,
        COALESCE(SUM(corrected_extractions), 0) as corrected,
        COALESCE(SUM(failed_extractions), 0) as failed
      FROM vlm_metrics
      WHERE metric_date >= ${from.toISOString().split('T')[0]}::date
        AND metric_date <= ${to.toISOString().split('T')[0]}::date
        ${module ? sql`AND module = ${module}` : sql``}
        ${analysisType ? sql`AND analysis_type = ${analysisType}` : sql``}
    `;

    const totals = totalsResult[0] || { total: 0, correct: 0, corrected: 0, failed: 0 };
    const totalExtractions = Number(totals.total) || 0;
    const overallAccuracy =
      totalExtractions > 0
        ? (Number(totals.correct) + Number(totals.corrected)) / totalExtractions
        : 0;

    // Get daily breakdown
    const dailyResult = await sql`
      SELECT
        metric_date::text as date,
        SUM(total_extractions) as count,
        CASE
          WHEN SUM(total_extractions) > 0 THEN
            (SUM(correct_extractions) + SUM(corrected_extractions))::numeric / SUM(total_extractions)
          ELSE 0
        END as rate
      FROM vlm_metrics
      WHERE metric_date >= ${from.toISOString().split('T')[0]}::date
        AND metric_date <= ${to.toISOString().split('T')[0]}::date
        ${module ? sql`AND module = ${module}` : sql``}
        ${analysisType ? sql`AND analysis_type = ${analysisType}` : sql``}
      GROUP BY metric_date
      ORDER BY metric_date ASC
    `;

    // Get top error patterns
    const errorResult = await sql`
      SELECT
        error_pattern,
        COUNT(*) as count
      FROM vlm_corrections
      WHERE created_at >= ${from.toISOString()}
        AND created_at <= ${to.toISOString()}
        AND error_pattern IS NOT NULL
        ${module ? sql`AND module = ${module}` : sql``}
        ${analysisType ? sql`AND analysis_type = ${analysisType}` : sql``}
      GROUP BY error_pattern
      ORDER BY count DESC
      LIMIT 5
    `;

    const totalErrors = errorResult.reduce((sum, row) => sum + Number(row.count), 0);

    return {
      module: module || 'all',
      analysisType: analysisType || 'all',
      period: { from, to },
      totals: {
        extractions: totalExtractions,
        correct: Number(totals.correct) || 0,
        corrected: Number(totals.corrected) || 0,
        failed: Number(totals.failed) || 0,
      },
      accuracy: {
        overall: overallAccuracy,
        byDay: dailyResult.map((row) => ({
          date: row.date,
          rate: Number(row.rate) || 0,
          count: Number(row.count) || 0,
        })),
      },
      topErrors: errorResult.map((row) => ({
        pattern: row.error_pattern as ErrorPattern,
        count: Number(row.count) || 0,
        percentage: totalErrors > 0 ? (Number(row.count) / totalErrors) * 100 : 0,
      })),
    };
  } catch (error) {
    log.error(`Failed to get metrics: ${error}`);
    throw error;
  }
}

/**
 * Get accuracy summary by module
 */
export async function getModuleAccuracySummaries(): Promise<ModuleAccuracySummary[]> {
  try {
    // Get current period (last 7 days)
    const now = new Date();
    const currentStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // Get previous period (7-14 days ago)
    const prevStart = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    const prevEnd = currentStart;

    const result = await sql`
      WITH current_period AS (
        SELECT
          module,
          SUM(total_extractions) as total,
          SUM(correct_extractions + corrected_extractions) as accurate,
          SUM(corrected_extractions) as corrections
        FROM vlm_metrics
        WHERE metric_date >= ${currentStart.toISOString().split('T')[0]}::date
        GROUP BY module
      ),
      prev_period AS (
        SELECT
          module,
          SUM(total_extractions) as total,
          SUM(correct_extractions + corrected_extractions) as accurate
        FROM vlm_metrics
        WHERE metric_date >= ${prevStart.toISOString().split('T')[0]}::date
          AND metric_date < ${prevEnd.toISOString().split('T')[0]}::date
        GROUP BY module
      )
      SELECT
        c.module,
        c.total,
        c.accurate,
        c.corrections,
        CASE WHEN c.total > 0 THEN c.accurate::numeric / c.total ELSE 0 END as accuracy,
        CASE WHEN p.total > 0 THEN p.accurate::numeric / p.total ELSE 0 END as prev_accuracy
      FROM current_period c
      LEFT JOIN prev_period p ON c.module = p.module
      ORDER BY c.total DESC
    `;

    const moduleNames: Record<VlmModule, string> = {
      activate: 'Activate (Installations)',
      fleet: 'Fleet Management',
      procurement: 'Procurement',
      assets: 'Assets',
      staff: 'Staff/HR',
      qfield: 'QField QA',
      construction_qa: 'Construction QA',
    };

    return result.map((row) => {
      const currentAccuracy = Number(row.accuracy) || 0;
      const prevAccuracy = Number(row.prev_accuracy) || 0;
      const diff = currentAccuracy - prevAccuracy;

      return {
        module: row.module as VlmModule,
        displayName: moduleNames[row.module as VlmModule] || row.module,
        totalExtractions: Number(row.total) || 0,
        accuracy: currentAccuracy,
        correctionCount: Number(row.corrections) || 0,
        trend: diff > 0.01 ? 'up' : diff < -0.01 ? 'down' : 'stable',
        trendValue: diff,
      };
    });
  } catch (error) {
    log.error(`Failed to get module summaries: ${error}`);
    return [];
  }
}

// ============================================================================
// CORRECTIONS LIST
// ============================================================================

interface ListCorrectionsOptions {
  module?: VlmModule;
  analysisType?: VlmAnalysisType;
  errorPattern?: ErrorPattern;
  isCanonical?: boolean;
  dateFrom?: Date;
  dateTo?: Date;
  limit?: number;
  offset?: number;
}

/**
 * List corrections with filtering
 */
export async function listCorrections(
  options: ListCorrectionsOptions
): Promise<{ corrections: VlmCorrection[]; total: number }> {
  const { module, analysisType, errorPattern, isCanonical, dateFrom, dateTo, limit = 50, offset = 0 } = options;

  try {
    // Get total count
    const countResult = await sql`
      SELECT COUNT(*) as count
      FROM vlm_corrections
      WHERE 1=1
        ${module ? sql`AND module = ${module}` : sql``}
        ${analysisType ? sql`AND analysis_type = ${analysisType}` : sql``}
        ${errorPattern ? sql`AND error_pattern = ${errorPattern}` : sql``}
        ${isCanonical !== undefined ? sql`AND is_canonical = ${isCanonical}` : sql``}
        ${dateFrom ? sql`AND created_at >= ${dateFrom.toISOString()}` : sql``}
        ${dateTo ? sql`AND created_at <= ${dateTo.toISOString()}` : sql``}
    `;

    const total = Number(countResult[0]?.count) || 0;

    // Get corrections
    const rows = await sql`
      SELECT *
      FROM vlm_corrections
      WHERE 1=1
        ${module ? sql`AND module = ${module}` : sql``}
        ${analysisType ? sql`AND analysis_type = ${analysisType}` : sql``}
        ${errorPattern ? sql`AND error_pattern = ${errorPattern}` : sql``}
        ${isCanonical !== undefined ? sql`AND is_canonical = ${isCanonical}` : sql``}
        ${dateFrom ? sql`AND created_at >= ${dateFrom.toISOString()}` : sql``}
        ${dateTo ? sql`AND created_at <= ${dateTo.toISOString()}` : sql``}
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    return {
      corrections: rows.map(mapCorrectionRow),
      total,
    };
  } catch (error) {
    log.error(`Failed to list corrections: ${error}`);
    throw error;
  }
}

/**
 * Delete a correction
 */
export async function deleteCorrection(correctionId: string): Promise<void> {
  try {
    await sql`DELETE FROM vlm_corrections WHERE id = ${correctionId}`;
    log.info(`Deleted correction ${correctionId}`);
  } catch (error) {
    log.error(`Failed to delete correction: ${error}`);
    throw error;
  }
}

// ============================================================================
// PROMPT VERSIONING
// ============================================================================

/**
 * Generate a hash for prompt content (for tracking versions)
 */
export function hashPromptContent(content: string): string {
  return createHash('sha256').update(content).digest('hex').substring(0, 16);
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Map database row to VlmCorrection type
 */
function mapCorrectionRow(row: Record<string, unknown>): VlmCorrection {
  return {
    id: row.id as string,
    module: row.module as VlmModule,
    analysisType: row.analysis_type as VlmAnalysisType,
    sourceId: row.source_id as string | null,
    sourceTable: row.source_table as string | null,
    photoUrl: row.photo_url as string | null,
    vlmExtractedValue: row.vlm_extracted_value as string | null,
    vlmConfidence: row.vlm_confidence ? Number(row.vlm_confidence) : null,
    vlmModel: row.vlm_model as string | null,
    vlmPromptHash: row.vlm_prompt_hash as string | null,
    correctedValue: row.corrected_value as string,
    correctionReason: row.correction_reason as CorrectionReason | null,
    errorPattern: row.error_pattern as ErrorPattern | null,
    correctionNotes: row.correction_notes as string | null,
    contextJson: (row.context_json as Record<string, unknown>) || {},
    isCanonical: row.is_canonical as boolean,
    priority: Number(row.priority) || 0,
    reviewedBy: row.reviewed_by as string | null,
    correctedByName: row.corrected_by_name as string | null,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

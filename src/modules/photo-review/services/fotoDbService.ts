/**
 * Foto Review Database Service
 * Database operations for AI photo evaluations
 * Uses Neon PostgreSQL serverless client
 *
 * Table: dr_photo_unified_reviews (after migration 127)
 * Purpose: Store AI evaluation results for installation drops
 */

import { neon } from '@/lib/db-neon';
import type { EvaluationResult } from '../types';
import { log } from '@/lib/logger';

// Database connection - initialized lazily at runtime
function getDbConnection() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL environment variable is not set');
  }
  return neon(databaseUrl);
}

// ==================== FETCH OPERATIONS ====================

/**
 * Get evaluation by DR number
 * @param drNumber - Drop record number
 * @returns Evaluation result or null if not found
 */
export async function getEvaluationByDR(drNumber: string): Promise<EvaluationResult | null> {
  try {
    const sql = getDbConnection();
    const rows = await sql`
      SELECT
        drop_number as dr_number,
        overall_status,
        average_score,
        total_steps,
        passed_steps,
        step_results,
        markdown_report,
        feedback_sent,
        feedback_sent_at,
        evaluation_date,
        created_at,
        updated_at
      FROM dr_photo_unified_reviews
      WHERE drop_number = ${drNumber}
      LIMIT 1
    `;

    if (rows.length === 0) {
      return null;
    }

    const row = rows[0];
    return transformDbRowToEvaluation(row);
  } catch (error) {
    log.error(`Error fetching evaluation for DR ${drNumber}`, { error }, 'fotoDbService');
    throw new Error('Failed to fetch evaluation from database');
  }
}

/**
 * Get all evaluations with optional filtering
 * @param filters - Optional filters (status, date range, etc.)
 * @returns Array of evaluation results
 */
export async function getAllEvaluations(filters?: {
  status?: 'PASS' | 'FAIL';
  feedbackSent?: boolean;
  dateFrom?: Date;
  dateTo?: Date;
}): Promise<EvaluationResult[]> {
  try {
    const sql = getDbConnection();

    // Build WHERE clause dynamically
    const whereConditions: string[] = [];

    if (filters?.status) {
      whereConditions.push(`overall_status = '${filters.status}'`);
    }

    if (filters?.feedbackSent !== undefined) {
      whereConditions.push(`feedback_sent = ${filters.feedbackSent}`);
    }

    if (filters?.dateFrom) {
      whereConditions.push(`evaluation_date >= '${filters.dateFrom.toISOString()}'`);
    }

    if (filters?.dateTo) {
      whereConditions.push(`evaluation_date <= '${filters.dateTo.toISOString()}'`);
    }

    const whereClause = whereConditions.length > 0
      ? `WHERE ${whereConditions.join(' AND ')}`
      : '';

    const rows = await sql`
      SELECT
        drop_number as dr_number,
        overall_status,
        average_score,
        total_steps,
        passed_steps,
        step_results,
        markdown_report,
        feedback_sent,
        feedback_sent_at,
        evaluation_date,
        created_at,
        updated_at
      FROM dr_photo_unified_reviews
      ${sql.unsafe(whereClause)}
      ORDER BY evaluation_date DESC
    `;

    return rows.map(transformDbRowToEvaluation);
  } catch (error) {
    log.error('Error fetching evaluations', { error }, 'fotoDbService');
    throw new Error('Failed to fetch evaluations from database');
  }
}

// ==================== CREATE/UPDATE OPERATIONS ====================

/**
 * Save or update evaluation result
 * @param evaluation - Evaluation result to save
 * @returns Saved evaluation result
 */
export async function saveEvaluation(evaluation: EvaluationResult): Promise<EvaluationResult> {
  try {
    const sql = getDbConnection();

    // Convert step_results to JSON string for JSONB column
    const stepResultsJson = JSON.stringify(evaluation.step_results);

    // Update unified table directly (after migration 127)
    await sql`
      UPDATE dr_photo_unified_reviews
      SET
        overall_status = ${evaluation.overall_status},
        average_score = ${evaluation.average_score},
        total_steps = ${evaluation.total_steps},
        passed_steps = ${evaluation.passed_steps},
        step_results = ${stepResultsJson}::jsonb,
        markdown_report = ${evaluation.markdown_report || null},
        -- Never allow saveEvaluation to set feedback_sent=true; only human send-feedback can
        feedback_sent = false,
        evaluation_date = ${evaluation.evaluation_date || new Date()},
        updated_at = NOW()
      WHERE drop_number = ${evaluation.dr_number}
    `;

    // Fetch and return the saved evaluation
    const saved = await getEvaluationByDR(evaluation.dr_number);
    if (!saved) {
      throw new Error('Failed to retrieve saved evaluation');
    }

    return saved;
  } catch (error) {
    log.error(`Error saving evaluation for DR ${evaluation.dr_number}`, { error }, 'fotoDbService');
    throw new Error('Failed to save evaluation to database');
  }
}

/**
 * Mark feedback as sent — ONLY allowed for human-reviewed DRs
 * Auto-QA processed DRs must go through /api/activate/send-feedback with human auth
 * @param drNumber - Drop record number
 * @returns Updated evaluation result
 */
export async function markFeedbackSent(drNumber: string): Promise<EvaluationResult> {
  try {
    const sql = getDbConnection();

    // Guard: refuse to mark feedback_sent on auto-QA DRs without human review
    const [row] = await sql`
      SELECT qa_decision_by, human_reviewer_id, auto_qa_processed
      FROM dr_photo_unified_reviews
      WHERE drop_number = ${drNumber}
    `;

    if (row) {
      const isAutoQa = row.qa_decision_by?.startsWith('system:') || row.auto_qa_processed;
      const hasHumanReview = !!row.human_reviewer_id;
      if (isAutoQa && !hasHumanReview) {
        log.error(`Blocked markFeedbackSent for auto-QA DR ${drNumber} — no human review`, {}, 'fotoDbService');
        throw new Error('Cannot send feedback on auto-QA DR without human review');
      }
    }

    await sql`
      UPDATE dr_photo_unified_reviews
      SET
        feedback_sent = true,
        feedback_sent_at = NOW(),
        updated_at = NOW()
      WHERE drop_number = ${drNumber}
    `;

    const updated = await getEvaluationByDR(drNumber);
    if (!updated) {
      throw new Error('Evaluation not found after update');
    }

    return updated;
  } catch (error) {
    log.error(`Error marking feedback sent for DR ${drNumber}`, { error }, 'fotoDbService');
    throw new Error('Failed to update feedback status');
  }
}

/**
 * Get submitter phone number from qa_photo_reviews (WA Monitor data)
 * @param drNumber - Drop record number
 * @returns Phone number or null if not found
 */
export async function getDropSubmitterPhone(drNumber: string): Promise<string | null> {
  try {
    const sql = getDbConnection();
    const rows = await sql`
      SELECT submitted_by
      FROM qa_photo_reviews
      WHERE drop_number = ${drNumber}
      LIMIT 1
    `;

    if (rows.length === 0) {
      return null;
    }

    return rows[0].submitted_by || null;
  } catch (error) {
    log.error(`Error getting submitter phone for DR ${drNumber}`, { error }, 'fotoDbService');
    return null;
  }
}

// ==================== HELPER FUNCTIONS ====================

/**
 * Transform database row to EvaluationResult type
 */
function transformDbRowToEvaluation(row: any): EvaluationResult {
  return {
    dr_number: row.dr_number,
    overall_status: row.overall_status,
    average_score: parseFloat(row.average_score),
    total_steps: row.total_steps,
    passed_steps: row.passed_steps,
    step_results: Array.isArray(row.step_results)
      ? row.step_results
      : JSON.parse(row.step_results || '[]'),
    markdown_report: row.markdown_report || undefined,
    feedback_sent: row.feedback_sent,
    feedback_sent_at: row.feedback_sent_at ? new Date(row.feedback_sent_at) : undefined,
    evaluation_date: row.evaluation_date ? new Date(row.evaluation_date) : new Date(),
  };
}

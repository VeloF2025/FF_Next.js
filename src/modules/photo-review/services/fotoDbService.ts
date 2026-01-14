/**
 * Foto Review Database Service
 * Database operations for AI photo evaluations
 * Uses Neon PostgreSQL serverless client
 *
 * Table: foto_ai_reviews
 * Purpose: Store AI evaluation results for installation drops
 */

import { neon } from '@neondatabase/serverless';
import type { EvaluationResult } from '../types';

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
        dr_number,
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
      FROM foto_ai_reviews
      WHERE dr_number = ${drNumber}
      LIMIT 1
    `;

    if (rows.length === 0) {
      return null;
    }

    const row = rows[0];
    return transformDbRowToEvaluation(row);
  } catch (error) {
    console.error(`Error fetching evaluation for DR ${drNumber}:`, error);
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
        dr_number,
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
      FROM foto_ai_reviews
      ${sql.unsafe(whereClause)}
      ORDER BY evaluation_date DESC
    `;

    return rows.map(transformDbRowToEvaluation);
  } catch (error) {
    console.error('Error fetching evaluations:', error);
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

    await sql`
      INSERT INTO foto_ai_reviews (
        dr_number,
        overall_status,
        average_score,
        total_steps,
        passed_steps,
        step_results,
        markdown_report,
        feedback_sent,
        evaluation_date
      ) VALUES (
        ${evaluation.dr_number},
        ${evaluation.overall_status},
        ${evaluation.average_score},
        ${evaluation.total_steps},
        ${evaluation.passed_steps},
        ${stepResultsJson}::jsonb,
        ${evaluation.markdown_report || null},
        ${evaluation.feedback_sent},
        ${evaluation.evaluation_date || new Date()}
      )
      ON CONFLICT (dr_number)
      DO UPDATE SET
        overall_status = EXCLUDED.overall_status,
        average_score = EXCLUDED.average_score,
        total_steps = EXCLUDED.total_steps,
        passed_steps = EXCLUDED.passed_steps,
        step_results = EXCLUDED.step_results,
        markdown_report = EXCLUDED.markdown_report,
        evaluation_date = EXCLUDED.evaluation_date,
        updated_at = NOW()
    `;

    // Fetch and return the saved evaluation
    const saved = await getEvaluationByDR(evaluation.dr_number);
    if (!saved) {
      throw new Error('Failed to retrieve saved evaluation');
    }

    return saved;
  } catch (error) {
    console.error(`Error saving evaluation for DR ${evaluation.dr_number}:`, error);
    throw new Error('Failed to save evaluation to database');
  }
}

/**
 * Mark feedback as sent
 * @param drNumber - Drop record number
 * @returns Updated evaluation result
 */
export async function markFeedbackSent(drNumber: string): Promise<EvaluationResult> {
  try {
    const sql = getDbConnection();

    await sql`
      UPDATE foto_ai_reviews
      SET
        feedback_sent = true,
        feedback_sent_at = NOW(),
        updated_at = NOW()
      WHERE dr_number = ${drNumber}
    `;

    const updated = await getEvaluationByDR(drNumber);
    if (!updated) {
      throw new Error('Evaluation not found after update');
    }

    return updated;
  } catch (error) {
    console.error(`Error marking feedback sent for DR ${drNumber}:`, error);
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
    console.error(`Error getting submitter phone for DR ${drNumber}:`, error);
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

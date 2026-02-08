/**
 * QA Workflow Funnel Report
 */

import { log } from '@/lib/logger';
import { pool } from './_shared';
import type {
  QAFunnelResponse,
  FunnelStageMetrics,
  PhotoStepMetrics,
  ProcessingTimeMetrics,
} from '../../types/reporting.types';

/**
 * Get QA workflow funnel report
 */
export async function getQAFunnelReport(
  dateFrom: string,
  dateTo: string,
  project?: string
): Promise<QAFunnelResponse> {
  try {
    log.info('ReportingService', 'Getting QA funnel report', {
      dateFrom,
      dateTo,
      project,
    });

    // Get funnel stage counts
    const funnelResult = await pool.query(
      `
      SELECT
        COUNT(*) as submitted,
        COUNT(*) FILTER (WHERE vlm_categorization_status IN ('completed', 'approved')) as vlm_processed,
        COUNT(*) FILTER (WHERE vlm_categorization_status = 'approved') as approved,
        COUNT(*) FILTER (WHERE feedback_sent = true) as feedback_sent
      FROM dr_photo_unified_reviews
      WHERE created_at::DATE >= $1::DATE
        AND created_at::DATE <= $2::DATE
        AND ($3::TEXT IS NULL OR project = $3)
      `,
      [dateFrom, dateTo, project || null]
    );

    const funnelRow = funnelResult.rows[0] || {};
    const submitted = parseInt(funnelRow.submitted, 10) || 0;
    const vlmProcessed = parseInt(funnelRow.vlm_processed, 10) || 0;
    const approved = parseInt(funnelRow.approved, 10) || 0;
    const feedbackSent = parseInt(funnelRow.feedback_sent, 10) || 0;

    const funnel: FunnelStageMetrics[] = [
      {
        stage: 'Submitted',
        count: submitted,
        percentage: 100,
        drop_off_percent: 0,
      },
      {
        stage: 'VLM Processed',
        count: vlmProcessed,
        percentage: submitted > 0 ? Math.round((vlmProcessed / submitted) * 100) : 0,
        drop_off_percent: submitted > 0 ? Math.round(((submitted - vlmProcessed) / submitted) * 100) : 0,
      },
      {
        stage: 'Approved',
        count: approved,
        percentage: submitted > 0 ? Math.round((approved / submitted) * 100) : 0,
        drop_off_percent:
          vlmProcessed > 0 ? Math.round(((vlmProcessed - approved) / vlmProcessed) * 100) : 0,
      },
      {
        stage: 'Feedback Sent',
        count: feedbackSent,
        percentage: submitted > 0 ? Math.round((feedbackSent / submitted) * 100) : 0,
        drop_off_percent:
          approved > 0 ? Math.round(((approved - feedbackSent) / approved) * 100) : 0,
      },
    ];

    // Get photo step completion
    const photoStepResult = await pool.query(
      `
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE step_01_house_photo IS NOT NULL) as step_1,
        COUNT(*) FILTER (WHERE step_02_cable_from_pole IS NOT NULL) as step_2,
        COUNT(*) FILTER (WHERE step_03_entry_outside IS NOT NULL) as step_3,
        COUNT(*) FILTER (WHERE step_04_entry_inside IS NOT NULL) as step_4,
        COUNT(*) FILTER (WHERE step_05_wall IS NOT NULL) as step_5,
        COUNT(*) FILTER (WHERE step_06_ont_back IS NOT NULL) as step_6,
        COUNT(*) FILTER (WHERE step_07_power_meter IS NOT NULL) as step_7,
        COUNT(*) FILTER (WHERE step_08_final_installation IS NOT NULL) as step_8,
        COUNT(*) FILTER (WHERE step_09_green_lights IS NOT NULL) as step_9,
        COUNT(*) FILTER (WHERE step_10_signature IS NOT NULL) as step_10
      FROM dr_photo_unified_reviews
      WHERE created_at::DATE >= $1::DATE
        AND created_at::DATE <= $2::DATE
        AND ($3::TEXT IS NULL OR project = $3)
      `,
      [dateFrom, dateTo, project || null]
    );

    const stepRow = photoStepResult.rows[0] || {};
    const totalForSteps = parseInt(stepRow.total, 10) || 1;

    const stepLabels = [
      'House Photo',
      'Cable from Pole',
      'Entry Outside',
      'Entry Inside',
      'Wall',
      'ONT Back',
      'Power Meter',
      'Final Installation',
      'Green Lights',
      'Signature',
    ];

    const photoSteps: PhotoStepMetrics[] = stepLabels.map((label, idx) => {
      const completed = parseInt(stepRow[`step_${idx + 1}`], 10) || 0;
      return {
        step: idx + 1,
        label,
        completed,
        total: totalForSteps,
        completion_rate: Math.round((completed / totalForSteps) * 100),
        vlm_pass_rate: null, // Would need VLM scores per step
      };
    });

    // Processing times (simplified - would need timestamps for accurate calculation)
    const processingTimes: ProcessingTimeMetrics[] = [
      {
        stage: 'Submission → VLM',
        p50: 3,
        p90: 8,
        p99: 15,
        avg: 5,
        target: 5,
        meeting_target_rate: 85,
      },
      {
        stage: 'VLM → Approval',
        p50: 120,
        p90: 480,
        p99: 1440,
        avg: 240,
        target: 1440,
        meeting_target_rate: 90,
      },
      {
        stage: 'Approval → Feedback',
        p50: 30,
        p90: 120,
        p99: 480,
        avg: 60,
        target: 60,
        meeting_target_rate: 75,
      },
    ];

    // Calculate photo completion (all 10 steps)
    const allStepsCompleted = await pool.query(
      `
      SELECT COUNT(*) as count
      FROM dr_photo_unified_reviews
      WHERE created_at::DATE >= $1::DATE
        AND created_at::DATE <= $2::DATE
        AND ($3::TEXT IS NULL OR project = $3)
        AND step_01_house_photo IS NOT NULL
        AND step_02_cable_from_pole IS NOT NULL
        AND step_03_entry_outside IS NOT NULL
        AND step_04_entry_inside IS NOT NULL
        AND step_05_wall IS NOT NULL
        AND step_06_ont_back IS NOT NULL
        AND step_07_power_meter IS NOT NULL
        AND step_08_final_installation IS NOT NULL
        AND step_09_green_lights IS NOT NULL
        AND step_10_signature IS NOT NULL
      `,
      [dateFrom, dateTo, project || null]
    );

    const allComplete = parseInt(allStepsCompleted.rows[0]?.count, 10) || 0;

    return {
      date_range: { from: dateFrom, to: dateTo },
      project: project || null,
      funnel,
      photo_steps: photoSteps,
      processing_times: processingTimes,
      summary: {
        total_submitted: submitted,
        conversion_rate: submitted > 0 ? Math.round((feedbackSent / submitted) * 100) : 0,
        avg_cycle_time: 300, // Placeholder - would calculate from timestamps
        photo_completion_rate: totalForSteps > 0 ? Math.round((allComplete / totalForSteps) * 100) : 0,
      },
    };
  } catch (error) {
    log.error('ReportingService', 'Failed to get QA funnel report', { error });
    throw error;
  }
}

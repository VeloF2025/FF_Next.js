/**
 * POST /api/foto/evaluate
 * Trigger AI evaluation for a DR
 * 
 * Hybrid Evaluation Strategy:
 * 1. Check BOSS API for existing evaluation (fast, auto-triggered)
 * 2. If force_vlm=true, run VLM re-evaluation
 * 3. Save results to database
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';
import type { EvaluationResult } from '@/modules/photo-review/types';
import { saveEvaluation } from '@/modules/photo-review/services/fotoDbService';
import {
  executePythonEvaluation,
  PythonEvaluationError,
} from '@/modules/photo-review/services/fotoPythonService';
import {
  executeVlmEvaluation,
  VlmEvaluationError,
} from '@/modules/photo-review/services/fotoVlmService';
import {
  fetchBossEvaluation,
  BossEvaluationError,
} from '@/modules/photo-review/services/fotoBossService';
import { validateDrNumber } from '@/modules/photo-review/utils/drValidator';
import { log } from '@/lib/logger';

// Feature flags
const USE_BOSS_PRIMARY = process.env.USE_BOSS_PRIMARY !== 'false'; // Default: true (BOSS is primary)
const USE_VLM_BACKEND = process.env.USE_VLM_BACKEND !== 'false'; // Default: true (VLM for re-evaluation)
const USE_PYTHON_BACKEND = process.env.USE_PYTHON_BACKEND === 'true'; // Fallback option

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { dr_number } = req.body;

    log.debug('fotoApi', { action: 'evaluateRequest', drNumber: dr_number });

    // Validate DR number format and check for SQL injection
    const validation = validateDrNumber(dr_number);

    if (!validation.valid) {
      return res.status(400).json({
        error: 'Invalid DR number',
        message: validation.error,
      });
    }

    // Use sanitized DR number
    const sanitizedDr = validation.sanitized!;
    const forceVlm = req.body.force_vlm === true; // Force VLM re-evaluation

    let evaluation: EvaluationResult;
    let evaluationMethod = 'mock';

    // Hybrid Strategy: BOSS (fast) > VLM (re-evaluation) > Python > Mock
    if (USE_BOSS_PRIMARY && !forceVlm) {
      log.debug('fotoApi', { action: 'evaluateCheckBoss', drNumber: sanitizedDr });
      try {
        const bossEval = await fetchBossEvaluation(sanitizedDr);

        if (bossEval) {
          evaluation = bossEval;
          evaluationMethod = 'boss';
          log.debug('fotoApi', { action: 'evaluateUseBoss', drNumber: sanitizedDr });
        } else {
          log.debug('fotoApi', { action: 'evaluateBossNotFound', drNumber: sanitizedDr, fallback: 'VLM' });
          // No BOSS evaluation yet, use VLM
          if (USE_VLM_BACKEND) {
            evaluation = await executeVlmEvaluation(sanitizedDr);
            evaluationMethod = 'vlm-fallback';
          } else {
            evaluation = generateMockEvaluation(sanitizedDr);
            evaluationMethod = 'mock';
          }
        }
      } catch (error) {
        log.error('fotoApi', { action: 'evaluateBossFailed', drNumber: sanitizedDr, fallback: 'VLM', error });
        // BOSS failed, try VLM
        if (USE_VLM_BACKEND) {
          evaluation = await executeVlmEvaluation(sanitizedDr);
          evaluationMethod = 'vlm-fallback';
        } else {
          throw error;
        }
      }
    } else if (USE_VLM_BACKEND) {
      log.debug('fotoApi', { action: 'evaluateUseVlm', drNumber: sanitizedDr, forceVlm });
      try {
        evaluation = await executeVlmEvaluation(sanitizedDr);
        evaluationMethod = forceVlm ? 'vlm-reeval' : 'vlm';
        log.debug('fotoApi', { action: 'evaluateVlmSuccess', drNumber: sanitizedDr });
      } catch (error) {
        if (error instanceof VlmEvaluationError) {
          log.error('fotoApi', {
            action: 'evaluateVlmError',
            drNumber: sanitizedDr,
            error: error.message,
            code: error.code,
            details: error.details
          });

          // If VLM fails and Python is enabled, fallback to Python
          if (USE_PYTHON_BACKEND) {
            log.debug('fotoApi', { action: 'evaluateFallbackPython', drNumber: sanitizedDr });
            try {
              evaluation = await executePythonEvaluation(sanitizedDr);
              evaluationMethod = 'python-fallback';
              log.debug('fotoApi', { action: 'evaluatePythonSuccess', drNumber: sanitizedDr });
            } catch (pythonError) {
              log.error('foto-evaluate', { error: pythonError instanceof Error ? pythonError.message : String(pythonError) });
              // Both failed - return VLM error (primary method)
              return res.status(500).json({
                error: 'VLM evaluation failed',
                message: error.message,
                code: error.code,
                details: error.details,
                fallback_error: pythonError instanceof Error ? pythonError.message : 'Python fallback also failed',
              });
            }
          } else {
            // No fallback available
            return res.status(500).json({
              error: 'VLM evaluation failed',
              message: error.message,
              code: error.code,
              details: error.details,
            });
          }
        } else {
          throw error;
        }
      }
    } else if (USE_PYTHON_BACKEND) {
      log.debug('fotoApi', { action: 'evaluateUsePython', drNumber: sanitizedDr });
      try {
        evaluation = await executePythonEvaluation(sanitizedDr);
        evaluationMethod = 'python';
        log.debug('fotoApi', { action: 'evaluatePythonSuccess', drNumber: sanitizedDr });
      } catch (error) {
        if (error instanceof PythonEvaluationError) {
          log.error('fotoApi', {
            action: 'evaluatePythonError',
            drNumber: sanitizedDr,
            error: error.message,
            code: error.code,
            stderr: error.stderr
          });

          return res.status(500).json({
            error: 'Python evaluation failed',
            message: error.message,
            code: error.code,
            details: error.stderr,
          });
        }
        throw error;
      }
    } else {
      log.debug('fotoApi', { action: 'evaluateUseMock', drNumber: sanitizedDr });
      evaluation = generateMockEvaluation(sanitizedDr);
    }

    // Save to database
    log.debug('fotoApi', { action: 'saveEvaluation', drNumber: sanitizedDr });
    const savedEvaluation = await saveEvaluation(evaluation);
    log.debug('fotoApi', { action: 'saveEvaluationSuccess', drNumber: savedEvaluation.dr_number });

    return res.status(200).json({
      success: true,
      data: savedEvaluation,
      method: evaluationMethod,
      message:
        evaluationMethod === 'boss'
          ? 'Using BOSS AI evaluation (auto-generated when photos were fetched)'
          : evaluationMethod === 'vlm-reeval'
            ? 'VLM re-evaluation completed successfully'
            : evaluationMethod === 'vlm'
              ? 'AI evaluation completed successfully using VLM'
              : evaluationMethod === 'vlm-fallback'
                ? 'AI evaluation completed using VLM (BOSS not available)'
                : evaluationMethod === 'python'
                  ? 'AI evaluation completed successfully using Python'
                  : evaluationMethod === 'python-fallback'
                    ? 'AI evaluation completed using Python (VLM fallback)'
                    : 'Mock evaluation completed (all backends disabled)',
    });
  } catch (error) {
    log.error('fotoApi', { action: 'evaluateError', error });
    return res.status(500).json({
      error: 'Failed to evaluate DR',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * Generate mock evaluation data for testing
 */
function generateMockEvaluation(dr_number: string): EvaluationResult {
  const totalSteps = 12;
  const passRate = 0.7 + Math.random() * 0.25; // 70-95% pass rate
  const passedSteps = Math.floor(totalSteps * passRate);
  const averageScore = passRate * 10;

  const stepLabels = [
    'House Photo',
    'Cable Span from Pole',
    'Cable Entry Outside',
    'Cable Entry Inside',
    'Wall for Installation',
    'ONT Back After Install',
    'Power Meter Reading',
    'ONT Barcode',
    'UPS Serial Number',
    'Final Installation',
    'Green Lights on ONT',
    'Customer Signature',
  ];

  return {
    dr_number,
    overall_status: passedSteps >= totalSteps * 0.75 ? 'PASS' : 'FAIL',
    average_score: parseFloat(averageScore.toFixed(1)),
    total_steps: totalSteps,
    passed_steps: passedSteps,
    step_results: stepLabels.map((label, index) => ({
      step_number: index + 1,
      step_name: label.toLowerCase().replace(/\s+/g, '_'),
      step_label: label,
      passed: index < passedSteps,
      score: index < passedSteps
        ? 7 + Math.random() * 3 // 7-10 for passed
        : 3 + Math.random() * 4, // 3-7 for failed
      comment: index < passedSteps
        ? `${label} is clearly visible and meets quality standards.`
        : `${label} needs improvement. Please retake photo with better quality.`,
    })),
    feedback_sent: false,
    evaluation_date: new Date(),
    markdown_report: undefined,
  };
}

export default withAuth(handler);

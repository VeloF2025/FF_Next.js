/**
 * API Route: /api/activate/reporting/vlm-accuracy
 *
 * Purpose: VLM categorization and extraction accuracy metrics
 * Method: GET
 *
 * Returns:
 * - Overall VLM accuracy (extractions + categorizations)
 * - Daily accuracy trend
 * - Top error patterns
 * - Confusion matrix (most confused step pairs)
 * - Per-step accuracy from auto-approval service
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';
import { getVlmMetrics } from '@/services/vlmLearningService';
import type { VlmModule } from '@/types/vlm-learning';
import { getCorrectionStats } from '@/modules/qa-learning/services/correctionService';
import { getStepAccuracy } from '@/modules/activate/services/autoApprovalService';

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
): Promise<void> {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }

  try {
    const { days = '30', module = 'activate' } = req.query;
    const daysNum = Math.min(parseInt(String(days), 10) || 30, 90);
    const moduleStr = String(module) as VlmModule;
    const dateFrom = new Date(Date.now() - daysNum * 24 * 60 * 60 * 1000);
    const dateTo = new Date();

    // Run all queries in parallel
    const [vlmMetrics, correctionStats, stepAccuracy] = await Promise.all([
      getVlmMetrics({
        module: moduleStr,
        dateFrom,
        dateTo,
      }).catch((err) => {
        log.warn('VlmAccuracy', { action: 'getVlmMetrics', error: String(err) });
        return null;
      }),
      getCorrectionStats('dr_photo').catch((err) => {
        log.warn('VlmAccuracy', { action: 'getCorrectionStats', error: String(err) });
        return null;
      }),
      getStepAccuracy().catch((err) => {
        log.warn('VlmAccuracy', { action: 'getStepAccuracy', error: String(err) });
        return null;
      }),
    ]);

    // Build per-step accuracy map
    const perStepAccuracy: Record<number, {
      totalPredictions: number;
      corrections: number;
      accuracyRate: number;
    }> = {};

    if (stepAccuracy) {
      for (const [step, data] of stepAccuracy.entries()) {
        perStepAccuracy[step] = {
          totalPredictions: data.totalPredictions,
          corrections: data.correctionCount,
          accuracyRate: data.accuracyRate,
        };
      }
    }

    return apiResponse.success(res, {
      period: {
        days: daysNum,
        from: dateFrom.toISOString(),
        to: dateTo.toISOString(),
      },
      extraction: vlmMetrics
        ? {
            totals: vlmMetrics.totals,
            overallAccuracy: vlmMetrics.accuracy.overall,
            dailyTrend: vlmMetrics.accuracy.byDay,
            topErrors: vlmMetrics.topErrors,
          }
        : null,
      categorization: {
        corrections: correctionStats
          ? {
              total: correctionStats.totalCorrections,
              canonical: correctionStats.canonicalCount,
              recent30d: correctionStats.recentCorrections,
              confusionMatrix: correctionStats.topConfusedSteps,
            }
          : null,
        perStepAccuracy,
      },
    });
  } catch (error) {
    log.error('VlmAccuracy', { action: 'fetchAccuracy', error: String(error) });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);

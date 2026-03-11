/**
 * RFQ Evaluation Service
 * Evaluates and compares supplier responses
 */

import { neon } from '@/lib/db-neon';
import { log } from '@/lib/logger';
import { RFQStatus } from '@/types/procurement.types';
import { RfqCrudService } from '../core/RfqCrudService';
import { RfqResponseService } from './RfqResponseService';

const sql: any = neon(process.env.DATABASE_URL!);

export class RfqEvaluationService {
  /**
   * Evaluate responses
   */
  static async evaluateResponses(rfqId: string): Promise<any> {
    try {
      const responses = await RfqResponseService.getResponses(rfqId);

      if (responses.length === 0) {
        throw new Error('No responses to evaluate');
      }

      // Get evaluation criteria
      const criteria = await sql`
        SELECT * FROM rfq_evaluation_criteria
        WHERE rfq_id = ${rfqId}
        ORDER BY weight DESC`;

      // Calculate scores for each response
      const evaluatedResponses = await Promise.all(responses.map(async (response) => {
        let totalScore = 0;
        let weightedScore = 0;

        for (const criterion of criteria) {
          let score = 0;

          switch (criterion.criteria_type) {
            case 'price':
              // Lowest price gets highest score
              const minPrice = Math.min(...responses.map(r => r.totalAmount));
              score = (minPrice / response.totalAmount) * criterion.max_score;
              break;

            case 'delivery':
              // Fastest delivery gets highest score
              const minDays = Math.min(...responses.map(r => r.deliveryDays || 30));
              score = (minDays / (response.deliveryDays || 30)) * criterion.max_score;
              break;

            default:
              // Default scoring (manual in real scenario)
              score = criterion.max_score * 0.7;
          }

          const weightedCriterionScore = score * (criterion.weight / 100);

          // Save evaluation score
          await sql`
            INSERT INTO rfq_evaluation_scores (
              response_id, criteria_id, score, weighted_score
            ) VALUES (
              ${response.id},
              ${criterion.id},
              ${score},
              ${weightedCriterionScore}
            )
            ON CONFLICT (response_id, criteria_id)
            DO UPDATE SET
              score = ${score},
              weighted_score = ${weightedCriterionScore},
              updated_at = ${new Date().toISOString()}`;

          totalScore += score;
          weightedScore += weightedCriterionScore;
        }

        // Update response with evaluation scores
        await sql`
          UPDATE rfq_responses
          SET
            evaluation_score = ${totalScore},
            evaluation_status = 'evaluated',
            evaluated_at = ${new Date().toISOString()}
          WHERE id = ${response.id}`;

        return {
          ...response,
          totalScore,
          weightedScore
        };
      }));

      // Update RFQ status
      await RfqCrudService.updateStatus(rfqId, RFQStatus.EVALUATED);

      // Sort by weighted score
      evaluatedResponses.sort((a, b) => b.weightedScore - a.weightedScore);

      return {
        responses: evaluatedResponses,
        recommended: evaluatedResponses[0],
        criteria
      };
    } catch (error) {
      log.error('Error evaluating RFQ responses:', { data: error }, 'RfqEvaluationService');
      throw error;
    }
  }

  /**
   * Compare responses
   */
  static async compareResponses(rfqId: string): Promise<any> {
    try {
      const responses = await RfqResponseService.getResponses(rfqId);

      if (responses.length === 0) {
        throw new Error('No responses to compare');
      }

      const comparison = {
        responses,
        lowestPrice: responses.reduce((min, r) =>
          r.totalAmount < min.totalAmount ? r : min
        ),
        fastestDelivery: responses.reduce((min, r) =>
          (r.deliveryDays || 999) < (min.deliveryDays || 999) ? r : min
        ),
        bestPaymentTerms: responses.reduce((best, r) => {
          const currentDays = parseInt(best.paymentTerms?.match(/\d+/)?.[0] || '0');
          const newDays = parseInt(r.paymentTerms?.match(/\d+/)?.[0] || '0');
          return newDays > currentDays ? r : best;
        }),
        statistics: {
          averagePrice: responses.reduce((sum, r) => sum + r.totalAmount, 0) / responses.length,
          priceRange: {
            min: Math.min(...responses.map(r => r.totalAmount)),
            max: Math.max(...responses.map(r => r.totalAmount))
          },
          averageDeliveryDays: responses.reduce((sum, r) => sum + (r.deliveryDays || 0), 0) / responses.length
        }
      };

      return comparison;
    } catch (error) {
      log.error('Error comparing RFQ responses:', { data: error }, 'RfqEvaluationService');
      throw error;
    }
  }
}

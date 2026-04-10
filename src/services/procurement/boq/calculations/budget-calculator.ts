/**
 * BOQ Budget Calculator
 * Handles project budget calculations and risk analysis
 */

// @ts-expect-error — module lacks type declarations
import { BOQCrud } from '../crud';
import { BOQ } from '../../../../types/procurement/boq.types';
import { log } from '@/lib/logger';

/**
 * BOQ Budget and Risk Analysis Calculator
 */
export class BOQBudgetCalculator {
  /**
   * Calculate project budget allocation from BOQs
   */
  static async calculateProjectBudget(projectId: string): Promise<{
    totalBudget: number;
    allocatedBudget: number;
    remainingBudget: number;
    boqBreakdown: Array<{
      boqId: string;
      title: string;
      version: string;
      allocatedAmount: number;
      percentage: number;
    }>;
    riskAnalysis: {
      overBudgetRisk: 'low' | 'medium' | 'high';
      contingencyRecommendation: number;
    };
  }> {
    try {
      const boqs = await BOQCrud.getByProject(projectId);
      const approvedBOQs = boqs.filter((boq: typeof boqs[0]) => boq.status === 'approved');

      const totalBudget = approvedBOQs.reduce((sum: number, boq: BOQ) => 
        sum + (boq.totalEstimatedValue || 0), 0
      );

      const boqBreakdown = approvedBOQs.map((boq: BOQ) => ({
        boqId: boq.id,
        title: boq.title || 'Untitled BOQ',
        version: boq.version || '1.0',
        allocatedAmount: boq.totalEstimatedValue || 0,
        percentage: totalBudget > 0 ? 
          ((boq.totalEstimatedValue || 0) / totalBudget) * 100 : 0
      }));

      // Simple risk analysis based on BOQ complexity
      const avgItemCount = boqs.reduce((sum: number, boq: BOQ) => 
        sum + (boq.itemCount || 0), 0) / boqs.length;

      let overBudgetRisk: 'low' | 'medium' | 'high' = 'low';
      let contingencyRecommendation = 0.05; // 5% default

      if (avgItemCount > 500) {
        overBudgetRisk = 'high';
        contingencyRecommendation = 0.15; // 15%
      } else if (avgItemCount > 200) {
        overBudgetRisk = 'medium';
        contingencyRecommendation = 0.10; // 10%
      }

      return {
        totalBudget,
        allocatedBudget: totalBudget,
        remainingBudget: 0, // Would depend on actual spending
        boqBreakdown,
        riskAnalysis: {
          overBudgetRisk,
          contingencyRecommendation
        }
      };
    } catch (error) {
      log.error('Error calculating project budget:', { data: error }, 'budget-calculator');
      throw error;
    }
  }
}
/**
 * BOQ Comparison Analyzer
 * Handles BOQ version comparisons and variance analysis
 */

import { BOQ } from '../../../../types/procurement/boq.types';
// @ts-expect-error — module lacks type declarations
import { BOQCrud } from '../crud';
import { log } from '@/lib/logger';

/**
 * BOQ Comparison and Variance Analysis
 */
export class BOQComparisonAnalyzer {
  /**
   * Compare two BOQ versions
   */
  static async compareBOQVersions(originalId: string, revisedId: string): Promise<{
    originalBOQ: BOQ;
    revisedBOQ: BOQ;
    changes: {
      itemsAdded: number;
      itemsRemoved: number;
      itemsModified: number;
      valueChange: number;
      quantityChange: number;
    };
    categoryChanges: Record<string, {
      quantityChange: number;
      valueChange: number;
    }>;
  }> {
    try {
      const [originalBOQ, revisedBOQ] = await Promise.all([
        BOQCrud.getById(originalId),
        BOQCrud.getById(revisedId)
      ]);

      // For now, return basic comparison structure
      // In a real implementation, you would compare the actual BOQ items
      const changes = {
        itemsAdded: (revisedBOQ.itemCount || 0) - (originalBOQ.itemCount || 0),
        itemsRemoved: Math.max(0, (originalBOQ.itemCount || 0) - (revisedBOQ.itemCount || 0)),
        itemsModified: 0, // Would need item-level comparison
        valueChange: (revisedBOQ.totalEstimatedValue || 0) - (originalBOQ.totalEstimatedValue || 0),
        quantityChange: 0 // Would need item-level comparison
      };

      return {
        originalBOQ,
        revisedBOQ,
        changes,
        categoryChanges: {} // Would need item-level comparison
      };
    } catch (error) {
      log.error('Error comparing BOQ versions:', { data: error }, 'comparison-analyzer');
      throw error;
    }
  }

  /**
   * Generate BOQ variance analysis
   */
  static analyzeVariance(
    baselineItems: Array<Record<string, unknown>>,
    actualItems: Array<Record<string, unknown>>
  ): {
    totalVariance: number;
    quantityVariance: number;
    priceVariance: number;
    variancePercentage: number;
    itemVariances: Array<{
      itemCode: string;
      description: string;
      quantityVariance: number;
      priceVariance: number;
      totalVariance: number;
    }>;
  } {
    const baselineTotal = baselineItems.reduce((sum, item) => {
      const qty = (item.quantity as number) || 0;
      const price = (item.unitPrice as number) || 0;
      return sum + ((item.totalPrice as number) || (qty * price) || 0);
    }, 0);

    const actualTotal = actualItems.reduce((sum, item) => {
      const qty = (item.quantity as number) || 0;
      const price = (item.unitPrice as number) || 0;
      return sum + ((item.totalPrice as number) || (qty * price) || 0);
    }, 0);

    const totalVariance = actualTotal - baselineTotal;
    const variancePercentage = baselineTotal > 0 ? 
      (totalVariance / baselineTotal) * 100 : 0;

    // Create item map for comparison
    const baselineMap = new Map(
      baselineItems.map(item => [item.itemCode || item.description, item])
    );
    const actualMap = new Map(
      actualItems.map(item => [item.itemCode || item.description, item])
    );

    const itemVariances: Array<{
      itemCode: string;
      description: string;
      quantityVariance: number;
      priceVariance: number;
      totalVariance: number;
    }> = [];

    // Calculate variances for each item
    const allItemCodes = new Set([
      ...baselineMap.keys(),
      ...actualMap.keys()
    ]);

    allItemCodes.forEach(itemCode => {
      const baselineItem = baselineMap.get(itemCode);
      const actualItem = actualMap.get(itemCode);

      if (baselineItem && actualItem) {
        const quantityVariance = ((actualItem.quantity as number) || 0) - ((baselineItem.quantity as number) || 0);
        const priceVariance = ((actualItem.unitPrice as number) || 0) - ((baselineItem.unitPrice as number) || 0);
        const aTotal = (actualItem.totalPrice as number) || (((actualItem.quantity as number) || 0) * ((actualItem.unitPrice as number) || 0));
        const bTotal = (baselineItem.totalPrice as number) || (((baselineItem.quantity as number) || 0) * ((baselineItem.unitPrice as number) || 0));
        const totalVariance = (aTotal || 0) - (bTotal || 0);

        itemVariances.push({
          itemCode: itemCode as string,
          description: (actualItem.description || baselineItem.description || 'No description') as string,
          quantityVariance,
          priceVariance,
          totalVariance
        });
      }
    });

    return {
      totalVariance,
      quantityVariance: itemVariances.reduce((sum, item) => sum + item.quantityVariance, 0),
      priceVariance: itemVariances.reduce((sum, item) => sum + item.priceVariance, 0),
      variancePercentage,
      itemVariances
    };
  }
}
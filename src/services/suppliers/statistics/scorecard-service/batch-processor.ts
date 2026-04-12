import { log } from '@/lib/logger';

/**
 * Batch Processor
 * Handles batch processing of multiple supplier scorecards
 */

import type {
  BatchScorecardOptions,
  ScorecardData,
  ScorecardSummary,
  ScorecardGenerationResult
} from './service-types';

export class ScorecardBatchProcessor {
  /**
   * Generate scorecards for multiple suppliers
   */
  static async generateMultipleScorecards(
    supplierIds: string[],
    options: BatchScorecardOptions = {},
    generateSingleScorecard: (supplierId: string) => Promise<ScorecardGenerationResult>
  ): Promise<ScorecardData[]> {
    const {
      batchSize = 10,
      includeFailures = false,
      sortBy = 'score',
      filters = {}
    } = options;

    // Acknowledge unused variable
    void includeFailures;

    const scorecards: ScorecardData[] = [];
    const failures: Array<{ supplierId: string; error: string }> = [];
    
    // Process suppliers in batches to avoid overwhelming the system
    for (let i = 0; i < supplierIds.length; i += batchSize) {
      const batch = supplierIds.slice(i, i + batchSize);
      const batchPromises = batch.map(async (supplierId) => {
        try {
          const result = await generateSingleScorecard(supplierId);
          return result.scorecard;
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          failures.push({ supplierId, error: errorMessage });
          log.warn(`Failed to generate scorecard for supplier ${supplierId}:`, { data: error }, 'batch-processor');
          return null;
        }
      });

      const batchResults = await Promise.all(batchPromises);
      const validScorecards = batchResults.filter(
        (scorecard): scorecard is ScorecardData => scorecard !== null
      );

      scorecards.push(...validScorecards);
    }

    // Apply filters
    let filteredScorecards = this.applyFilters(scorecards, filters);

    // Sort results
    filteredScorecards = this.sortScorecards(filteredScorecards, sortBy);

    if (failures.length > 0) {
      log.warn(`Generated ${scorecards.length} scorecards with ${failures.length} failures`, undefined, 'batch-processor');
    }

    return filteredScorecards;
  }

  /**
   * Get scorecard summary statistics
   */
  static async getScorecardSummary(
    supplierIds: string[],
    generateMultiple: (ids: string[]) => Promise<ScorecardData[]>
  ): Promise<ScorecardSummary> {
    const scorecards = await generateMultiple(supplierIds);

    const totalScorecards = scorecards.length;
    const averageScore = totalScorecards > 0 ? 
      Math.round(scorecards.reduce((sum, sc) => sum + sc.overallScore, 0) / totalScorecards) : 0;

    // Score distribution
    const scoreDistribution = {
      'Excellent (90-100)': scorecards.filter(sc => sc.overallScore >= 90).length,
      'Good (80-89)': scorecards.filter(sc => sc.overallScore >= 80 && sc.overallScore < 90).length,
      'Fair (60-79)': scorecards.filter(sc => sc.overallScore >= 60 && sc.overallScore < 80).length,
      'Poor (40-59)': scorecards.filter(sc => sc.overallScore >= 40 && sc.overallScore < 60).length,
      'Critical (<40)': scorecards.filter(sc => sc.overallScore < 40).length
    };

    const sortedByScore = scorecards.sort((a, b) => b.overallScore - a.overallScore);

    return {
      totalScorecards,
      averageScore,
      scoreDistribution,
      topPerformers: sortedByScore.slice(0, 10).map(sc => ({
        supplierId: sc.supplierId,
        supplierName: sc.supplierName,
        score: sc.overallScore
      })),
      improvementCandidates: sortedByScore
        .filter(sc => sc.overallScore < 70)
        .slice(-10)
        .reverse()
        .map(sc => ({
          supplierId: sc.supplierId,
          supplierName: sc.supplierName,
          score: sc.overallScore
        }))
    };
  }

  /**
   * Apply filters to scorecard results
   */
  static applyFilters(
    scorecards: ScorecardData[],
    filters: BatchScorecardOptions['filters'] = {}
  ): ScorecardData[] {
    let filtered = scorecards;

    if (filters.minScore !== undefined) {
      filtered = filtered.filter(sc => sc.overallScore >= filters.minScore!);
    }

    if (filters.categories && filters.categories.length > 0) {
      // This would require supplier data to check categories
      // For now, we'll skip this filter
    }

    if (filters.statuses && filters.statuses.length > 0) {
      // This would require supplier data to check status
      // For now, we'll skip this filter
    }

    return filtered;
  }

  /**
   * Sort scorecard results
   */
  static sortScorecards(
    scorecards: ScorecardData[],
    sortBy: 'score' | 'name' | 'category'
  ): ScorecardData[] {
    switch (sortBy) {
      case 'score':
        return scorecards.sort((a, b) => b.overallScore - a.overallScore);
      case 'name':
        return scorecards.sort((a, b) => a.supplierName.localeCompare(b.supplierName));
      case 'category':
        // For category sorting, we'd need access to supplier data
        // For now, fallback to score sorting
        return scorecards.sort((a, b) => b.overallScore - a.overallScore);
      default:
        return scorecards;
    }
  }

  /**
   * Calculate batch processing metrics
   */
  static calculateProcessingMetrics(
    totalSuppliers: number,
    successfulScorecards: number,
    processingTimeMs: number
  ): {
    successRate: number;
    failureRate: number;
    averageProcessingTimeMs: number;
    throughputPerSecond: number;
  } {
    const successRate = totalSuppliers > 0 ? (successfulScorecards / totalSuppliers) * 100 : 0;
    const failureRate = 100 - successRate;
    const averageProcessingTimeMs = totalSuppliers > 0 ? processingTimeMs / totalSuppliers : 0;
    const throughputPerSecond = processingTimeMs > 0 ? (successfulScorecards / processingTimeMs) * 1000 : 0;

    return {
      successRate: Math.round(successRate * 10) / 10,
      failureRate: Math.round(failureRate * 10) / 10,
      averageProcessingTimeMs: Math.round(averageProcessingTimeMs),
      throughputPerSecond: Math.round(throughputPerSecond * 100) / 100
    };
  }
}
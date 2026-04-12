/**
 * Supplier Scorecard Generator - Main Orchestrator
 * Generate comprehensive supplier performance scorecards using modular approach
 */

import { Supplier } from '@/types/supplier/base.types';
import {
  SupplierScorecard,
  ScorecardGenerationOptions,
  ScorecardBatchResult,
  BatchProcessingConfig,
  DEFAULT_SCORECARD_OPTIONS,
  isValidSupplier,
  ScoreCalculationResult
} from './scorecardTypes';
import { ScorecardCalculator } from './scorecardCalculator';
import { ScorecardAnalyzer } from './scorecardAnalyzer';
import { ScorecardRecommendations } from './scorecardRecommendations';
import { log } from '@/lib/logger';

export class ScorecardGenerator {
  private static readonly DEFAULT_BATCH_CONFIG: BatchProcessingConfig = {
    batchSize: 10,
    concurrencyLimit: 5,
    retryAttempts: 3,
    timeoutMs: 30000
  };

  /**
   * Generate comprehensive supplier scorecard
   */
  static async generateSupplierScorecard(
    supplierId: string,
    options: ScorecardGenerationOptions = DEFAULT_SCORECARD_OPTIONS
  ): Promise<SupplierScorecard> {
    try {
      // Get supplier data
      const supplier = await this.getSupplierData(supplierId);
      const supplierName = supplier.companyName || supplier.name || 'Unknown';

      // Calculate overall score using calculator
      const overallScore = ScorecardCalculator.calculateOverallScore(supplier);

      // Extract detailed ratings, performance, and compliance
      const ratings = ScorecardCalculator.extractRatings(supplier);
      const performance = ScorecardCalculator.extractPerformance(supplier);
      const compliance = ScorecardCalculator.extractCompliance(supplier);

      // Calculate trends (if requested)
      const trends = options.includeTrends 
        ? await ScorecardAnalyzer.calculateTrends(supplier)
        : { last3Months: overallScore, last6Months: overallScore, last12Months: overallScore };

      // Calculate benchmarks (if requested)
      const benchmarks = options.includeBenchmarks
        ? await ScorecardAnalyzer.calculateBenchmarks(supplier)
        : { industryPercentile: 50, categoryPercentile: 50, peerComparison: 'at' as const };

      // Generate recommendations (if requested)
      const recommendations = options.includeRecommendations
        ? ScorecardRecommendations.generateRecommendations(supplier, overallScore, compliance)
        : [];

      const scorecard: SupplierScorecard = {
        supplierId,
        supplierName,
        overallScore,
        ratings,
        performance,
        compliance,
        trends,
        benchmarks,
        recommendations,
        lastUpdated: new Date()
      };

      return scorecard;
    } catch (error) {
      log.error('Error generating supplier scorecard:', { data: error }, 'scorecardGenerator');
      throw new Error(`Failed to generate scorecard: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Generate scorecards for multiple suppliers with batch processing
   */
  static async generateMultipleScorecards(
    supplierIds: string[],
    options: ScorecardGenerationOptions = DEFAULT_SCORECARD_OPTIONS,
    batchConfig: Partial<BatchProcessingConfig> = {}
  ): Promise<ScorecardBatchResult> {
    const config = { ...this.DEFAULT_BATCH_CONFIG, ...batchConfig };
    const successful: SupplierScorecard[] = [];
    const failed: { supplierId: string; error: string }[] = [];
    const totalProcessed = supplierIds.length;

    // Process in batches to avoid overwhelming the system
    const batches = this.chunkArray(supplierIds, config.batchSize);

    for (const batch of batches) {
      const batchPromises = batch.map(async (supplierId) => {
        try {
          const scorecard = await this.generateSupplierScorecard(supplierId, options);
          successful.push(scorecard);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          log.warn(`Failed to generate scorecard for supplier ${supplierId}:`, { data: errorMessage }, 'scorecardGenerator');
          failed.push({ supplierId, error: errorMessage });
        }
      });

      // Execute batch with concurrency limit
      await this.executeWithConcurrencyLimit(batchPromises, config.concurrencyLimit);
    }

    // Sort successful scorecards by overall score (descending)
    successful.sort((a, b) => b.overallScore - a.overallScore);

    const successRate = totalProcessed > 0 ? (successful.length / totalProcessed) * 100 : 0;

    return {
      successful,
      failed,
      totalProcessed,
      successRate: Math.round(successRate * 100) / 100
    };
  }

  /**
   * Generate advanced scorecard with detailed analysis
   */
  static async generateAdvancedScorecard(supplierId: string): Promise<SupplierScorecard & {
    detailedAnalysis: {
      scoreBreakdown: ScoreCalculationResult;
      marketPosition: { marketPosition: string; strengthAreas: string[]; improvementAreas: string[]; competitiveAdvantages: string[] };
      trendMomentum: { direction: 'improving' | 'declining' | 'stable'; strength: 'strong' | 'moderate' | 'weak'; momentum: number };
      actionableRecommendations: Array<{ recommendation: string; actions: string[]; timeframe: string; expectedImpact: string }>;
    };
  }> {
    const baseScorecard = await this.generateSupplierScorecard(supplierId, {
      includeTrends: true,
      includeBenchmarks: true,
      includeRecommendations: true,
      calculateHistoricalData: true
    });

    const supplier = await this.getSupplierData(supplierId);
    const allSuppliers = await this.getAllSuppliersForAnalysis();

    // Generate detailed analysis
    const scoreBreakdown = ScorecardCalculator.calculateDetailedScore(supplier);
    const marketPosition = ScorecardAnalyzer.calculateMarketPositionInsights(supplier, allSuppliers);
    const trendMomentum = ScorecardAnalyzer.calculateTrendMomentum(baseScorecard.trends);
    const actionableRecommendations = ScorecardRecommendations.generateActionableRecommendations(
      supplier, 
      baseScorecard.overallScore, 
      baseScorecard.compliance
    );

    return {
      ...baseScorecard,
      detailedAnalysis: {
        scoreBreakdown,
        marketPosition,
        trendMomentum,
        actionableRecommendations
      }
    };
  }

  /**
   * Get supplier data with validation
   */
  private static async getSupplierData(supplierId: string): Promise<Supplier> {
    const supplierCrudService = await import('../supplier.crud');
    const supplier = await supplierCrudService.SupplierCrudService.getById(supplierId);
    
    if (!supplier || !isValidSupplier(supplier)) {
      throw new Error(`Supplier not found or invalid: ${supplierId}`);
    }

    return supplier;
  }

  /**
   * Get all suppliers for analysis
   */
  private static async getAllSuppliersForAnalysis(): Promise<Supplier[]> {
    try {
      const supplierCrudService = await import('../supplier.crud');
      const allSuppliers = await supplierCrudService.SupplierCrudService.getAll();
      return allSuppliers.filter(isValidSupplier);
    } catch (error) {
      log.error('Error fetching suppliers for analysis:', { data: error }, 'scorecardGenerator');
      return [];
    }
  }

  /**
   * Chunk array into smaller arrays
   */
  private static chunkArray<T>(array: T[], chunkSize: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }

  /**
   * Execute promises with concurrency limit
   */
  private static async executeWithConcurrencyLimit<T>(
    promises: Promise<T>[], 
    limit: number
  ): Promise<T[]> {
    const results: T[] = [];
    for (let i = 0; i < promises.length; i += limit) {
      const batch = promises.slice(i, i + limit);
      const batchResults = await Promise.allSettled(batch);
      
      batchResults.forEach((result) => {
        if (result.status === 'fulfilled') {
          results.push(result.value);
        }
      });
    }
    return results;
  }

  /**
   * Regenerate scorecard for supplier (refresh cached data)
   */
  static async regenerateScorecard(
    supplierId: string,
    options: ScorecardGenerationOptions = DEFAULT_SCORECARD_OPTIONS
  ): Promise<SupplierScorecard> {

    return this.generateSupplierScorecard(supplierId, options);
  }

  /**
   * Get scorecard generation statistics
   */
  static async getGenerationStatistics(): Promise<{
    totalSuppliersProcessed: number;
    averageProcessingTime: number;
    successRate: number;
    lastProcessedAt: Date;
  }> {
    // In a real implementation, this would query stored statistics
    // For now, return simulated statistics
    return {
      totalSuppliersProcessed: 0,
      averageProcessingTime: 0,
      successRate: 0,
      lastProcessedAt: new Date()
    };
  }

  /**
   * Validate scorecard generation prerequisites
   */
  static async validatePrerequisites(supplierId: string): Promise<{
    isValid: boolean;
    issues: string[];
    warnings: string[];
  }> {
    const issues: string[] = [];
    const warnings: string[] = [];

    try {
      const supplier = await this.getSupplierData(supplierId);

      // Check required data
      if (!supplier.rating) {
        warnings.push('No rating data available - will affect overall score');
      }

      if (!supplier.performance) {
        warnings.push('No performance data available - will affect overall score');
      }

      if (!supplier.complianceStatus) {
        warnings.push('No compliance data available - will affect overall score');
      }

      if (!supplier.primaryContact?.email) {
        warnings.push('Missing primary contact email - will affect communication score');
      }

      // Check data quality
      const rating = ScorecardCalculator.extractSupplierRating(supplier);
      if (rating === 0) {
        warnings.push('Invalid or missing rating data');
      }

    } catch (error) {
      issues.push(`Cannot access supplier data: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    return {
      isValid: issues.length === 0,
      issues,
      warnings
    };
  }
}
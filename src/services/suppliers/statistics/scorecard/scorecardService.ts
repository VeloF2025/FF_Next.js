/**
 * Core Scorecard Service Module - Legacy Compatibility Layer
 * @deprecated Use modular components from '../scorecard-service' instead
 * This file maintains backward compatibility for existing imports
 * New code should import from '../scorecard-service' directly
 */

import { Supplier } from '@/types/supplier/base.types';
import { SupplierScorecard } from '../types';
import {
  ScorecardBatchProcessor,
  ScorecardEnhancedGenerator,
  ScorecardDataValidator,
  type ScorecardConfig,
  type ScorecardGenerationResult,
  type BatchScorecardOptions,
  DEFAULT_SCORE_WEIGHTS
} from '../scorecard-service';
import { ScoreCalculator } from './scoreCalculator';
import { BenchmarkCalculator } from './benchmarkCalculator';
import { RecommendationGenerator } from './recommendationGenerator';
import { log } from '@/lib/logger';

export class ScorecardService {
  /**
   * Generate comprehensive supplier scorecard
   * @deprecated Use ScorecardDataValidator and modular components instead
   */
  static async generateSupplierScorecard(
    supplierId: string,
    config: ScorecardConfig = {}
  ): Promise<ScorecardGenerationResult> {
    const warnings: string[] = [];
    
    try {
      // Validate supplier ID using new validator
      if (!ScorecardDataValidator.isValidSupplierId(supplierId)) {
        throw new Error('Invalid supplier ID provided');
      }

      // Get supplier data
      const supplier = await this.getSupplier(supplierId);

      // Validate supplier data quality using new validator
      const dataValidation = ScorecardDataValidator.validateSupplierData(supplier);
      if (!dataValidation.isValid) {
        warnings.push(`Data quality issues: ${dataValidation.issues.join(', ')}`);
      }

      const supplierName = ScorecardDataValidator.getSupplierDisplayName(supplier);

      // Calculate overall score
      const overallScore = ScoreCalculator.calculateOverallScore(supplier, DEFAULT_SCORE_WEIGHTS);

      // Get detailed ratings
      const ratings = config.includeDetailedRatings !== false ? 
        ScoreCalculator.extractRatings(supplier) : undefined;

      // Get performance metrics
      const performance = ScoreCalculator.extractPerformance(supplier);

      // Get compliance information
      const compliance = ScoreCalculator.extractCompliance(supplier);

      // Calculate trends (if enabled)
      const trends = config.includeTrendAnalysis !== false ? 
        await BenchmarkCalculator.calculateTrends(supplier) : undefined;

      // Calculate benchmarks (if enabled)
      const benchmarks = config.includeBenchmarks !== false ? 
        await BenchmarkCalculator.calculateBenchmarks(supplier) : undefined;

      // Generate recommendations (if enabled)
      const recommendations = config.includeRecommendations !== false ? 
        RecommendationGenerator.generateRecommendations(
          supplier, 
          overallScore, 
          compliance,
          performance
        ) : [];

      const scorecard: SupplierScorecard = {
        supplierId,
        supplierName,
        overallScore,
        ratings: ratings || {
          quality: 0,
          delivery: 0,
          communication: 0,
          pricing: 0,
          reliability: 0
        },
        performance,
        compliance,
        trends: trends || {
          last3Months: 0,
          last6Months: 0,
          last12Months: 0
        },
        benchmarks: benchmarks || {
          industryPercentile: 50,
          categoryPercentile: 50,
          peerComparison: 'at'
        },
        recommendations,
        lastUpdated: new Date()
      };

      return {
        scorecard: scorecard as unknown as import('../scorecard-service/service-types').ScorecardData,
        warnings,
        dataQuality: {
          completeness: dataValidation.completeness,
          reliability: ScorecardDataValidator.calculateDataReliability(supplier, warnings)
        }
      };
    } catch (error) {
      log.error('Error generating supplier scorecard:', { data: error }, 'scorecardService');
      throw new Error(`Failed to generate scorecard: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Generate scorecards for multiple suppliers
   * @deprecated Use ScorecardBatchProcessor instead
   */
  static async generateMultipleScorecards(
    supplierIds: string[],
    options: BatchScorecardOptions = {}
  ): Promise<SupplierScorecard[]> {
    const results = await ScorecardBatchProcessor.generateMultipleScorecards(
      supplierIds,
      options,
      (id) => this.generateSupplierScorecard(id)
    );
    return results as unknown as SupplierScorecard[];
  }

  /**
   * Generate scorecard with enhanced analytics
   * @deprecated Use ScorecardEnhancedGenerator instead
   */
  static async generateEnhancedScorecard(
    supplierId: string,
    includeRegionalBenchmarks: boolean = true,
    includeCategoryBenchmarks: boolean = true
  ): Promise<unknown> {
    return ScorecardEnhancedGenerator.generateEnhancedScorecard(
      supplierId,
      includeRegionalBenchmarks,
      includeCategoryBenchmarks,
      (id) => this.generateSupplierScorecard(id),
      (id) => this.getSupplier(id)
    );
  }

  /**
   * Get scorecard summary statistics
   * @deprecated Use ScorecardBatchProcessor.getScorecardSummary instead
   */
  static async getScorecardSummary(supplierIds: string[]) {
    return ScorecardBatchProcessor.getScorecardSummary(
      supplierIds,
      (ids) => this.generateMultipleScorecards(ids) as unknown as Promise<import('../scorecard-service/service-types').ScorecardData[]>
    );
  }

  /**
   * Helper method to get supplier data
   */
  private static async getSupplier(supplierId: string): Promise<Supplier> {
    const supplierCrudService = await import('../../supplier.crud');
    const supplier = await supplierCrudService.SupplierCrudService.getById(supplierId);
    
    if (!supplier) {
      throw new Error('Supplier not found');
    }

    return supplier;
  }
}

// Re-export modular components for easier migration
export {
  ScorecardBatchProcessor,
  ScorecardEnhancedGenerator,
  ScorecardDataValidator
} from '../scorecard-service';
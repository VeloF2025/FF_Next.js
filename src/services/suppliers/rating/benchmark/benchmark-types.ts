/**
 * Benchmark System Types
 * Type definitions for supplier benchmark and comparison system
 */

import type { Supplier } from '@/types/supplier/base.types';

/**
 * Performance metrics structure
 */
export interface PerformanceMetrics {
  overallScore: number;
  deliveryScore: number;
  qualityScore: number;
  priceScore: number;
  serviceScore: number;
}

/**
 * Benchmark data structure
 */
export interface BenchmarkData {
  industryAverages: PerformanceMetrics;
  topPerformers: PerformanceMetrics;
  categoryBenchmarks: Record<string, {
    overallScore: number;
    sampleSize: number;
  }>;
}

/**
 * Supplier comparison results
 */
export interface SupplierComparison {
  supplierScores: PerformanceMetrics;
  industryComparison: PerformanceMetricsDiff;
  topPerformersComparison: PerformanceMetricsDiff;
  categoryRanking?: CategoryRanking[];
}

/**
 * Performance metrics differences
 */
export interface PerformanceMetricsDiff {
  overallDiff: number;
  deliveryDiff: number;
  qualityDiff: number;
  priceDiff: number;
  serviceDiff: number;
}

/**
 * Category ranking information
 */
export interface CategoryRanking {
  category: string;
  rank: number;
  totalInCategory: number;
  percentile: number;
}

/**
 * Benchmark trend data point
 */
export interface BenchmarkTrendPoint {
  period: string;
  industryAverage: number;
  topPerformerAverage: number;
  categoryAverages: Record<string, number>;
}

/**
 * Category statistics
 */
export interface CategoryStats {
  category: string;
  suppliers: Supplier[];
  averageScore: number;
  sampleSize: number;
}

/**
 * Ranking calculation options
 */
export interface RankingOptions {
  includeInactive?: boolean;
  minimumScore?: number;
  sortBy?: 'overallScore' | 'deliveryScore' | 'qualityScore' | 'priceScore' | 'serviceScore';
}

/**
 * Benchmark calculation parameters
 */
export interface BenchmarkCalculationParams {
  topPercentile?: number; // Default 0.1 (top 10%)
  includeInactive?: boolean;
  minimumSampleSize?: number;
  dateRange?: {
    from: Date;
    to: Date;
  };
}

/**
 * Trend analysis configuration
 */
export interface TrendAnalysisConfig {
  months: number;
  includeCategories?: string[];
  smoothingFactor?: number;
  generateMockData?: boolean;
}

/**
 * Performance scoring context
 */
export interface PerformanceContext {
  supplier: Supplier;
  allSuppliers: Supplier[];
  categorySuppliers: Supplier[];
  benchmarks: BenchmarkData;
}

/**
 * Comparison report options
 */
export interface ComparisonReportOptions {
  includeHistoricalData?: boolean;
  includeCategoryRankings?: boolean;
  includeRecommendations?: boolean;
  format?: 'summary' | 'detailed' | 'executive';
}

/**
 * Benchmark validation result
 */
export interface BenchmarkValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  dataQuality: {
    sampleSize: number;
    completenessScore: number;
    reliabilityScore: number;
  };
}
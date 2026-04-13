/**
 * Scorecard Type Definitions
 * Shared types and interfaces for supplier scorecard system
 */

import { Supplier } from '@/types/supplier/base.types';

export interface SupplierRatings {
  quality: number;
  delivery: number;
  communication: number;
  pricing: number;
  reliability: number;
}

export interface SupplierPerformance {
  onTimeDelivery: number;
  qualityScore: number;
  responseTime: number;
  issueResolution: number;
}

export interface SupplierCompliance {
  score: number;
  status: string;
  lastCheck: Date;
}

export interface SupplierTrends {
  last3Months: number;
  last6Months: number;
  last12Months: number;
}

export interface SupplierBenchmarks {
  industryPercentile: number;
  categoryPercentile: number;
  peerComparison: 'above' | 'at' | 'below';
}

export interface SupplierScorecard {
  supplierId: string;
  supplierName: string;
  overallScore: number;
  ratings: SupplierRatings;
  performance: SupplierPerformance;
  compliance: SupplierCompliance;
  trends: SupplierTrends;
  benchmarks: SupplierBenchmarks;
  recommendations: string[];
  lastUpdated: Date;
}

export interface ScoreCalculationWeights {
  rating: number;
  performance: number;
  compliance: number;
  preferredStatus: number;
  responseTime: number;
}

export interface ScoreCalculationResult {
  totalScore: number;
  weightedSum: number;
  breakdown: {
    rating: number;
    performance: number;
    compliance: number;
    preferredBonus: number;
    responseTime: number;
  };
}

export interface ComplianceStatusMap {
  excellent: number;
  good: number;
  acceptable: number;
  needsImprovement: number;
  critical: number;
}

export interface PercentileCalculation {
  value: number;
  ranking: number;
  totalCount: number;
  percentile: number;
}

export interface RecommendationCriteria {
  overallScore: number;
  rating: number;
  complianceScore: number;
  performanceMetrics: SupplierPerformance;
  isPreferred: boolean;
  hasCompleteContact: boolean;
}

export interface ScorecardGenerationOptions {
  includeTrends?: boolean;
  includeBenchmarks?: boolean;
  includeRecommendations?: boolean;
  calculateHistoricalData?: boolean;
}

export interface ScorecardBatchResult {
  successful: SupplierScorecard[];
  failed: { supplierId: string; error: string }[];
  totalProcessed: number;
  successRate: number;
}

// Type guards
export function isValidSupplier(supplier: unknown): supplier is Supplier {
  return supplier != null &&
         typeof supplier === 'object' &&
         ('id' in supplier || '_id' in supplier) &&
         ('companyName' in supplier || 'name' in supplier);
}

export function isValidRating(rating: unknown): boolean {
  if (typeof rating === 'number') {
    return rating >= 0 && rating <= 5;
  }
  if (rating != null && typeof rating === 'object' && 'overall' in rating) {
    const overall = (rating as Record<string, unknown>).overall;
    return typeof overall === 'number' && overall >= 0 && overall <= 5;
  }
  return false;
}

export function isValidPerformance(performance: unknown): boolean {
  return performance != null &&
         typeof performance === 'object' &&
         'overallScore' in performance &&
         typeof (performance as Record<string, unknown>).overallScore === 'number';
}

export function isValidCompliance(compliance: unknown): boolean {
  return compliance != null &&
         typeof compliance === 'object';
}

// Constants
export const DEFAULT_SCORE_WEIGHTS: ScoreCalculationWeights = {
  rating: 30,
  performance: 25,
  compliance: 25,
  preferredStatus: 10,
  responseTime: 10
};

export const COMPLIANCE_STATUS_THRESHOLDS: ComplianceStatusMap = {
  excellent: 90,
  good: 80,
  acceptable: 60,
  needsImprovement: 40,
  critical: 0
};

export const PEER_COMPARISON_THRESHOLDS = {
  above: 75,
  below: 25
};

export const DEFAULT_SCORECARD_OPTIONS: ScorecardGenerationOptions = {
  includeTrends: true,
  includeBenchmarks: true,
  includeRecommendations: true,
  calculateHistoricalData: false
};

// Helper type for supplier rating extraction
export type SupplierRatingValue = number | { overall: number; breakdown?: Partial<SupplierRatings> };

// Type for batch processing configuration
export interface BatchProcessingConfig {
  batchSize: number;
  concurrencyLimit: number;
  retryAttempts: number;
  timeoutMs: number;
}
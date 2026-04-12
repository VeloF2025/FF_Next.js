/**
 * Scorecard Service Types
 * Type definitions for scorecard service operations
 */

export interface ScorecardConfig {
  includeDetailedRatings?: boolean;
  includeTrendAnalysis?: boolean;
  includeBenchmarks?: boolean;
  includeRecommendations?: boolean;
}

/** Minimal scorecard shape — full SupplierScorecard lives in supplier.types */
export interface ScorecardData {
  supplierId: string;
  supplierName: string;
  overallScore: number;
  [key: string]: unknown;
}

export interface ScorecardGenerationResult {
  scorecard: ScorecardData;
  warnings: string[];
  dataQuality: {
    completeness: number;
    reliability: number;
  };
}

export interface BatchScorecardOptions {
  batchSize?: number;
  includeFailures?: boolean;
  sortBy?: 'score' | 'name' | 'category';
  filters?: {
    minScore?: number;
    categories?: string[];
    statuses?: string[];
  };
}

export interface ScorecardSummary {
  totalScorecards: number;
  averageScore: number;
  scoreDistribution: Record<string, number>;
  topPerformers: Array<{ supplierId: string; supplierName: string; score: number }>;
  improvementCandidates: Array<{ supplierId: string; supplierName: string; score: number }>;
}

export interface RegionalBenchmarks {
  regionalPercentile: number;
  regionalAverage: number;
  topRegionalSuppliers: Array<{ name: string; score: number }>;
}

export interface CategoryBenchmarks {
  category: string;
  categoryPercentile: number;
  categoryAverage: number;
  categoryLeaders: Array<{ name: string; score: number }>;
}

export interface PriorityRecommendation {
  priority: 'critical' | 'high' | 'medium' | 'low';
  category: string;
  recommendation: string;
  impact: 'high' | 'medium' | 'low';
  effort: 'high' | 'medium' | 'low';
  timeline: string;
}

export interface EnhancedScorecardResult extends ScorecardGenerationResult {
  regionalBenchmarks?: RegionalBenchmarks;
  categoryBenchmarks?: CategoryBenchmarks[];
  priorityRecommendations?: PriorityRecommendation[];
}

export const DEFAULT_SCORE_WEIGHTS = {
  rating: 0.30,
  performance: 0.25,
  compliance: 0.25,
  preferred: 0.10,
  response: 0.10
};

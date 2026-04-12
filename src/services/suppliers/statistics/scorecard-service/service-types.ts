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

export interface EnhancedScorecardResult extends ScorecardGenerationResult {
  regionalBenchmarks?: Record<string, unknown>;
  categoryBenchmarks?: Record<string, unknown>;
  priorityRecommendations?: Record<string, unknown>;
}

export const DEFAULT_SCORE_WEIGHTS = {
  rating: 0.30,
  performance: 0.25,
  compliance: 0.25,
  preferred: 0.10,
  response: 0.10
};
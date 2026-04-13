/**
 * Scorecard Generator Types and Interfaces
 */


/**
 * Scorecard generation configuration
 */
export interface ScorecardConfig {
  includeDetailedRatings?: boolean;
  includeTrendAnalysis?: boolean;
  includeBenchmarks?: boolean;
  includeRecommendations?: boolean;
  historicalDataMonths?: number;
}

/**
 * Rating breakdown interface
 */
export interface RatingBreakdown {
  quality: number;
  delivery: number;
  communication: number;
  pricing: number;
  reliability: number;
}

/**
 * Performance metrics interface
 */
export interface PerformanceMetrics {
  onTimeDelivery: number;
  qualityScore: number;
  responseTime: number;
  issueResolution: number;
}

/**
 * Compliance information interface
 */
export interface ComplianceInfo {
  score: number;
  status: string;
  lastCheck: Date;
}

/**
 * Trend data interface
 */
export interface TrendData {
  last3Months: number;
  last6Months: number;
  last12Months: number;
}

/**
 * Benchmark data interface
 */
export interface BenchmarkData {
  industryPercentile: number;
  categoryPercentile: number;
  peerComparison: 'above' | 'at' | 'below';
}

/**
 * Score calculation weights
 */
export interface ScoreWeights {
  rating: number;
  performance: number;
  compliance: number;
  preferred: number;
  response: number;
}

/**
 * Default score calculation weights
 */
export const DEFAULT_SCORE_WEIGHTS: ScoreWeights = {
  rating: 30,
  performance: 25,
  compliance: 25,
  preferred: 10,
  response: 10
};

/**
 * Compliance status thresholds
 */
export const COMPLIANCE_THRESHOLDS = {
  EXCELLENT: 90,
  GOOD: 80,
  ACCEPTABLE: 60,
  NEEDS_IMPROVEMENT: 40
} as const;

/**
 * Performance recommendation thresholds
 */
export const RECOMMENDATION_THRESHOLDS = {
  CRITICAL_SCORE: 60,
  IMPROVEMENT_SCORE: 80,
  MIN_RATING: 3.5,
  MIN_COMPLIANCE: 80,
  MIN_DELIVERY: 90,
  MIN_QUALITY: 85,
  PREFERRED_SCORE: 85
} as const;

/**
 * Scorecard generation result
 */
export interface ScorecardGenerationResult {
  scorecard: Record<string, unknown>; // Shape defined by SupplierScorecard in main statistics/types
  warnings: string[];
  dataQuality: {
    completeness: number;
    reliability: number;
  };
}

/**
 * Batch scorecard generation options
 */
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
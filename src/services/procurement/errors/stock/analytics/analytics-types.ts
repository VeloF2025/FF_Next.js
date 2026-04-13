/**
 * Analytics Types
 * TypeScript interfaces and type definitions for stock error analytics
 */

export interface ErrorPattern {
  pattern: string;
  frequency: number;
  severity: number;
  affectedItems: string[];
  affectedLocations: string[];
  recommendedActions: string[];
}

export interface ErrorTrend {
  timeframe: string;
  errorCount: number;
  errorTypes: Record<string, number>;
  peakHours: number[];
  resolution: 'hourly' | 'daily' | 'weekly' | 'monthly';
}

export interface ErrorInsight {
  type: 'item' | 'location' | 'process' | 'timing';
  title: string;
  description: string;
  impact: 'high' | 'medium' | 'low';
  actionable: boolean;
  recommendations: string[];
  data: Record<string, unknown>;
}

export interface ErrorAnalysisResult {
  mostCommonItems: Array<{ itemCode: string; count: number; errorTypes: string[] }>;
  errorTypes: Array<{ type: string; count: number; percentage: number }>;
  timeDistribution: Array<{ hour: number; count: number }>;
  locations: Array<{ location: string; count: number; errorTypes: string[] }>;
  correlations: Array<{ items: string[]; strength: number; commonErrors: string[] }>;
}

export interface ErrorMetrics {
  totalErrors: number;
  errorRate: number; // errors per day
  meanTimeToResolution: number; // in hours (would need resolution timestamps)
  errorDistribution: Record<string, number>;
  criticality: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
  trends: {
    increasing: boolean;
    changeRate: number; // percentage change
  };
}

export interface PredictiveInsights {
  riskItems: Array<{ itemCode: string; riskScore: number; predictedIssues: string[] }>;
  riskLocations: Array<{ location: string; riskScore: number; predictedIssues: string[] }>;
  preventiveActions: Array<{ priority: number; action: string; expectedImpact: string }>;
}

export interface ItemErrorData {
  count: number;
  errorTypes: Set<string>;
}

export interface LocationErrorData {
  count: number;
  errorTypes: Set<string>;
}

export interface TimeframeConfig {
  start: Date;
  end: Date;
}

export interface CriticalityAssessment {
  critical: number;
  high: number;
  medium: number;
  low: number;
}

export interface RiskAssessment {
  itemCode?: string;
  location?: string;
  riskScore: number;
  predictedIssues: string[];
}

export interface PreventiveAction {
  priority: number;
  action: string;
  expectedImpact: string;
}
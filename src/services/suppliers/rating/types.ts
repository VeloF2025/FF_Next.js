/**
 * Supplier Rating Types
 * Type definitions for supplier rating and performance management
 */

import { 
  Supplier, 
  SupplierRating, 
  SupplierPerformance, 
  PerformancePeriod 
} from '@/types/supplier/base.types';

/**
 * Rating update data
 */
export interface RatingUpdateData extends Partial<SupplierRating> {
  // Additional fields for rating updates
}

/**
 * Performance calculation options
 */
export interface PerformanceCalculationOptions {
  period: PerformancePeriod;
  includeHistorical?: boolean;
  aggregateMethod?: 'average' | 'weighted' | 'latest';
}

/**
 * Performance trends data point
 */
export interface PerformanceTrendPoint {
  period: string;
  overallScore: number;
  deliveryScore: number;
  qualityScore: number;
  priceScore: number;
  serviceScore: number;
}

/**
 * Supplier comparison result
 */
export interface SupplierComparison {
  supplier: Supplier;
  ratings: SupplierRating;
  performance?: SupplierPerformance;
}

/**
 * Rating statistics
 */
export interface RatingStatistics {
  averageRating: number;
  totalReviews: number;
  ratingDistribution: Record<number, number>;
  categoryAverages: Record<string, number>;
}

/**
 * Evaluation report action item
 */
export interface EvaluationActionItem {
  priority: 'high' | 'medium' | 'low';
  description: string;
  dueDate?: Date;
  assignedTo?: string;
}

/**
 * Supplier evaluation report
 */
export interface SupplierEvaluationReport {
  performance: SupplierPerformance;
  recommendations: string[];
  actionItems: EvaluationActionItem[];
  generatedDate: Date;
  evaluationPeriod: PerformancePeriod;
}

/**
 * Rating service interface
 */
export interface IRatingService {
  updateRating(id: string, rating: RatingUpdateData, reviewerId?: string): Promise<void>;
  normalizeRating(rating: Partial<SupplierRating> | number | unknown): SupplierRating;
  calculateOverallRating(rating: SupplierRating): number;
}

/**
 * Performance service interface
 */
export interface IPerformanceService {
  calculatePerformance(supplierId: string, period: PerformancePeriod): Promise<SupplierPerformance>;
  getPerformanceTrends(supplierId: string, months?: number): Promise<PerformanceTrendPoint[]>;
  generatePerformanceMetrics(supplierId: string, period: PerformancePeriod): Promise<SupplierPerformance>;
}

/**
 * Analytics service interface
 */
export interface IAnalyticsService {
  getTopRated(limit?: number, category?: string): Promise<Supplier[]>;
  compareSuppliers(supplierIds: string[]): Promise<SupplierComparison[]>;
  getRatingStatistics(): Promise<RatingStatistics>;
  generateEvaluationReport(supplierId: string, period: PerformancePeriod): Promise<SupplierEvaluationReport>;
}
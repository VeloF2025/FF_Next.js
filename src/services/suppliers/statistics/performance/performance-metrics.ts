/**
 * Performance Metrics Calculator
 * Core calculations for supplier performance metrics
 */

import { Supplier } from '@/types/supplier/base.types';
import { QuartileStats, PerformanceMetric } from './analyzer-types';

export class PerformanceMetricsCalculator {
  /**
   * Calculate quartile statistics from sorted values
   */
  static calculateQuartiles(sortedValues: number[]): QuartileStats {
    const n = sortedValues.length;
    if (n === 0) {
      return { q1: 0, median: 0, q3: 0, min: 0, max: 0 };
    }

    const q1Index = Math.floor((n + 1) * 0.25) - 1;
    const medianIndex = Math.floor((n + 1) * 0.5) - 1;
    const q3Index = Math.floor((n + 1) * 0.75) - 1;

    return {
      min: sortedValues[0]!,
      q1: q1Index >= 0 ? sortedValues[q1Index]! : sortedValues[0]!,
      median: medianIndex >= 0 ? sortedValues[medianIndex]! : sortedValues[0]!,
      q3: q3Index >= 0 ? sortedValues[q3Index]! : sortedValues[n - 1]!,
      max: sortedValues[n - 1]!
    };
  }

  /**
   * Calculate average rating for suppliers
   */
  static calculateAverageRating(suppliers: Supplier[]): number {
    const validSuppliers = suppliers.filter(s => this.getSupplierRating(s) > 0);
    if (validSuppliers.length === 0) return 0;

    const totalRating = validSuppliers.reduce((sum, supplier) => {
      return sum + this.getSupplierRating(supplier);
    }, 0);

    return Math.round((totalRating / validSuppliers.length) * 100) / 100;
  }

  /**
   * Calculate average performance for suppliers
   */
  static calculateAveragePerformance(suppliers: Supplier[]): number {
    const validSuppliers = suppliers.filter(s => s.performanceMetrics?.overallScore !== undefined);
    if (validSuppliers.length === 0) return 0;

    const totalPerformance = validSuppliers.reduce((sum, supplier) => {
      return sum + (supplier.performanceMetrics?.overallScore || 0);
    }, 0);

    return Math.round((totalPerformance / validSuppliers.length) * 100) / 100;
  }

  /**
   * Get supplier rating (handles different rating formats)
   */
  static getSupplierRating(supplier: Supplier): number {
    if (typeof supplier.rating === 'number') {
      return supplier.rating;
    }
    if (supplier.rating && typeof supplier.rating === 'object') {
      // Assume it's an aggregated rating object with an average field
      return (supplier.rating as { average?: number }).average || 0;
    }
    return 0;
  }

  /**
   * Calculate standard deviation
   */
  static calculateStandardDeviation(values: number[]): number {
    if (values.length === 0) return 0;
    
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const squaredDifferences = values.map(value => Math.pow(value - mean, 2));
    const variance = squaredDifferences.reduce((sum, diff) => sum + diff, 0) / values.length;
    
    return Math.sqrt(variance);
  }

  /**
   * Extract performance metrics from suppliers
   */
  static extractPerformanceMetrics(suppliers: Supplier[]): PerformanceMetric[] {
    return suppliers
      .filter(supplier => this.getSupplierRating(supplier) > 0)
      .map(supplier => ({
        supplierId: supplier.id,
        rating: this.getSupplierRating(supplier),
        performance: supplier.performanceMetrics?.overallScore || 0,
        ...(supplier.category && { category: supplier.category }),
        businessType: supplier.businessType,
        calculatedAt: new Date()
      }));
  }

  /**
   * Group metrics by category
   */
  static groupMetricsByCategory(metrics: PerformanceMetric[]): Record<string, PerformanceMetric[]> {
    return metrics.reduce((groups, metric) => {
      const category = metric.category || 'Uncategorized';
      if (!groups[category]) {
        groups[category] = [];
      }
      groups[category].push(metric);
      return groups;
    }, {} as Record<string, PerformanceMetric[]>);
  }

  /**
   * Group metrics by business type
   */
  static groupMetricsByBusinessType(metrics: PerformanceMetric[]): Record<string, PerformanceMetric[]> {
    return metrics.reduce((groups, metric) => {
      const businessType = metric.businessType || 'Unknown';
      if (!groups[businessType]) {
        groups[businessType] = [];
      }
      groups[businessType].push(metric);
      return groups;
    }, {} as Record<string, PerformanceMetric[]>);
  }

  /**
   * Calculate percentile for a value within a dataset
   */
  static calculatePercentile(value: number, sortedValues: number[]): number {
    if (sortedValues.length === 0) return 0;
    
    let count = 0;
    for (const val of sortedValues) {
      if (val <= value) {
        count++;
      } else {
        break;
      }
    }
    
    return (count / sortedValues.length) * 100;
  }

  /**
   * Identify top performers (top quartile)
   */
  static identifyTopPerformers(suppliers: Supplier[]): Supplier[] {
    const ratings = suppliers
      .map(s => this.getSupplierRating(s))
      .filter(r => r > 0)
      .sort((a, b) => b - a);
    
    if (ratings.length === 0) return [];
    
    const q3Index = Math.floor(ratings.length * 0.75);
    const threshold = ratings[q3Index]!;

    return suppliers.filter(s => this.getSupplierRating(s) >= threshold);
  }

  /**
   * Identify underperformers (bottom quartile)
   */
  static identifyUnderperformers(suppliers: Supplier[]): Supplier[] {
    const ratings = suppliers
      .map(s => this.getSupplierRating(s))
      .filter(r => r > 0)
      .sort((a, b) => a - b);

    if (ratings.length === 0) return [];

    const q1Index = Math.floor(ratings.length * 0.25);
    const threshold = ratings[q1Index]!;

    return suppliers.filter(s => this.getSupplierRating(s) <= threshold);
  }

  /**
   * Calculate performance score from multiple metrics
   */
  static calculateCompositePerformanceScore(metrics: {
    quality?: number;
    delivery?: number;
    cost?: number;
    service?: number;
    weights?: {
      quality?: number;
      delivery?: number;
      cost?: number;
      service?: number;
    };
  }): number {
    const defaultWeights = {
      quality: 0.3,
      delivery: 0.3,
      cost: 0.2,
      service: 0.2
    };

    const weights = { ...defaultWeights, ...metrics.weights };
    let totalScore = 0;
    let totalWeight = 0;

    if (metrics.quality !== undefined) {
      totalScore += metrics.quality * weights.quality!;
      totalWeight += weights.quality!;
    }

    if (metrics.delivery !== undefined) {
      totalScore += metrics.delivery * weights.delivery!;
      totalWeight += weights.delivery!;
    }

    if (metrics.cost !== undefined) {
      totalScore += metrics.cost * weights.cost!;
      totalWeight += weights.cost!;
    }

    if (metrics.service !== undefined) {
      totalScore += metrics.service * weights.service!;
      totalWeight += weights.service!;
    }

    return totalWeight > 0 ? totalScore / totalWeight : 0;
  }

  /**
   * Calculate month-over-month change percentage
   */
  static calculateChangePercentage(current: number, previous: number): number {
    if (previous === 0) return current > 0 ? 100 : 0;
    return ((current - previous) / previous) * 100;
  }

  /**
   * Determine trend direction from change percentage
   */
  static determineTrend(changePercent: number): 'increasing' | 'decreasing' | 'stable' {
    if (Math.abs(changePercent) < 2) return 'stable';
    return changePercent > 0 ? 'increasing' : 'decreasing';
  }

  /**
   * Determine significance level of change
   */
  static determineSignificance(absChangePercent: number): 'high' | 'medium' | 'low' {
    if (absChangePercent > 20) return 'high';
    if (absChangePercent > 10) return 'medium';
    return 'low';
  }
}
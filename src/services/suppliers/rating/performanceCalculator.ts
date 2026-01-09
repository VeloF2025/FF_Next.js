/**
 * Supplier Performance Calculator
 * Calculate comprehensive supplier performance metrics
 *
 * NOTE: Firebase Firestore has been removed. This service now uses API endpoints.
 */

import { SupplierPerformance, PerformancePeriod } from '@/types/supplier/base.types';
import { PerformanceTrendPoint } from './types';
import { SupplierCrudService } from '../supplier.crud';
import { log } from '@/lib/logger';

export class SupplierPerformanceCalculator {
  /**
   * Calculate comprehensive supplier performance metrics
   */
  static async calculatePerformance(
    supplierId: string,
    period: PerformancePeriod
  ): Promise<SupplierPerformance> {
    try {
      // In a real implementation, this would aggregate data from:
      // - Purchase orders
      // - Deliveries
      // - Quality inspections
      // - Invoice payments
      // - Communication logs

      const performance = await this.generatePerformanceMetrics(supplierId, period);

      // Update supplier with latest performance data
      await SupplierCrudService.update(supplierId, {
        performance: performance,
        lastPerformanceUpdate: new Date(),
        updatedAt: new Date()
      } as never);

      return performance;
    } catch (error) {
      log.error(`Error calculating supplier performance for ${supplierId}:`, { data: error }, 'performanceCalculator');
      throw new Error(`Failed to calculate supplier performance: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get performance trends over time
   */
  static async getPerformanceTrends(
    supplierId: string,
    months: number = 12
  ): Promise<PerformanceTrendPoint[]> {
    try {
      // In a real implementation, this would query historical performance data
      // For now, return mock trend data
      const trends = [];
      const currentDate = new Date();

      for (let i = months - 1; i >= 0; i--) {
        const periodDate = new Date(currentDate.getFullYear(), currentDate.getMonth() - i, 1);
        const periodName = periodDate.toISOString().substring(0, 7); // YYYY-MM format

        trends.push({
          period: periodName,
          overallScore: Math.round(85 + Math.random() * 15), // 85-100
          deliveryScore: Math.round(80 + Math.random() * 20), // 80-100
          qualityScore: Math.round(90 + Math.random() * 10), // 90-100
          priceScore: Math.round(75 + Math.random() * 25), // 75-100
          serviceScore: Math.round(85 + Math.random() * 15)  // 85-100
        });
      }

      return trends;
    } catch (error) {
      log.error(`Error getting performance trends for ${supplierId}:`, { data: error }, 'performanceCalculator');
      return [];
    }
  }

  /**
   * Generate mock performance metrics
   */
  static async generatePerformanceMetrics(
    _supplierId: string,
    period: PerformancePeriod
  ): Promise<SupplierPerformance> {
    // This would typically aggregate real data from multiple sources
    // For now, generate realistic mock data

    const baseScore = 85 + Math.random() * 15; // 85-100 base score
    const variance = 10; // ±10 point variance for different metrics

    return {
      overallScore: Math.round(baseScore),
      deliveryScore: Math.round(Math.max(70, Math.min(100, baseScore + (Math.random() - 0.5) * variance))),
      qualityScore: Math.round(Math.max(80, Math.min(100, baseScore + (Math.random() - 0.5) * variance))),
      priceScore: Math.round(Math.max(60, Math.min(100, baseScore + (Math.random() - 0.5) * variance * 2))),
      serviceScore: Math.round(Math.max(70, Math.min(100, baseScore + (Math.random() - 0.5) * variance))),
      complianceScore: Math.round(Math.max(90, Math.min(100, baseScore + Math.random() * 5))),

      metrics: {
        totalOrders: Math.floor(5 + Math.random() * 20),
        completedOrders: Math.floor(4 + Math.random() * 18),
        onTimeDeliveries: Math.floor(3 + Math.random() * 15),
        lateDeliveries: Math.floor(Math.random() * 3),
        defectiveItems: Math.floor(Math.random() * 5),
        returnedItems: Math.floor(Math.random() * 3),
        averageLeadTime: Math.floor(3 + Math.random() * 10),
        averageResponseTime: Math.floor(1 + Math.random() * 8)
      },

      issues: [],
      evaluationPeriod: period,
      lastEvaluationDate: new Date(),
      nextEvaluationDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    };
  }

  /**
   * Calculate delivery performance score
   */
  static calculateDeliveryScore(metrics: {
    totalOrders: number;
    onTimeDeliveries: number;
    lateDeliveries: number;
    averageLeadTime: number;
  }): number {
    if (metrics.totalOrders === 0) return 0;

    const onTimeRate = (metrics.onTimeDeliveries / metrics.totalOrders) * 100;
    const lateRate = (metrics.lateDeliveries / metrics.totalOrders) * 100;

    // Base score from on-time delivery rate
    let score = onTimeRate;

    // Penalty for late deliveries
    score -= lateRate * 0.5;

    // Bonus/penalty for lead time (assuming target is 7 days)
    const targetLeadTime = 7;
    if (metrics.averageLeadTime < targetLeadTime) {
      score += (targetLeadTime - metrics.averageLeadTime) * 2; // Bonus for fast delivery
    } else {
      score -= (metrics.averageLeadTime - targetLeadTime) * 1; // Penalty for slow delivery
    }

    return Math.max(0, Math.min(100, Math.round(score)));
  }

  /**
   * Calculate quality performance score
   */
  static calculateQualityScore(metrics: {
    totalOrders: number;
    defectiveItems: number;
    returnedItems: number;
  }): number {
    if (metrics.totalOrders === 0) return 100; // Perfect score if no orders

    const defectRate = (metrics.defectiveItems / metrics.totalOrders) * 100;
    const returnRate = (metrics.returnedItems / metrics.totalOrders) * 100;

    // Start with perfect score and subtract penalties
    let score = 100;
    score -= defectRate * 2; // Heavy penalty for defects
    score -= returnRate * 3; // Heavier penalty for returns

    return Math.max(0, Math.round(score));
  }

  /**
   * Calculate service performance score
   */
  static calculateServiceScore(metrics: {
    averageResponseTime: number;
  }): number {
    // Target response time is 24 hours (1 day)
    const targetResponseTime = 1;

    if (metrics.averageResponseTime <= targetResponseTime) {
      return 100;
    } else if (metrics.averageResponseTime <= 3) {
      return 90;
    } else if (metrics.averageResponseTime <= 5) {
      return 80;
    } else if (metrics.averageResponseTime <= 7) {
      return 70;
    } else {
      return Math.max(50, 70 - (metrics.averageResponseTime - 7) * 5);
    }
  }

  /**
   * Calculate overall performance score
   */
  static calculateOverallScore(
    deliveryScore: number,
    qualityScore: number,
    priceScore: number,
    serviceScore: number,
    complianceScore: number,
    weights: {
      delivery?: number;
      quality?: number;
      price?: number;
      service?: number;
      compliance?: number;
    } = {}
  ): number {
    const defaultWeights = {
      delivery: 0.3,
      quality: 0.3,
      price: 0.2,
      service: 0.1,
      compliance: 0.1
    };

    const finalWeights = { ...defaultWeights, ...weights };

    const weightedScore =
      deliveryScore * finalWeights.delivery! +
      qualityScore * finalWeights.quality! +
      priceScore * finalWeights.price! +
      serviceScore * finalWeights.service! +
      complianceScore * finalWeights.compliance!;

    return Math.round(weightedScore);
  }

  /**
   * Identify performance improvement areas
   */
  static identifyImprovementAreas(performance: SupplierPerformance): Array<{
    area: string;
    currentScore: number;
    targetScore: number;
    priority: 'high' | 'medium' | 'low';
    impact: string;
  }> {
    const areas = [];
    const threshold = 80; // Scores below this need improvement

    if (performance.deliveryScore < threshold) {
      areas.push({
        area: 'Delivery Performance',
        currentScore: performance.deliveryScore,
        targetScore: 90,
        priority: performance.deliveryScore < 70 ? 'high' as const : 'medium' as const,
        impact: 'Improve on-time delivery and reduce lead times'
      });
    }

    if (performance.qualityScore < threshold) {
      areas.push({
        area: 'Quality Control',
        currentScore: performance.qualityScore,
        targetScore: 95,
        priority: performance.qualityScore < 70 ? 'high' as const : 'medium' as const,
        impact: 'Reduce defects and returns to improve customer satisfaction'
      });
    }

    if (performance.priceScore < threshold) {
      areas.push({
        area: 'Price Competitiveness',
        currentScore: performance.priceScore,
        targetScore: 85,
        priority: 'low' as const,
        impact: 'Review pricing to improve cost effectiveness'
      });
    }

    if (performance.serviceScore < threshold) {
      areas.push({
        area: 'Customer Service',
        currentScore: performance.serviceScore,
        targetScore: 90,
        priority: performance.serviceScore < 60 ? 'high' as const : 'medium' as const,
        impact: 'Improve response times and communication quality'
      });
    }

    return areas;
  }
}

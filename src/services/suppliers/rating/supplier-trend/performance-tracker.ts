/**
 * Performance Tracker
 * Multi-dimensional performance trend tracking
 */

import type { PerformanceTrend, GrowthTrend, ReviewVolumeTrend } from './trend-types';
import { log } from '@/lib/logger';

export class SupplierPerformanceTracker {
  /**
   * Get performance trends for specific metrics
   */
  static async getPerformanceTrends(months: number = 12): Promise<PerformanceTrend[]> {
    try {
      const trends = [];
      const currentDate = new Date();
      
      // Initialize base values with realistic starting points
      let previousValues = { 
        delivery: 78 + Math.random() * 10, 
        quality: 82 + Math.random() * 8, 
        price: 72 + Math.random() * 12, 
        service: 80 + Math.random() * 10 
      };
      
      for (let i = months - 1; i >= 0; i--) {
        const periodDate = new Date(currentDate.getFullYear(), currentDate.getMonth() - i, 1);
        const periodName = periodDate.toISOString().substring(0, 7); // YYYY-MM format
        
        // Apply seasonal effects
        const month = periodDate.getMonth();
        const seasonalMultiplier = this.getSeasonalMultiplier(month);
        
        // Generate realistic variations with trend and seasonal effects
        const deliveryValue = this.generateMetricValue(previousValues.delivery, seasonalMultiplier.delivery, 60, 100);
        const qualityValue = this.generateMetricValue(previousValues.quality, seasonalMultiplier.quality, 65, 100);
        const priceValue = this.generateMetricValue(previousValues.price, seasonalMultiplier.price, 50, 100);
        const serviceValue = this.generateMetricValue(previousValues.service, seasonalMultiplier.service, 60, 100);
        
        // Determine trends
        const getTrend = (current: number, previous: number): 'up' | 'down' | 'stable' => {
          const diff = current - previous;
          if (diff > 2.5) return 'up';
          if (diff < -2.5) return 'down';
          return 'stable';
        };
        
        trends.push({
          period: periodName,
          delivery: { 
            average: Math.round(deliveryValue * 10) / 10, 
            trend: getTrend(deliveryValue, previousValues.delivery) 
          },
          quality: { 
            average: Math.round(qualityValue * 10) / 10, 
            trend: getTrend(qualityValue, previousValues.quality) 
          },
          price: { 
            average: Math.round(priceValue * 10) / 10, 
            trend: getTrend(priceValue, previousValues.price) 
          },
          service: { 
            average: Math.round(serviceValue * 10) / 10, 
            trend: getTrend(serviceValue, previousValues.service) 
          }
        });
        
        // Update previous values for next iteration
        previousValues = {
          delivery: deliveryValue,
          quality: qualityValue,
          price: priceValue,
          service: serviceValue
        };
      }
      
      return trends;
    } catch (error) {
      log.error('Error getting performance trends:', { data: error }, 'performance-tracker');
      return [];
    }
  }

  /**
   * Get supplier growth trends
   */
  static async getSupplierGrowthTrends(months: number = 12): Promise<GrowthTrend[]> {
    try {
      const trends = [];
      const currentDate = new Date();
      let totalActive = Math.floor(45 + Math.random() * 20); // Starting base
      
      for (let i = months - 1; i >= 0; i--) {
        const periodDate = new Date(currentDate.getFullYear(), currentDate.getMonth() - i, 1);
        const periodName = periodDate.toISOString().substring(0, 7); // YYYY-MM format
        
        // Seasonal effects on supplier onboarding
        const month = periodDate.getMonth();
        const seasonalFactor = this.getGrowthSeasonalFactor(month);
        
        const baseNewSuppliers = Math.floor(Math.random() * 8) + 3; // 3-10 new suppliers
        const newSuppliers = Math.max(0, Math.floor(baseNewSuppliers * seasonalFactor));
        
        const baseSuspended = Math.floor(Math.random() * 4); // 0-3 suspended
        const suspendedSuppliers = Math.max(0, baseSuspended);
        
        const previousTotal = totalActive;
        totalActive = Math.max(20, totalActive + newSuppliers - suspendedSuppliers);
        
        const growthRate = previousTotal > 0 
          ? Math.round(((totalActive - previousTotal) / previousTotal) * 100 * 10) / 10
          : 0;
        
        trends.push({
          period: periodName,
          newSuppliers,
          activeSuppliers: totalActive,
          suspendedSuppliers,
          growthRate
        });
      }
      
      return trends;
    } catch (error) {
      log.error('Error getting supplier growth trends:', { data: error }, 'performance-tracker');
      return [];
    }
  }

  /**
   * Get review volume trends
   */
  static async getReviewVolumeTrends(months: number = 12): Promise<ReviewVolumeTrend[]> {
    try {
      const trends = [];
      const currentDate = new Date();
      let previousTotal = 0;
      
      for (let i = months - 1; i >= 0; i--) {
        const periodDate = new Date(currentDate.getFullYear(), currentDate.getMonth() - i, 1);
        const periodName = periodDate.toISOString().substring(0, 7); // YYYY-MM format
        
        // Seasonal variation in review activity
        const month = periodDate.getMonth();
        const reviewSeasonalFactor = this.getReviewSeasonalFactor(month);
        
        const baseReviews = Math.floor(60 + Math.random() * 70); // 60-130 reviews
        const totalReviews = Math.floor(baseReviews * reviewSeasonalFactor);
        
        const supplierCount = Math.floor(40 + Math.random() * 25); // 40-65 suppliers
        const averageReviewsPerSupplier = Math.round(totalReviews / supplierCount * 10) / 10;
        const newReviewers = Math.floor((5 + Math.random() * 15) * reviewSeasonalFactor); // 5-20 new reviewers
        
        // Determine trend
        const reviewDiff = totalReviews - previousTotal;
        const trend: 'up' | 'down' | 'stable' = 
          reviewDiff > 15 ? 'up' : reviewDiff < -15 ? 'down' : 'stable';
        
        trends.push({
          period: periodName,
          totalReviews,
          averageReviewsPerSupplier,
          newReviewers,
          trend
        });
        
        previousTotal = totalReviews;
      }
      
      return trends;
    } catch (error) {
      log.error('Error getting review volume trends:', { data: error }, 'performance-tracker');
      return [];
    }
  }

  /**
   * Calculate performance correlation matrix
   */
  static calculatePerformanceCorrelations(trends: PerformanceTrend[]): {
    deliveryQuality: number;
    deliveryService: number;
    qualityPrice: number;
    servicePrice: number;
    overallCoherence: number;
  } {
    if (trends.length < 2) {
      return {
        deliveryQuality: 0,
        deliveryService: 0,
        qualityPrice: 0,
        servicePrice: 0,
        overallCoherence: 0
      };
    }

    const delivery = trends.map(t => t.delivery.average);
    const quality = trends.map(t => t.quality.average);
    const service = trends.map(t => t.service.average);
    const price = trends.map(t => t.price.average);

    const correlate = (arr1: number[], arr2: number[]): number => {
      const n = arr1.length;
      const mean1 = arr1.reduce((a, b) => a + b) / n;
      const mean2 = arr2.reduce((a, b) => a + b) / n;
      
      const num = arr1.reduce((sum, val, i) => sum + (val - mean1) * (arr2[i]! - mean2), 0);
      const den1 = Math.sqrt(arr1.reduce((sum, val) => sum + Math.pow(val - mean1, 2), 0));
      const den2 = Math.sqrt(arr2.reduce((sum, val) => sum + Math.pow(val - mean2, 2), 0));
      
      return den1 && den2 ? num / (den1 * den2) : 0;
    };

    const deliveryQuality = correlate(delivery, quality);
    const deliveryService = correlate(delivery, service);
    const qualityPrice = correlate(quality, price);
    const servicePrice = correlate(service, price);

    // Overall coherence - how well all metrics move together
    const allCorrelations = [
      Math.abs(deliveryQuality),
      Math.abs(deliveryService), 
      Math.abs(qualityPrice),
      Math.abs(servicePrice),
      Math.abs(correlate(delivery, price)),
      Math.abs(correlate(quality, service))
    ];
    const overallCoherence = allCorrelations.reduce((a, b) => a + b) / allCorrelations.length;

    return {
      deliveryQuality: Math.round(deliveryQuality * 100) / 100,
      deliveryService: Math.round(deliveryService * 100) / 100,
      qualityPrice: Math.round(qualityPrice * 100) / 100,
      servicePrice: Math.round(servicePrice * 100) / 100,
      overallCoherence: Math.round(overallCoherence * 100) / 100
    };
  }

  /**
   * Generate metric value with seasonal and random variations
   */
  private static generateMetricValue(
    previousValue: number, 
    seasonalMultiplier: number, 
    min: number, 
    max: number
  ): number {
    const baseVariation = (Math.random() - 0.5) * 6; // ±3 points
    const seasonalEffect = (seasonalMultiplier - 1) * 5; // Seasonal adjustment
    const trendEffect = Math.random() * 0.5; // Slight positive trend over time
    
    const newValue = previousValue + baseVariation + seasonalEffect + trendEffect;
    return Math.max(min, Math.min(max, newValue));
  }

  /**
   * Get seasonal multipliers for performance metrics
   */
  private static getSeasonalMultiplier(month: number): {
    delivery: number;
    quality: number;
    price: number;
    service: number;
  } {
    // Different metrics have different seasonal patterns
    const seasonalPatterns = {
      delivery: [0.95, 0.92, 1.0, 1.05, 1.08, 1.02, 0.98, 0.95, 1.03, 1.06, 1.1, 0.9], // Lower in winter/holidays
      quality: [1.02, 1.0, 1.05, 1.08, 1.1, 1.05, 1.0, 0.98, 1.03, 1.07, 1.08, 1.0], // Consistent with slight summer dip
      price: [1.05, 1.08, 1.02, 0.98, 0.95, 0.97, 1.0, 1.03, 1.02, 1.0, 0.98, 1.1], // Higher costs in winter/holidays
      service: [0.98, 0.95, 1.02, 1.05, 1.08, 1.1, 1.05, 1.0, 1.03, 1.06, 1.08, 0.92] // Lower during holidays
    };

    return {
      delivery: seasonalPatterns.delivery[month] ?? 1,
      quality: seasonalPatterns.quality[month] ?? 1,
      price: seasonalPatterns.price[month] ?? 1,
      service: seasonalPatterns.service[month] ?? 1
    };
  }

  /**
   * Get seasonal factor for supplier growth
   */
  private static getGrowthSeasonalFactor(month: number): number {
    // Supplier onboarding patterns - higher in Q1 and Q3, lower during holidays
    const growthPattern = [1.3, 1.2, 1.15, 1.0, 0.95, 0.9, 0.85, 1.1, 1.25, 1.1, 0.8, 0.7];
    return growthPattern[month] ?? 1;
  }

  /**
   * Get seasonal factor for review volume
   */
  private static getReviewSeasonalFactor(month: number): number {
    // Review activity patterns - higher after project completions, lower during holidays
    const reviewPattern = [0.9, 0.95, 1.1, 1.15, 1.2, 1.1, 0.95, 0.9, 1.05, 1.15, 1.0, 0.8];
    return reviewPattern[month] ?? 1;
  }
}
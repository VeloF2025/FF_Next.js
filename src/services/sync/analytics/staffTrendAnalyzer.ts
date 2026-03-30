/**
 * Staff Trend Analyzer
 * Analyzes performance trends and patterns for staff members
 */

import { analyticsApi } from '@/services/api/analyticsApi';
import { log } from '@/lib/logger';

// PARTIAL: Drizzle ORM stubs — staffPerformance table not yet migrated to drizzle
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const neonDb: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const staffPerformance: any = {};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const eq: any = () => {};

/**
 * Staff performance trend analysis service
 */
export class StaffTrendAnalyzer {
  /**
   * Get staff performance trends over time
   */
  static async getPerformanceTrends(staffId: string, months: number = 6): Promise<{
    productivityTrend: 'improving' | 'stable' | 'declining';
    qualityTrend: 'improving' | 'stable' | 'declining';
    attendanceTrend: 'improving' | 'stable' | 'declining';
    overallTrend: 'positive' | 'neutral' | 'concerning';
  }> {
    try {
      // Get historical performance data from API
      const performance = await analyticsApi.getStaffPerformance(staffId, {
        type: 'monthly'
      });
      
      const records = performance.history || [];

      if (records.length < 2) {
        return this.getDefaultTrends();
      }

      const recent = records.slice(-Math.min(months, records.length));
      const trends = this.calculateTrends(recent);

      return trends;
    } catch (error) {
      log.error('Failed to get performance trends:', { data: error }, 'staffTrendAnalyzer');
      return this.getDefaultTrends();
    }
  }

  /**
   * Calculate trend patterns from historical data
   */
  private static calculateTrends(records: any[]): {
    productivityTrend: 'improving' | 'stable' | 'declining';
    qualityTrend: 'improving' | 'stable' | 'declining';
    attendanceTrend: 'improving' | 'stable' | 'declining';
    overallTrend: 'positive' | 'neutral' | 'concerning';
  } {
    const first = records[0];
    const last = records[records.length - 1];

    // Calculate trends
    const productivityChange = parseFloat(last.productivityScore) - parseFloat(first.productivityScore);
    const qualityChange = parseFloat(last.qualityScore) - parseFloat(first.qualityScore);
    const attendanceChange = parseFloat(last.attendanceRate) - parseFloat(first.attendanceRate);

    const productivityTrend = this.getTrendDirection(productivityChange);
    const qualityTrend = this.getTrendDirection(qualityChange);
    const attendanceTrend = this.getTrendDirection(attendanceChange);

    // Overall trend calculation
    const improvingCount = [productivityTrend, qualityTrend, attendanceTrend]
      .filter(trend => trend === 'improving').length;
    const decliningCount = [productivityTrend, qualityTrend, attendanceTrend]
      .filter(trend => trend === 'declining').length;

    let overallTrend: 'positive' | 'neutral' | 'concerning' = 'neutral';
    if (improvingCount >= 2) overallTrend = 'positive';
    else if (decliningCount >= 2) overallTrend = 'concerning';

    return {
      productivityTrend,
      qualityTrend,
      attendanceTrend,
      overallTrend
    };
  }

  /**
   * Determine trend direction from numeric change
   */
  private static getTrendDirection(change: number): 'improving' | 'stable' | 'declining' {
    if (change > 5) return 'improving';
    if (change < -5) return 'declining';
    return 'stable';
  }

  /**
   * Get default trends when insufficient data
   */
  private static getDefaultTrends() {
    return {
      productivityTrend: 'stable' as const,
      qualityTrend: 'stable' as const,
      attendanceTrend: 'stable' as const,
      overallTrend: 'neutral' as const
    };
  }

  /**
   * Get performance volatility score (0-100, lower is better)
   */
  static async getPerformanceVolatility(staffId: string, months: number = 6): Promise<number> {
    try {
      const records = await neonDb
        .select()
        .from(staffPerformance)
        .where(eq(staffPerformance.staffId, staffId))
        .orderBy(staffPerformance.periodStart);

      if (records.length < 3) return 0;

      const recent = records.slice(-Math.min(months, records.length));
      
      // Calculate standard deviation of productivity scores
      const productivityScores = recent.map((r: any) => parseFloat(r.productivity || '0.75'));
      const mean = productivityScores.reduce((sum: number, score: number) => sum + score, 0) / productivityScores.length;
      const variance = productivityScores.reduce((sum: number, score: number) => sum + Math.pow(score - mean, 2), 0) / productivityScores.length;
      const standardDeviation = Math.sqrt(variance);
      
      // Convert to 0-100 scale (higher std dev = higher volatility)
      return Math.min(100, Math.round(standardDeviation * 2));
    } catch (error) {
      log.error('Failed to calculate performance volatility:', { data: error }, 'staffTrendAnalyzer');
      return 0;
    }
  }

  /**
   * Predict next month's performance based on trends
   */
  static async predictNextMonthPerformance(staffId: string): Promise<{
    predictedProductivity: number;
    predictedQuality: number;
    predictedAttendance: number;
    confidence: number;
  }> {
    try {
      const records = await neonDb
        .select()
        .from(staffPerformance)
        .where(eq(staffPerformance.staffId, staffId))
        .orderBy(staffPerformance.periodStart);

      if (records.length < 2) {
        return {
          predictedProductivity: 75,
          predictedQuality: 80,
          predictedAttendance: 95,
          confidence: 0
        };
      }

      // Simple linear trend prediction
      const recent = records.slice(-3); // Use last 3 months
      const latest = recent[recent.length - 1];
      
      const productivityTrend = this.calculateSimpleTrend(recent.map((r: any) => parseFloat(r.productivity || '0.75') * 100));
      const qualityTrend = this.calculateSimpleTrend(recent.map((r: any) => parseFloat(r.qualityScore || '80')));
      const attendanceTrend = this.calculateSimpleTrend(recent.map(() => 95)); // Default attendance rate

      const predictedProductivity = Math.max(0, Math.min(100, parseFloat(latest.productivity || '0.75') * 100 + productivityTrend));
      const predictedQuality = Math.max(0, Math.min(100, parseFloat(latest.qualityScore || '80') + qualityTrend));
      const predictedAttendance = Math.max(0, Math.min(100, 95 + attendanceTrend));

      // Confidence based on data consistency and recency
      const confidence = Math.min(100, (records.length * 10) + (recent.length * 15));

      return {
        predictedProductivity: Math.round(predictedProductivity),
        predictedQuality: Math.round(predictedQuality),
        predictedAttendance: Math.round(predictedAttendance),
        confidence
      };
    } catch (error) {
      log.error('Failed to predict next month performance:', { data: error }, 'staffTrendAnalyzer');
      return {
        predictedProductivity: 75,
        predictedQuality: 80,
        predictedAttendance: 95,
        confidence: 0
      };
    }
  }

  /**
   * Calculate simple linear trend from array of values
   */
  private static calculateSimpleTrend(values: number[]): number {
    if (values.length < 2) return 0;
    
    const first = values[0]!;
    const last = values[values.length - 1]!;
    const periods = values.length - 1;

    return (last - first) / periods;
  }
}
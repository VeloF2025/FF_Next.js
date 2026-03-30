/**
 * Staff Performance Synchronization - Core Service
 * Handles syncing staff performance data from Firebase to Neon analytics
 */

import { StaffSyncCore } from './core/staffSyncCore';
import { StaffMetricsCalculator } from './analytics/staffMetricsCalculator';
import { StaffTrendAnalyzer } from './analytics/staffTrendAnalyzer';
import { TeamAnalyticsService } from './analytics/teamAnalyticsService';
import type { SyncResult, FirebaseStaffData } from './types';

/**
 * Staff performance synchronization service
 */
export class StaffSync {
  /**
   * Sync all staff performance data from Firebase to Neon
   */
  static async syncAllStaff(): Promise<SyncResult> {
    return StaffSyncCore.syncAllStaff();
  }

  /**
   * Sync a single staff member's performance data
   */
  static async syncSingleStaffMember(staffId: string, staffData: FirebaseStaffData): Promise<void> {
    return StaffSyncCore.syncSingleStaffMember(staffId, staffData);
  }

  /**
   * Calculate comprehensive staff performance metrics
   */
  static calculateStaffMetrics(staffData: FirebaseStaffData): {
    efficiencyRating: number;
    reliabilityScore: number;
    performanceGrade: string;
    improvementAreas: string[];
  } {
    return StaffMetricsCalculator.calculateStaffMetrics(staffData);
  }

  /**
   * Get staff performance trends
   */
  static async getPerformanceTrends(staffId: string, months: number = 6): Promise<{
    productivityTrend: 'improving' | 'stable' | 'declining';
    qualityTrend: 'improving' | 'stable' | 'declining';
    attendanceTrend: 'improving' | 'stable' | 'declining';
    overallTrend: 'positive' | 'neutral' | 'concerning';
  }> {
    return StaffTrendAnalyzer.getPerformanceTrends(staffId, months);
  }

  /**
   * Calculate team performance summary
   */
  static async getTeamPerformanceSummary(): Promise<{
    totalStaff: number;
    averageProductivity: number;
    averageQuality: number;
    averageAttendance: number;
    topPerformers: string[];
    improvementNeeded: string[];
  }> {
    return TeamAnalyticsService.getTeamPerformanceSummary();
  }

  /**
   * Get staff sync statistics
   */
  static async getSyncStatistics(): Promise<{
    totalStaff: number;
    lastSyncTime: Date | null;
    avgSyncTime: number;
  }> {
    return StaffSyncCore.getSyncStatistics();
  }
}
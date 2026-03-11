/**
 * Team Analytics Service
 * Provides team-wide performance analytics and insights
 */

import { analyticsApi } from '@/services/api/analyticsApi';
import { log } from '@/lib/logger';
import { formatDisplayMonthYear } from '@/utils/dateFormat';

// PARTIAL: Drizzle ORM stubs — staffPerformance table not yet migrated to drizzle
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const neonDb: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const staffPerformance: any = {};

/**
 * Team performance analytics service
 */
export class TeamAnalyticsService {
  /**
   * Calculate comprehensive team performance summary
   */
  static async getTeamPerformanceSummary(): Promise<{
    totalStaff: number;
    averageProductivity: number;
    averageQuality: number;
    averageAttendance: number;
    topPerformers: string[];
    improvementNeeded: string[];
  }> {
    try {
      // Get team analytics from API
      const teamData = await analyticsApi.getTeamAnalytics();
      const teams = teamData.teams || [];
      
      // Aggregate data from all teams
      let totalStaff = 0;
      let totalProductivity = 0;
      let totalQuality = 0;
      const topPerformers: string[] = [];
      const improvementNeeded: string[] = [];
      
      teams.forEach((team: any) => {
        totalStaff += team.size;
        totalProductivity += team.performance.avgProductivity * team.size;
        totalQuality += team.performance.avgQuality * team.size;
        
        // Find top performers from team members
        team.members?.forEach((member: any) => {
          if (member.performance.productivity >= 90) {
            topPerformers.push(member.name);
          }
          if (member.performance.productivity < 60) {
            improvementNeeded.push(member.name);
          }
        });
      });

      const latestPeriodRecords = this.filterLatestPeriodRecords(teams);

      if (latestPeriodRecords.length === 0) {
        return this.getEmptyTeamSummary();
      }

      return this.calculateTeamMetrics(latestPeriodRecords);
    } catch (error) {
      log.error('Failed to get team performance summary:', { data: error }, 'teamAnalyticsService');
      return this.getEmptyTeamSummary();
    }
  }

  /**
   * Filter records to get latest period data
   */
  private static filterLatestPeriodRecords(records: any[]): any[] {
    const now = new Date();
    const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    
    return records.filter(record => {
      const recordDate = new Date(record.periodStart);
      return recordDate >= currentMonth;
    });
  }

  /**
   * Calculate team metrics from current period records
   */
  private static calculateTeamMetrics(records: any[]): {
    totalStaff: number;
    averageProductivity: number;
    averageQuality: number;
    averageAttendance: number;
    topPerformers: string[];
    improvementNeeded: string[];
  } {
    const totalStaff = records.length;
    
    const averageProductivity = records.reduce((sum, r) => 
      sum + parseFloat(r.productivityScore), 0) / totalStaff;
    const averageQuality = records.reduce((sum, r) => 
      sum + parseFloat(r.qualityScore), 0) / totalStaff;
    const averageAttendance = records.reduce((sum, r) => 
      sum + parseFloat(r.attendanceRate), 0) / totalStaff;

    // Identify top performers and improvement needed
    const topPerformers = records
      .filter(r => parseFloat(r.productivityScore) >= 85 && parseFloat(r.qualityScore) >= 85)
      .map(r => r.staffName)
      .slice(0, 5);

    const improvementNeeded = records
      .filter(r => parseFloat(r.productivityScore) < 70 || parseFloat(r.qualityScore) < 75)
      .map(r => r.staffName);

    return {
      totalStaff,
      averageProductivity: Math.round(averageProductivity * 10) / 10,
      averageQuality: Math.round(averageQuality * 10) / 10,
      averageAttendance: Math.round(averageAttendance * 10) / 10,
      topPerformers,
      improvementNeeded
    };
  }

  /**
   * Get empty team summary for error cases
   */
  private static getEmptyTeamSummary() {
    return {
      totalStaff: 0,
      averageProductivity: 0,
      averageQuality: 0,
      averageAttendance: 0,
      topPerformers: [],
      improvementNeeded: []
    };
  }

  /**
   * Get team performance distribution
   */
  static async getPerformanceDistribution(): Promise<{
    excellent: number;  // 90-100%
    good: number;       // 80-89%
    average: number;    // 70-79%
    belowAverage: number; // <70%
  }> {
    try {
      const records = await neonDb
        .select()
        .from(staffPerformance);

      const latestRecords = this.filterLatestPeriodRecords(records);

      if (latestRecords.length === 0) {
        return { excellent: 0, good: 0, average: 0, belowAverage: 0 };
      }

      const distribution = latestRecords.reduce((dist, record) => {
        const productivity = parseFloat(record.productivityScore);
        if (productivity >= 90) dist.excellent++;
        else if (productivity >= 80) dist.good++;
        else if (productivity >= 70) dist.average++;
        else dist.belowAverage++;
        return dist;
      }, { excellent: 0, good: 0, average: 0, belowAverage: 0 });

      return distribution;
    } catch (error) {
      log.error('Failed to get performance distribution:', { data: error }, 'teamAnalyticsService');
      return { excellent: 0, good: 0, average: 0, belowAverage: 0 };
    }
  }

  /**
   * Get department performance comparison
   */
  static async getDepartmentComparison(): Promise<{
    department: string;
    averageProductivity: number;
    averageQuality: number;
    staffCount: number;
  }[]> {
    try {
      const records = await neonDb
        .select()
        .from(staffPerformance);

      const latestRecords = this.filterLatestPeriodRecords(records);

      // Group by role (department)
      const departmentGroups = latestRecords.reduce((groups, record) => {
        const dept = record.role || 'Unknown';
        if (!groups[dept]) {
          groups[dept] = [];
        }
        groups[dept].push(record);
        return groups;
      }, {} as Record<string, any[]>);

      return Object.entries(departmentGroups).map(([department, records]) => {
        const typedRecords = records as any[];
        return {
          department,
          averageProductivity: Math.round(
            (typedRecords.reduce((sum: number, r: any) => sum + parseFloat(r.productivity || '0.75') * 100, 0) / typedRecords.length) * 10
          ) / 10,
          averageQuality: Math.round(
            (typedRecords.reduce((sum: number, r: any) => sum + parseFloat(r.qualityScore || '80'), 0) / typedRecords.length) * 10
          ) / 10,
          staffCount: typedRecords.length
        };
      });
    } catch (error) {
      log.error('Failed to get department comparison:', { data: error }, 'teamAnalyticsService');
      return [];
    }
  }

  /**
   * Get team performance trends over time
   */
  static async getTeamTrends(months: number = 6): Promise<{
    month: string;
    averageProductivity: number;
    averageQuality: number;
    averageAttendance: number;
  }[]> {
    try {
      const records = await neonDb
        .select()
        .from(staffPerformance)
        .orderBy(staffPerformance.periodStart);

      // Group by month
      const monthlyData = records.reduce((groups: Record<string, any[]>, record: any) => {
        const monthKey = new Date(record.periodStart).toISOString().substring(0, 7); // YYYY-MM
        if (!groups[monthKey]) {
          groups[monthKey] = [];
        }
        groups[monthKey].push(record);
        return groups;
      }, {} as Record<string, any[]>);

      // Calculate monthly averages
      const trends = Object.entries(monthlyData)
        .sort(([a], [b]) => a.localeCompare(b))
        .slice(-months)
        .map(([month, recs]) => ({
          month: formatDisplayMonthYear(month + '-01'),
          averageProductivity: Math.round(
            ((recs as any[]).reduce((sum: number, r: any) => sum + parseFloat(r.productivityScore), 0) / (recs as any[]).length) * 10
          ) / 10,
          averageQuality: Math.round(
            ((recs as any[]).reduce((sum: number, r: any) => sum + parseFloat(r.qualityScore), 0) / (recs as any[]).length) * 10
          ) / 10,
          averageAttendance: Math.round(
            ((recs as any[]).reduce((sum: number, r: any) => sum + parseFloat(r.attendanceRate), 0) / (recs as any[]).length) * 10
          ) / 10
        }));

      return trends;
    } catch (error) {
      log.error('Failed to get team trends:', { data: error }, 'teamAnalyticsService');
      return [];
    }
  }
}
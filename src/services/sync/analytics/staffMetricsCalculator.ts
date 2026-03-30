/**
 * Staff Metrics Calculator
 * Calculates performance metrics and ratings for staff members
 */

import type { FirebaseStaffData } from '../types';

/**
 * Staff performance metrics calculation service
 */
export class StaffMetricsCalculator {
  /**
   * Calculate comprehensive staff performance metrics
   */
  static calculateStaffMetrics(staffData: FirebaseStaffData): {
    efficiencyRating: number;
    reliabilityScore: number;
    performanceGrade: string;
    improvementAreas: string[];
  } {
    const productivity = staffData.productivityScore || 75;
    const quality = staffData.qualityScore || 80;
    const attendance = staffData.attendanceRate || 95;
    const incidents = staffData.monthlyIncidents || 0;

    // Efficiency rating (weighted average)
    const efficiencyRating = Math.round(
      (productivity * 0.4) + (quality * 0.3) + (attendance * 0.3)
    );

    // Reliability score (attendance - incident penalty)
    const reliabilityScore = Math.max(0, attendance - (incidents * 10));

    // Performance grade
    const performanceGrade = this.calculatePerformanceGrade(efficiencyRating, reliabilityScore);

    // Improvement areas
    const improvementAreas = this.identifyImprovementAreas(productivity, quality, attendance, incidents);

    return {
      efficiencyRating,
      reliabilityScore,
      performanceGrade,
      improvementAreas
    };
  }

  /**
   * Calculate performance grade based on efficiency and reliability
   */
  private static calculatePerformanceGrade(efficiencyRating: number, reliabilityScore: number): string {
    if (efficiencyRating >= 90 && reliabilityScore >= 90) {
      return 'A+';
    } else if (efficiencyRating >= 85) {
      return 'A';
    } else if (efficiencyRating >= 80) {
      return 'B+';
    } else if (efficiencyRating >= 75) {
      return 'B';
    } else if (efficiencyRating >= 70) {
      return 'B-';
    }
    return 'C';
  }

  /**
   * Identify areas needing improvement
   */
  private static identifyImprovementAreas(
    productivity: number, 
    quality: number, 
    attendance: number, 
    incidents: number
  ): string[] {
    const improvementAreas: string[] = [];
    
    if (productivity < 70) improvementAreas.push('Productivity');
    if (quality < 75) improvementAreas.push('Quality');
    if (attendance < 90) improvementAreas.push('Attendance');
    if (incidents > 2) improvementAreas.push('Safety/Incidents');

    return improvementAreas;
  }

  /**
   * Calculate overall performance score (0-100)
   */
  static calculateOverallScore(staffData: FirebaseStaffData): number {
    const metrics = this.calculateStaffMetrics(staffData);
    return Math.round((metrics.efficiencyRating + metrics.reliabilityScore) / 2);
  }

  /**
   * Calculate performance percentile compared to team average
   */
  static calculatePerformancePercentile(
    staffScore: number, 
    teamScores: number[]
  ): number {
    if (teamScores.length === 0) return 50;
    
    const lowerScores = teamScores.filter(score => score < staffScore).length;
    return Math.round((lowerScores / teamScores.length) * 100);
  }

  /**
   * Generate performance insights and recommendations
   */
  static generatePerformanceInsights(staffData: FirebaseStaffData): {
    strengths: string[];
    recommendations: string[];
    riskLevel: 'low' | 'medium' | 'high';
  } {
    const metrics = this.calculateStaffMetrics(staffData);
    const strengths: string[] = [];
    const recommendations: string[] = [];
    
    // Identify strengths
    if ((staffData.productivityScore || 75) >= 85) strengths.push('High productivity');
    if ((staffData.qualityScore || 80) >= 85) strengths.push('Excellent quality');
    if ((staffData.attendanceRate || 95) >= 95) strengths.push('Reliable attendance');
    if ((staffData.monthlyIncidents || 0) === 0) strengths.push('Safety conscious');

    // Generate recommendations
    metrics.improvementAreas.forEach(area => {
      switch (area) {
        case 'Productivity':
          recommendations.push('Consider productivity training or workflow optimization');
          break;
        case 'Quality':
          recommendations.push('Implement quality control measures and additional training');
          break;
        case 'Attendance':
          recommendations.push('Address attendance patterns through coaching');
          break;
        case 'Safety/Incidents':
          recommendations.push('Mandatory safety training and closer supervision required');
          break;
      }
    });

    // Determine risk level
    let riskLevel: 'low' | 'medium' | 'high' = 'low';
    if (metrics.improvementAreas.length >= 3 || metrics.efficiencyRating < 60) {
      riskLevel = 'high';
    } else if (metrics.improvementAreas.length >= 2 || metrics.efficiencyRating < 75) {
      riskLevel = 'medium';
    }

    return {
      strengths,
      recommendations,
      riskLevel
    };
  }
}
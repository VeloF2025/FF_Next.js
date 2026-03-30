/**
 * Client Metrics Calculator
 * Calculates comprehensive metrics for client analytics
 */

import { SyncUtils } from '../syncUtils';
import type { ClientMetrics, FirebaseClientData } from './types';

export class ClientMetricsCalculator {
  /**
   * Calculate comprehensive client metrics from projects
   */
  static calculateMetrics(projects: any[]): ClientMetrics {
    const totalProjects = projects.length;
    const activeProjects = projects.filter(p => p.status === 'active' || p.status === 'in_progress').length;
    const completedProjects = projects.filter(p => p.status === 'completed').length;
    
    // Financial calculations
    const totalRevenue = projects.reduce((sum, p) => sum + (p.budget || 0), 0);
    const averageProjectValue = totalProjects > 0 ? totalRevenue / totalProjects : 0;
    
    // Duration calculations
    const averageProjectDuration = this.calculateAverageDuration(projects);
    
    // On-time delivery calculations
    const onTimeProjects = projects.filter(p => this.calculateOnTimeDelivery(p)).length;
    const onTimeCompletionRate = totalProjects > 0 ? (onTimeProjects / totalProjects) * 100 : 0;

    // Last project date
    const lastProjectDate = this.getLastProjectDate(projects);

    // Lifetime value estimation
    const lifetimeValue = this.calculateLifetimeValue(totalRevenue, totalProjects, onTimeCompletionRate);

    return {
      totalProjects,
      activeProjects,
      completedProjects,
      totalRevenue,
      averageProjectValue,
      averageProjectDuration: Math.round(averageProjectDuration),
      onTimeCompletionRate: Math.round(onTimeCompletionRate * 100) / 100,
      lastProjectDate,
      lifetimeValue
    };
  }

  /**
   * Calculate average project duration
   */
  private static calculateAverageDuration(projects: any[]): number {
    const completedWithDates = projects.filter(p => 
      p.status === 'completed' && p.startDate && p.endDate
    );
    
    if (completedWithDates.length === 0) return 0;

    const totalDuration = completedWithDates.reduce((sum, p) => {
      const start = SyncUtils.parseFirebaseDate(p.startDate);
      const end = SyncUtils.parseFirebaseDate(p.endDate);
      if (start && end) {
        return sum + Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
      }
      return sum;
    }, 0);

    return totalDuration / completedWithDates.length;
  }

  /**
   * Get last project date
   */
  private static getLastProjectDate(projects: any[]): Date | null {
    const dates = projects
      .map(p => SyncUtils.parseFirebaseDate(p.createdAt))
      .filter(d => d)
      .sort((a, b) => b!.getTime() - a!.getTime());
    
    return dates[0] || null;
  }

  /**
   * Calculate on-time delivery for a project
   */
  static calculateOnTimeDelivery(project: any): boolean {
    const endDate = SyncUtils.parseFirebaseDate(project.endDate);
    const actualEndDate = SyncUtils.parseFirebaseDate(project.actualEndDate);
    
    if (!endDate || !actualEndDate) return false;
    return actualEndDate <= endDate;
  }

  /**
   * Calculate lifetime value
   */
  static calculateLifetimeValue(
    totalRevenue: number, 
    totalProjects: number, 
    onTimeRate: number
  ): number {
    // Base calculation: current revenue + potential multiplier
    let multiplier = 1.2; // Base 20% growth potential
    
    // Adjust multiplier based on performance
    if (onTimeRate > 95) multiplier += 0.3; // Excellent performance
    else if (onTimeRate > 85) multiplier += 0.2; // Good performance
    else if (onTimeRate < 70) multiplier -= 0.2; // Poor performance
    
    // Adjust for project volume
    if (totalProjects > 10) multiplier += 0.1;
    else if (totalProjects < 3) multiplier -= 0.1;
    
    return Math.round(totalRevenue * multiplier);
  }

  /**
   * Calculate payment score based on client data
   */
  static calculatePaymentScore(clientData: FirebaseClientData): string {
    const balance = clientData.currentBalance || 0;
    const creditLimit = clientData.creditLimit || 1000;
    
    if (balance <= 0) return '100'; // No outstanding balance
    if (balance < creditLimit * 0.3) return '90'; // Low utilization
    if (balance < creditLimit * 0.7) return '70'; // Medium utilization
    return '40'; // High utilization
  }
}
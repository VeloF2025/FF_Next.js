/**
 * Client Classification Service
 * Handles client categorization and risk assessment
 */

import { SyncUtils } from '../syncUtils';
import type { 
  ClientMetrics, 
  FirebaseClientData, 
  ClientEngagementMetrics,
  ClientRiskAssessment 
} from './types';

export class ClientClassification {
  /**
   * Classify client based on metrics
   */
  static classifyClient(metrics: ClientMetrics): string {
    const { totalRevenue, totalProjects, onTimeCompletionRate } = metrics;
    
    if (totalRevenue > 1000000 && totalProjects > 10 && onTimeCompletionRate > 90) {
      return 'VIP';
    }
    if (totalRevenue > 500000 || totalProjects > 5) {
      return 'Premium';
    }
    if (onTimeCompletionRate < 70 || totalRevenue < 50000) {
      return 'At-Risk';
    }
    return 'Regular';
  }

  /**
   * Calculate client engagement metrics
   */
  static calculateEngagementMetrics(
    clientData: FirebaseClientData, 
    projects: any[]
  ): ClientEngagementMetrics {
    const totalInteractions = clientData.totalInteractions || 0;
    
    // Count recent projects (last 6 months)
    const recentProjects = projects.filter(p => {
      const projectDate = SyncUtils.parseFirebaseDate(p.createdAt);
      if (!projectDate) return false;
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
      return projectDate >= sixMonthsAgo;
    }).length;

    // Engagement score based on interactions and recent activity
    const engagementScore = Math.min(100, 
      (totalInteractions * 2) + (recentProjects * 10)
    );

    // Communication frequency (interactions per month)
    const communicationFrequency = totalInteractions / Math.max(1, projects.length);

    // Response rate (placeholder - would need actual response data)
    const responseRate = 85; // Default response rate

    return {
      engagementScore: Math.round(engagementScore),
      communicationFrequency: Math.round(communicationFrequency * 10) / 10,
      responseRate
    };
  }

  /**
   * Get client risk assessment
   */
  static assessClientRisk(
    metrics: ClientMetrics, 
    clientData: FirebaseClientData
  ): ClientRiskAssessment {
    const factors: string[] = [];
    let riskScore = 0;

    // Payment risk
    const balance = clientData.currentBalance || 0;
    const creditLimit = clientData.creditLimit || 1000;
    const utilizationRate = balance / creditLimit;
    
    if (utilizationRate > 0.8) {
      factors.push('High credit utilization');
      riskScore += 30;
    } else if (utilizationRate > 0.5) {
      factors.push('Medium credit utilization');
      riskScore += 15;
    }

    // Project performance risk
    if (metrics.onTimeCompletionRate < 70) {
      factors.push('Poor on-time completion rate');
      riskScore += 25;
    }

    // Engagement risk
    const daysSinceLastProject = metrics.lastProjectDate 
      ? Math.floor((Date.now() - metrics.lastProjectDate.getTime()) / (1000 * 60 * 60 * 24))
      : 365;
    
    if (daysSinceLastProject > 180) {
      factors.push('Long gap since last project');
      riskScore += 20;
    }

    // Revenue concentration risk
    if (metrics.totalProjects < 3 && metrics.totalRevenue > 100000) {
      factors.push('High revenue concentration');
      riskScore += 15;
    }

    // Determine risk level
    let riskLevel: 'low' | 'medium' | 'high';
    if (riskScore > 50) riskLevel = 'high';
    else if (riskScore > 25) riskLevel = 'medium';
    else riskLevel = 'low';

    return {
      riskLevel,
      riskFactors: factors,
      riskScore
    };
  }
}
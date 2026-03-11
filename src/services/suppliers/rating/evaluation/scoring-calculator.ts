/**
 * Scoring Calculator
 * Handles score calculations and performance metrics
 */

import { PerformancePeriod } from '@/types/supplier/base.types';
import { 
  EvaluationActionItem, 
  SupplierPerformanceMetrics,
  EvaluationCriteria,
  EvaluationThresholds
} from './evaluation-types';

/**
 * Calculator for supplier evaluation scores and performance metrics
 */
export class ScoringCalculator {
  /**
   * Generate recommendations based on performance scores
   */
  static generateRecommendations(performance: SupplierPerformanceMetrics): string[] {
    const recommendations: string[] = [];

    // Delivery performance recommendations
    if (performance.deliveryScore < 80) {
      recommendations.push('Improve delivery performance through better scheduling and logistics coordination');
      
      if (performance.onTimeDeliveryRate && performance.onTimeDeliveryRate < 85) {
        recommendations.push('Implement delivery tracking system to monitor and improve on-time delivery rates');
      }
    }

    // Quality recommendations
    if (performance.qualityScore < 90) {
      recommendations.push('Enhance quality control processes to reduce defects');
      
      if (performance.defectRate && performance.defectRate > 2) {
        recommendations.push('Establish stricter quality checkpoints and implement statistical process control');
      }
    }

    // Pricing recommendations
    if (performance.priceScore < 85) {
      recommendations.push('Review pricing competitiveness in the market');
      
      if (performance.costSavings && performance.costSavings < 0) {
        recommendations.push('Explore cost optimization opportunities and value engineering initiatives');
      }
    }

    // Service recommendations
    if (performance.serviceScore < 80) {
      recommendations.push('Improve customer service and communication responsiveness');
      
      if (performance.responseTime && performance.responseTime > 24) {
        recommendations.push('Establish service level agreements (SLAs) for response times and escalation procedures');
      }
    }

    // Compliance recommendations
    const performanceAny = performance as any;
    if (performanceAny.complianceScore && performanceAny.complianceScore < 95) {
      recommendations.push('Strengthen compliance processes and documentation');
      recommendations.push('Conduct regular compliance audits and corrective action follow-ups');
    }

    // Risk-based recommendations
    if (performance.riskScore && performance.riskScore > 70) {
      recommendations.push('Develop risk mitigation strategies and business continuity plans');
      recommendations.push('Consider supplier diversification to reduce dependency risk');
    }

    // Sustainability recommendations
    if (performance.sustainabilityScore && performance.sustainabilityScore < 75) {
      recommendations.push('Implement sustainable practices and environmental compliance measures');
      recommendations.push('Set sustainability targets and track progress against industry benchmarks');
    }

    // Innovation recommendations
    if (performance.innovationScore && performance.innovationScore < 70) {
      recommendations.push('Encourage innovation partnerships and collaborative development initiatives');
      recommendations.push('Invest in technology upgrades and process improvements');
    }

    return recommendations;
  }

  /**
   * Generate action items based on performance
   */
  static generateActionItems(
    performance: SupplierPerformanceMetrics,
    _supplierId: string
  ): EvaluationActionItem[] {
    const actionItems: EvaluationActionItem[] = [];
    const performanceAny = performance as any;

    // Delivery action items
    if (performance.deliveryScore < 80) {
      actionItems.push({
        priority: performance.deliveryScore < 60 ? 'critical' : 'high',
        description: 'Schedule meeting to discuss delivery improvement strategies',
        dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 1 week
        category: 'delivery',
        estimatedHours: 4,
        assignedTo: 'procurement-manager'
      });

      if (performance.onTimeDeliveryRate && performance.onTimeDeliveryRate < 80) {
        actionItems.push({
          priority: 'high',
          description: 'Implement delivery performance monitoring dashboard',
          dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // 2 weeks
          category: 'delivery',
          estimatedHours: 8,
          dependencies: ['IT-infrastructure-setup']
        });
      }
    }

    // Quality action items
    if (performance.qualityScore < 90) {
      actionItems.push({
        priority: performance.qualityScore < 70 ? 'critical' : 'medium',
        description: 'Request quality improvement plan from supplier',
        dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // 2 weeks
        category: 'quality',
        estimatedHours: 6,
        assignedTo: 'quality-manager'
      });

      if (performance.defectRate && performance.defectRate > 5) {
        actionItems.push({
          priority: 'critical',
          description: 'Conduct on-site quality audit and corrective action plan',
          dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 1 week
          category: 'quality',
          estimatedHours: 16
        });
      }
    }

    // Price action items
    if (performance.priceScore < 85) {
      actionItems.push({
        priority: 'low',
        description: 'Conduct market price analysis for key items',
        dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 1 month
        category: 'price',
        estimatedHours: 12,
        assignedTo: 'category-manager'
      });

      if (performance.costSavings && performance.costSavings < -10) {
        actionItems.push({
          priority: 'high',
          description: 'Negotiate cost reduction initiatives and value engineering',
          dueDate: new Date(Date.now() + 21 * 24 * 60 * 60 * 1000), // 3 weeks
          category: 'price',
          estimatedHours: 8
        });
      }
    }

    // Service action items
    if (performance.serviceScore < 80) {
      actionItems.push({
        priority: 'medium',
        description: 'Establish clear communication protocols and SLAs',
        dueDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000), // 10 days
        category: 'service',
        estimatedHours: 4,
        assignedTo: 'relationship-manager'
      });

      if (performance.responseTime && performance.responseTime > 48) {
        actionItems.push({
          priority: 'high',
          description: 'Implement escalation matrix and response time tracking',
          dueDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000), // 5 days
          category: 'service',
          estimatedHours: 6
        });
      }
    }

    // Compliance action items
    if (performanceAny.complianceScore && performanceAny.complianceScore < 95) {
      actionItems.push({
        priority: performanceAny.complianceScore < 85 ? 'critical' : 'high',
        description: 'Schedule compliance audit and documentation review',
        dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // 2 weeks
        category: 'compliance',
        estimatedHours: 12,
        assignedTo: 'compliance-officer'
      });
    }

    // Risk mitigation action items
    if (performance.riskScore && performance.riskScore > 70) {
      actionItems.push({
        priority: performance.riskScore > 85 ? 'critical' : 'high',
        description: 'Develop supplier risk mitigation and contingency plans',
        dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 1 month
        category: 'compliance',
        estimatedHours: 20,
        assignedTo: 'risk-manager'
      });
    }

    return actionItems.sort((a, b) => {
      const priorityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
      return priorityOrder[b.priority] - priorityOrder[a.priority];
    });
  }

  /**
   * Calculate weighted overall score based on criteria
   */
  static calculateWeightedScore(
    performance: SupplierPerformanceMetrics,
    criteria: EvaluationCriteria
  ): number {
    let weightedScore = 0;
    let totalWeight = 0;
    const performanceAny = performance as any;

    // Standard criteria
    weightedScore += performance.deliveryScore * criteria.deliveryWeight;
    weightedScore += performance.qualityScore * criteria.qualityWeight;
    weightedScore += performance.priceScore * criteria.priceWeight;
    weightedScore += performance.serviceScore * criteria.serviceWeight;
    
    totalWeight += criteria.deliveryWeight + criteria.qualityWeight + 
                   criteria.priceWeight + criteria.serviceWeight;

    // Optional criteria
    if (criteria.complianceWeight && performanceAny.complianceScore) {
      weightedScore += performanceAny.complianceScore * criteria.complianceWeight;
      totalWeight += criteria.complianceWeight;
    }

    if (criteria.sustainabilityWeight && performance.sustainabilityScore) {
      weightedScore += performance.sustainabilityScore * criteria.sustainabilityWeight;
      totalWeight += criteria.sustainabilityWeight;
    }

    // Custom criteria
    if (criteria.customCriteria) {
      criteria.customCriteria.forEach(custom => {
        // Would need to map custom criteria to performance metrics
        // For now, using a placeholder calculation
        weightedScore += performance.overallScore * custom.weight;
        totalWeight += custom.weight;
      });
    }

    return totalWeight > 0 ? Math.round(weightedScore / totalWeight) : 0;
  }

  /**
   * Categorize performance based on thresholds
   */
  static categorizePerformance(
    score: number,
    thresholds: EvaluationThresholds
  ): 'excellent' | 'good' | 'acceptable' | 'needs-improvement' | 'unacceptable' {
    if (score >= thresholds.excellent) return 'excellent';
    if (score >= thresholds.good) return 'good';
    if (score >= thresholds.acceptable) return 'acceptable';
    if (score >= thresholds.needsImprovement) return 'needs-improvement';
    return 'unacceptable';
  }

  /**
   * Calculate score improvement suggestions
   */
  static calculateImprovementPotential(
    currentPerformance: SupplierPerformanceMetrics,
    targetThreshold: number = 85
  ): Array<{
    metric: string;
    currentScore: number;
    targetScore: number;
    improvementNeeded: number;
    priority: 'high' | 'medium' | 'low';
    estimatedTimeframe: string;
  }> {
    const improvements: Array<{
      metric: string;
      currentScore: number;
      targetScore: number;
      improvementNeeded: number;
      priority: 'high' | 'medium' | 'low';
      estimatedTimeframe: string;
    }> = [];

    const metrics = [
      { name: 'delivery', score: currentPerformance.deliveryScore, timeframe: '3-6 months' },
      { name: 'quality', score: currentPerformance.qualityScore, timeframe: '2-4 months' },
      { name: 'price', score: currentPerformance.priceScore, timeframe: '6-12 months' },
      { name: 'service', score: currentPerformance.serviceScore, timeframe: '1-3 months' }
    ];

    metrics.forEach(metric => {
      if (metric.score < targetThreshold) {
        const improvementNeeded = targetThreshold - metric.score;
        let priority: 'high' | 'medium' | 'low' = 'medium';

        if (improvementNeeded > 20) priority = 'high';
        else if (improvementNeeded < 10) priority = 'low';

        improvements.push({
          metric: metric.name,
          currentScore: metric.score,
          targetScore: targetThreshold,
          improvementNeeded,
          priority,
          estimatedTimeframe: metric.timeframe
        });
      }
    });

    return improvements.sort((a, b) => b.improvementNeeded - a.improvementNeeded);
  }

  /**
   * Calculate performance trends
   */
  static calculateTrends(
    historicalPerformance: Array<{
      period: PerformancePeriod;
      scores: SupplierPerformanceMetrics;
      date: Date;
    }>
  ): {
    overall: 'improving' | 'declining' | 'stable';
    delivery: 'improving' | 'declining' | 'stable';
    quality: 'improving' | 'declining' | 'stable';
    price: 'improving' | 'declining' | 'stable';
    service: 'improving' | 'declining' | 'stable';
    trendStrength: number; // -1 to 1, negative is declining, positive is improving
  } {
    if (historicalPerformance.length < 2) {
      return {
        overall: 'stable',
        delivery: 'stable',
        quality: 'stable',
        price: 'stable',
        service: 'stable',
        trendStrength: 0
      };
    }

    const latest = historicalPerformance[historicalPerformance.length - 1]!;
    const previous = historicalPerformance[historicalPerformance.length - 2]!;

    const calculateTrend = (current: number, prev: number): 'improving' | 'declining' | 'stable' => {
      const diff = current - prev;
      if (Math.abs(diff) < 2) return 'stable'; // Within 2 points is considered stable
      return diff > 0 ? 'improving' : 'declining';
    };

    const overallTrend = latest.scores.overallScore - previous.scores.overallScore;
    const trendStrength = Math.max(-1, Math.min(1, overallTrend / 50)); // Normalize to -1 to 1

    return {
      overall: calculateTrend(latest.scores.overallScore, previous.scores.overallScore),
      delivery: calculateTrend(latest.scores.deliveryScore, previous.scores.deliveryScore),
      quality: calculateTrend(latest.scores.qualityScore, previous.scores.qualityScore),
      price: calculateTrend(latest.scores.priceScore, previous.scores.priceScore),
      service: calculateTrend(latest.scores.serviceScore, previous.scores.serviceScore),
      trendStrength
    };
  }
}
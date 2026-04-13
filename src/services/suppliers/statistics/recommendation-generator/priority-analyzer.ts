/**
 * Priority Analyzer
 * Priority-based recommendation analysis and ranking
 */

import { Supplier } from '@/types/supplier/base.types';
import { CoreRecommendationEngine } from './core-recommendations';
import type {
  ComplianceInfo,
  RecommendationItem,
  ImprovementPlan,
} from './recommendation-types';
import type { PerformanceMetrics } from '../scorecard/types';

export class RecommendationPriorityAnalyzer {
  /**
   * Generate priority-based recommendations
   */
  static generatePriorityRecommendations(
    supplier: Supplier,
    overallScore: number,
    compliance: ComplianceInfo,
    performanceMetrics?: Partial<PerformanceMetrics>
  ): RecommendationItem[] {
    const recommendations: RecommendationItem[] = [];

    // Critical priority recommendations (score < 50)
    if (overallScore < 50) {
      recommendations.push({
        recommendation: 'Immediate supplier performance review and improvement plan required',
        priority: 'critical',
        category: 'performance',
        impact: 'Significant business risk mitigation',
        timeline: 'Immediate (1-2 days)',
        estimatedCost: 'high',
        difficulty: 'high'
      });
    }

    // High priority recommendations (score < 70 or compliance < 70)
    if (overallScore < 70) {
      recommendations.push({
        recommendation: 'Critical improvement needed across all performance areas',
        priority: 'high',
        category: 'performance',
        impact: 'Significant score improvement potential',
        timeline: 'Short term (1-4 weeks)',
        estimatedCost: 'medium',
        difficulty: 'medium'
      });
    }

    if (compliance.score < 70) {
      recommendations.push({
        recommendation: 'Update compliance documentation and certifications',
        priority: 'high',
        category: 'compliance',
        impact: 'Risk mitigation and score improvement',
        timeline: 'Short term (2-8 weeks)',
        estimatedCost: 'medium',
        difficulty: 'medium'
      });
    }

    // Medium priority recommendations
    if (performanceMetrics?.onTimeDelivery < 90) {
      recommendations.push({
        recommendation: 'Improve delivery time consistency and logistics',
        priority: 'medium',
        category: 'performance',
        impact: 'Customer satisfaction improvement',
        timeline: 'Medium term (6-12 weeks)',
        estimatedCost: 'low',
        difficulty: 'medium'
      });
    }

    if (!CoreRecommendationEngine.hasCompleteContact(supplier)) {
      recommendations.push({
        recommendation: 'Complete contact information and communication channels',
        priority: 'medium',
        category: 'communication',
        impact: 'Improved communication efficiency',
        timeline: 'Immediate (1-2 days)',
        estimatedCost: 'low',
        difficulty: 'low'
      });
    }

    if (performanceMetrics?.qualityScore < 85) {
      recommendations.push({
        recommendation: 'Implement quality improvement initiatives',
        priority: 'medium',
        category: 'performance',
        impact: 'Enhanced product/service quality',
        timeline: 'Medium term (4-16 weeks)',
        estimatedCost: 'medium',
        difficulty: 'medium'
      });
    }

    // Low priority recommendations
    if (!supplier.isPreferred && overallScore > 85) {
      recommendations.push({
        recommendation: 'Evaluate for preferred supplier status and strategic partnership',
        priority: 'low',
        category: 'business',
        impact: 'Strategic partnership opportunities',
        timeline: 'Long term (3-6 months)',
        estimatedCost: 'low',
        difficulty: 'low'
      });
    }

    if (!supplier.categories || supplier.categories.length <= 1) {
      recommendations.push({
        recommendation: 'Explore service category expansion opportunities',
        priority: 'low',
        category: 'business',
        impact: 'Business growth potential',
        timeline: 'Long term (6-12 months)',
        estimatedCost: 'medium',
        difficulty: 'medium'
      });
    }

    return this.sortRecommendationsByPriority(recommendations);
  }

  /**
   * Generate actionable improvement plan
   */
  static generateImprovementPlan(recommendations: RecommendationItem[]): ImprovementPlan {
    return {
      immediate: recommendations
        .filter(r => r.timeline.includes('Immediate'))
        .map(r => r.recommendation),
      shortTerm: recommendations
        .filter(r => r.timeline.includes('Short term'))
        .map(r => r.recommendation),
      mediumTerm: recommendations
        .filter(r => r.timeline.includes('Medium term'))
        .map(r => r.recommendation),
      longTerm: recommendations
        .filter(r => r.timeline.includes('Long term'))
        .map(r => r.recommendation)
    };
  }

  /**
   * Calculate ROI score for recommendations
   */
  static calculateROIScore(recommendation: RecommendationItem): number {
    const impactScores: Record<string, number> = {
      'Significant business risk mitigation': 10,
      'Significant score improvement potential': 8,
      'Risk mitigation and score improvement': 7,
      'Customer satisfaction improvement': 6,
      'Improved communication efficiency': 5,
      'Enhanced product/service quality': 6,
      'Strategic partnership opportunities': 4,
      'Business growth potential': 5
    };

    const costScores = { high: 3, medium: 2, low: 1 };
    const difficultyScores = { high: 3, medium: 2, low: 1 };
    const priorityScores = { critical: 4, high: 3, medium: 2, low: 1 };

    const impactScore = impactScores[recommendation.impact] || 5;
    const costScore = costScores[recommendation.estimatedCost || 'medium'];
    const difficultyScore = difficultyScores[recommendation.difficulty || 'medium'];
    const priorityScore = priorityScores[recommendation.priority];

    // ROI = (Impact * Priority) / (Cost * Difficulty)
    return (impactScore * priorityScore) / (costScore * difficultyScore);
  }

  /**
   * Sort recommendations by priority and ROI
   */
  static sortRecommendationsByPriority(recommendations: RecommendationItem[]): RecommendationItem[] {
    const priorityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
    
    return recommendations.sort((a, b) => {
      // First sort by priority
      const priorityDiff = priorityOrder[b.priority] - priorityOrder[a.priority];
      if (priorityDiff !== 0) return priorityDiff;
      
      // Then by ROI score
      return this.calculateROIScore(b) - this.calculateROIScore(a);
    });
  }

  /**
   * Filter recommendations by category
   */
  static filterRecommendationsByCategory(
    recommendations: RecommendationItem[],
    categories: string[]
  ): RecommendationItem[] {
    return recommendations.filter(rec => categories.includes(rec.category));
  }

  /**
   * Get high-impact quick wins
   */
  static getQuickWins(recommendations: RecommendationItem[]): RecommendationItem[] {
    return recommendations.filter(rec => 
      rec.timeline.includes('Immediate') || 
      (rec.timeline.includes('Short term') && rec.difficulty === 'low')
    ).slice(0, 3);
  }

  /**
   * Estimate implementation timeline
   */
  static estimateImplementationTimeline(recommendations: RecommendationItem[]): {
    totalWeeks: number;
    phaseBreakdown: Record<string, number>;
    criticalPath: string[];
  } {
    const phases = {
      immediate: 1, // 1 week
      shortTerm: 6, // 6 weeks
      mediumTerm: 12, // 12 weeks
      longTerm: 24 // 24 weeks
    };

    let totalWeeks = 0;
    const phaseBreakdown: Record<string, number> = {};
    const criticalPath: string[] = [];

    recommendations.forEach(rec => {
      if (rec.timeline.includes('Immediate')) {
        phaseBreakdown.immediate = (phaseBreakdown.immediate || 0) + 1;
        if (rec.priority === 'critical' || rec.priority === 'high') {
          criticalPath.push(rec.recommendation);
        }
      } else if (rec.timeline.includes('Short term')) {
        phaseBreakdown.shortTerm = (phaseBreakdown.shortTerm || 0) + 1;
        totalWeeks = Math.max(totalWeeks, phases.shortTerm);
      } else if (rec.timeline.includes('Medium term')) {
        phaseBreakdown.mediumTerm = (phaseBreakdown.mediumTerm || 0) + 1;
        totalWeeks = Math.max(totalWeeks, phases.mediumTerm);
      } else if (rec.timeline.includes('Long term')) {
        phaseBreakdown.longTerm = (phaseBreakdown.longTerm || 0) + 1;
        totalWeeks = Math.max(totalWeeks, phases.longTerm);
      }
    });

    return {
      totalWeeks,
      phaseBreakdown,
      criticalPath
    };
  }
}
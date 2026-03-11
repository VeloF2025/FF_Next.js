/**
 * Core Scorecard Calculations
 * Handles main score calculations and detailed breakdowns
 */

import { Supplier } from '@/types/supplier/base.types';
import { 
  ScoreCalculationWeights,
  ScoreCalculationResult,
  DEFAULT_SCORE_WEIGHTS
} from '../scorecardTypes';
import { DataExtractors } from './dataExtractors';

export class CoreCalculations {
  private static readonly weights: ScoreCalculationWeights = DEFAULT_SCORE_WEIGHTS;

  /**
   * Calculate overall supplier score with detailed breakdown
   */
  static calculateOverallScore(supplier: Supplier, customWeights?: Partial<ScoreCalculationWeights>): number {
    const result = this.calculateDetailedScore(supplier, customWeights);
    return result.weightedSum > 0 ? Math.round((result.totalScore / result.weightedSum) * 100) : 0;
  }

  /**
   * Calculate detailed score with breakdown
   */
  static calculateDetailedScore(
    supplier: Supplier, 
    customWeights?: Partial<ScoreCalculationWeights>
  ): ScoreCalculationResult {
    const weights = { ...this.weights, ...customWeights };
    let totalScore = 0;
    let weightedSum = 0;

    const breakdown = {
      rating: 0,
      performance: 0,
      compliance: 0,
      preferredBonus: 0,
      responseTime: 0
    };

    // Rating score
    const ratingScore = DataExtractors.extractSupplierRating(supplier);
    if (ratingScore > 0) {
      const ratingPoints = (ratingScore / 5) * weights.rating;
      totalScore += ratingPoints;
      weightedSum += weights.rating;
      breakdown.rating = ratingPoints;
    }

    // Performance score
    const performanceScore = DataExtractors.extractPerformanceScore(supplier);
    if (performanceScore > 0) {
      const performancePoints = (performanceScore / 100) * weights.performance;
      totalScore += performancePoints;
      weightedSum += weights.performance;
      breakdown.performance = performancePoints;
    }

    // Compliance score
    const complianceScore = DataExtractors.extractComplianceScore(supplier);
    if (complianceScore > 0) {
      const compliancePoints = (complianceScore / 100) * weights.compliance;
      totalScore += compliancePoints;
      weightedSum += weights.compliance;
      breakdown.compliance = compliancePoints;
    }

    // Preferred status bonus
    if (supplier.isPreferred) {
      totalScore += weights.preferredStatus;
      weightedSum += weights.preferredStatus;
      breakdown.preferredBonus = weights.preferredStatus;
    }

    // Response time score
    const responseScore = this.calculateResponseScore(supplier);
    const responsePoints = (responseScore / 100) * weights.responseTime;
    totalScore += responsePoints;
    weightedSum += weights.responseTime;
    breakdown.responseTime = responsePoints;

    return {
      totalScore,
      weightedSum,
      breakdown
    };
  }

  /**
   * Calculate response score based on supplier data
   */
  static calculateResponseScore(supplier: Supplier): number {
    let score = 0;
    
    // Basic contact information (40 points)
    if (supplier.primaryContact?.email) {
      score += 40;
    }
    
    if (supplier.primaryContact?.phone) {
      score += 20;
    }
    
    // Additional contact methods (20 points)
    if (supplier.website) {
      score += 10;
    }
    
    if (supplier.addresses?.physical) {
      score += 10;
    }
    
    // Response history (20 points) - simplified
    if (supplier.lastContact) {
      const daysSinceLastContact = Math.floor(
        (Date.now() - new Date(supplier.lastContact).getTime()) / (1000 * 60 * 60 * 24)
      );
      
      if (daysSinceLastContact <= 7) {
        score += 20;
      } else if (daysSinceLastContact <= 30) {
        score += 10;
      }
    }
    
    return Math.min(100, score);
  }

  /**
   * Calculate weighted average score
   */
  static calculateWeightedAverage(
    scores: number[], 
    weights: number[]
  ): number {
    if (scores.length !== weights.length) {
      throw new Error('Scores and weights arrays must have the same length');
    }
    
    let weightedSum = 0;
    let totalWeight = 0;
    
    for (let i = 0; i < scores.length; i++) {
      if (scores[i]! > 0) { // Only include non-zero scores
        weightedSum += scores[i]! * weights[i]!;
        totalWeight += weights[i]!;
      }
    }
    
    return totalWeight > 0 ? weightedSum / totalWeight : 0;
  }

  /**
   * Get score interpretation
   */
  static getScoreInterpretation(score: number): {
    grade: string;
    description: string;
    color: string;
  } {
    if (score >= 90) {
      return {
        grade: 'A+',
        description: 'Exceptional Performance',
        color: '#22c55e'
      };
    } else if (score >= 80) {
      return {
        grade: 'A',
        description: 'Excellent Performance',
        color: '#16a34a'
      };
    } else if (score >= 70) {
      return {
        grade: 'B',
        description: 'Good Performance',
        color: '#65a30d'
      };
    } else if (score >= 60) {
      return {
        grade: 'C',
        description: 'Acceptable Performance',
        color: '#eab308'
      };
    } else if (score >= 40) {
      return {
        grade: 'D',
        description: 'Needs Improvement',
        color: '#f97316'
      };
    } else {
      return {
        grade: 'F',
        description: 'Critical Issues',
        color: '#ef4444'
      };
    }
  }
}
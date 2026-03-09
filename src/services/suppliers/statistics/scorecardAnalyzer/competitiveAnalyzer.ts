/**
 * Competitive Analyzer
 * Handles competitive position analysis and market insights
 */

import { Supplier } from '@/types/supplier/base.types';
import { ScorecardCalculator } from '../scorecardCalculator';
import { BenchmarkCalculator } from './benchmarkCalculator';

export class CompetitiveAnalyzer {
  /**
   * Calculate competitive position analysis
   */
  static calculateCompetitivePosition(
    supplier: Supplier,
    _allSuppliers: Supplier[]
  ): {
    rank: number;
    totalSuppliers: number;
    scoreGap: {
      toNext: number;
      toPrevious: number;
    };
    percentileRange: string;
  } {
    const supplierScore = ScorecardCalculator.calculateOverallScore(supplier);
    const allScores = _allSuppliers
      .map((s: Supplier) => ({ 
        id: s.id, 
        score: ScorecardCalculator.calculateOverallScore(s) 
      }))
      .filter((s: { id: string; score: number }) => s.score > 0)
      .sort((a, b) => b.score - a.score); // Descending order
    
    const rank = allScores.findIndex((s: { id: string; score: number }) => s.id === supplier.id) + 1;
    const totalSuppliers = allScores.length;
    
    // Calculate score gaps
    const scoreGap = {
      toNext: rank > 1 ? allScores[rank - 2]!.score - supplierScore : 0,
      toPrevious: rank < totalSuppliers ? supplierScore - allScores[rank]!.score : 0
    };
    
    // Determine percentile range
    const percentile = BenchmarkCalculator.calculatePercentile(
      supplierScore, 
      allScores.map(s => s.score).sort((a, b) => a - b)
    );
    const percentileRange = BenchmarkCalculator.getPercentileRange(percentile);
    
    return {
      rank,
      totalSuppliers,
      scoreGap,
      percentileRange
    };
  }

  /**
   * Calculate market position insights
   */
  static calculateMarketPositionInsights(
    supplier: Supplier,
    _allSuppliers: Supplier[]
  ): {
    marketPosition: string;
    strengthAreas: string[];
    improvementAreas: string[];
    competitiveAdvantages: string[];
  } {
    const ratings = ScorecardCalculator.extractRatings(supplier);
    const performance = ScorecardCalculator.extractPerformance(supplier);
    const overallScore = ScorecardCalculator.calculateOverallScore(supplier);
    
    // Determine market position
    let marketPosition: string;
    if (overallScore >= 85) {
      marketPosition = 'Market Leader';
    } else if (overallScore >= 70) {
      marketPosition = 'Strong Performer';
    } else if (overallScore >= 55) {
      marketPosition = 'Average Performer';
    } else if (overallScore >= 40) {
      marketPosition = 'Below Average';
    } else {
      marketPosition = 'Underperformer';
    }
    
    // Identify strength areas (above 4.0 for ratings, above 85 for performance)
    const strengthAreas: string[] = [];
    if (ratings.quality >= 4.0) strengthAreas.push('Quality Excellence');
    if (ratings.delivery >= 4.0) strengthAreas.push('Reliable Delivery');
    if (ratings.communication >= 4.0) strengthAreas.push('Excellent Communication');
    if (ratings.pricing >= 4.0) strengthAreas.push('Competitive Pricing');
    if (ratings.reliability >= 4.0) strengthAreas.push('High Reliability');
    if (performance.onTimeDelivery >= 95) strengthAreas.push('On-Time Delivery');
    if (performance.qualityScore >= 90) strengthAreas.push('Quality Assurance');
    
    // Identify improvement areas (below 3.0 for ratings, below 70 for performance)
    const improvementAreas: string[] = [];
    if (ratings.quality < 3.0) improvementAreas.push('Quality Control');
    if (ratings.delivery < 3.0) improvementAreas.push('Delivery Performance');
    if (ratings.communication < 3.0) improvementAreas.push('Communication Skills');
    if (ratings.pricing < 3.0) improvementAreas.push('Price Competitiveness');
    if (ratings.reliability < 3.0) improvementAreas.push('Reliability Issues');
    if (performance.onTimeDelivery < 80) improvementAreas.push('Delivery Timeliness');
    if (performance.qualityScore < 75) improvementAreas.push('Quality Standards');
    
    // Identify competitive advantages
    const competitiveAdvantages: string[] = [];
    if (supplier.isPreferred) competitiveAdvantages.push('Preferred Supplier Status');
    if (supplier.certifications?.length) competitiveAdvantages.push('Industry Certifications');
    if (supplier.yearsInBusiness && supplier.yearsInBusiness > 10) {
      competitiveAdvantages.push('Established Track Record');
    }
    
    return {
      marketPosition,
      strengthAreas,
      improvementAreas,
      competitiveAdvantages
    };
  }
}
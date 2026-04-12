/**
 * Comparison Engine
 * Handles supplier comparisons, rankings, and competitive analysis
 */

import { SupplierCrudService } from '../../supplier.crud';
import { BenchmarkCalculator } from './benchmark-calculator';
import { log } from '@/lib/logger';
import { Supplier } from '@/types/supplier/base.types';
import { SupplierPerformance } from '@/types/supplier/performance.types';
import {
  SupplierComparison,
  CategoryRanking,
  PerformanceMetrics,
  PerformanceMetricsDiff,
  RankingOptions
} from './benchmark-types';

/** Typed shape for competitive positioning — used by generateCompetitiveInsights */
interface SupplierPositionSummary {
  id: string;
  name: string;
  scores: PerformanceMetrics;
  marketPosition: 'leader' | 'challenger' | 'follower' | 'niche';
}

/** Typed shape for a single competitor entry */
interface CompetitorEntry {
  id: string;
  name: string;
  scores: PerformanceMetrics;
  relationToSupplier: 'ahead' | 'behind' | 'similar';
  gap: PerformanceMetricsDiff;
}

/**
 * Supplier comparison and ranking engine
 */
export class ComparisonEngine {
  /**
   * Compare supplier against industry benchmarks
   */
  static async compareSupplier(supplierId: string): Promise<SupplierComparison> {
    try {
      const supplier = await SupplierCrudService.getById(supplierId);
      const benchmarks = await BenchmarkCalculator.calculateBenchmarks();

      const performance = supplier.performance as SupplierPerformance | undefined;
      const supplierScores: PerformanceMetrics = {
        overallScore: performance?.overallScore ?? 0,
        deliveryScore: performance?.deliveryScore ?? 0,
        qualityScore: performance?.qualityScore ?? 0,
        priceScore: performance?.priceScore ?? 0,
        serviceScore: performance?.serviceScore ?? 0
      };

      const industryComparison = BenchmarkCalculator.calculateMetricsDifference(
        supplierScores,
        benchmarks.industryAverages
      );

      const topPerformersComparison = BenchmarkCalculator.calculateMetricsDifference(
        supplierScores,
        benchmarks.topPerformers
      );

      const categoryRanking = await this.getCategoryRankings(supplierId, supplier.categories || []);

      return {
        supplierScores,
        industryComparison,
        topPerformersComparison,
        categoryRanking
      };
    } catch (error) {
      log.error('Error comparing supplier against benchmarks:', { data: error }, 'comparison-engine');
      throw error;
    }
  }

  /**
   * Get category rankings for a supplier
   */
  static async getCategoryRankings(
    supplierId: string,
    categories: string[],
    options: RankingOptions = {}
  ): Promise<CategoryRanking[]> {
    try {
      const rankings: CategoryRanking[] = [];

      for (const category of categories) {
        const categorySuppliers = await this.getSuppliersInCategory(category, options);

        // Sort by specified metric or overall score
        const sortBy = (options.sortBy ?? 'overallScore') as keyof SupplierPerformance;
        const sortedSuppliers = categorySuppliers.sort((a, b) => {
          const aScore = (a.performance as SupplierPerformance | undefined)?.[sortBy] ?? 0;
          const bScore = (b.performance as SupplierPerformance | undefined)?.[sortBy] ?? 0;
          return (bScore as number) - (aScore as number);
        });

        // Find rank
        const rank = sortedSuppliers.findIndex(s => s.id === supplierId) + 1;
        const percentile = rank > 0 ? Math.round((1 - (rank - 1) / sortedSuppliers.length) * 100) : 0;

        rankings.push({
          category,
          rank: rank || sortedSuppliers.length + 1,
          totalInCategory: sortedSuppliers.length,
          percentile
        });
      }

      return rankings;
    } catch (error) {
      log.error('Error getting category rankings:', { data: error }, 'comparison-engine');
      return [];
    }
  }

  /**
   * Get suppliers in a specific category with filtering options
   */
  private static async getSuppliersInCategory(category: string, options: RankingOptions = {} as RankingOptions): Promise<Supplier[]> {
    const allSuppliers = await SupplierCrudService.getAll();
    return allSuppliers.filter(supplier => {
      // Status filter
      if (!options.includeInactive && supplier.status !== 'active') {
        return false;
      }

      // Category membership
      if (!supplier.categories?.some(cat => cat.toString() === category.toString())) {
        return false;
      }

      // Performance data requirement
      if (!supplier.performance) {
        return false;
      }

      // Minimum score filter
      if (options.minimumScore && supplier.performance.overallScore < options.minimumScore) {
        return false;
      }

      return true;
    });
  }

  /**
   * Compare multiple suppliers head-to-head
   */
  static async compareMultipleSuppliers(supplierIds: string[]): Promise<{
    suppliers: Array<{
      id: string;
      name: string;
      scores: PerformanceMetrics;
      rank: number;
    }>;
    averages: PerformanceMetrics;
    bestPerformers: {
      overall: string;
      delivery: string;
      quality: string;
      price: string;
      service: string;
    };
  }> {
    try {
      const suppliers = await Promise.all(
        supplierIds.map(id => SupplierCrudService.getById(id))
      );

      const supplierData = suppliers.map(supplier => {
        const performance = supplier.performance as SupplierPerformance | undefined;
        return {
          id: supplier.id,
          name: supplier.name,
          scores: {
            overallScore: performance?.overallScore ?? 0,
            deliveryScore: performance?.deliveryScore ?? 0,
            qualityScore: performance?.qualityScore ?? 0,
            priceScore: performance?.priceScore ?? 0,
            serviceScore: performance?.serviceScore ?? 0
          }
        };
      });

      // Sort by overall score and assign ranks
      const rankedSuppliers = supplierData
        .sort((a, b) => b.scores.overallScore - a.scores.overallScore)
        .map((supplier, index) => ({ ...supplier, rank: index + 1 }));

      // Calculate averages
      const totals = supplierData.reduce((acc, supplier) => {
        acc.overallScore += supplier.scores.overallScore;
        acc.deliveryScore += supplier.scores.deliveryScore;
        acc.qualityScore += supplier.scores.qualityScore;
        acc.priceScore += supplier.scores.priceScore;
        acc.serviceScore += supplier.scores.serviceScore;
        return acc;
      }, { overallScore: 0, deliveryScore: 0, qualityScore: 0, priceScore: 0, serviceScore: 0 });

      const averages: PerformanceMetrics = {
        overallScore: Math.round(totals.overallScore / supplierData.length),
        deliveryScore: Math.round(totals.deliveryScore / supplierData.length),
        qualityScore: Math.round(totals.qualityScore / supplierData.length),
        priceScore: Math.round(totals.priceScore / supplierData.length),
        serviceScore: Math.round(totals.serviceScore / supplierData.length)
      };

      // Find best performers in each category
      const bestPerformers = {
        overall: this.findBestPerformer(supplierData, 'overallScore'),
        delivery: this.findBestPerformer(supplierData, 'deliveryScore'),
        quality: this.findBestPerformer(supplierData, 'qualityScore'),
        price: this.findBestPerformer(supplierData, 'priceScore'),
        service: this.findBestPerformer(supplierData, 'serviceScore')
      };

      return {
        suppliers: rankedSuppliers,
        averages,
        bestPerformers
      };
    } catch (error) {
      log.error('Error comparing multiple suppliers:', { data: error }, 'comparison-engine');
      throw error;
    }
  }

  /**
   * Find the best performing supplier for a specific metric
   */
  private static findBestPerformer(
    suppliers: Array<{ id: string; name: string; scores: PerformanceMetrics }>,
    metric: keyof PerformanceMetrics
  ): string {
    if (suppliers.length === 0) return '';

    const best = suppliers.reduce((prev, current) =>
      current.scores[metric] > prev.scores[metric] ? current : prev
    );

    return best.name;
  }

  /**
   * Get competitive positioning analysis
   */
  static async getCompetitivePositioning(supplierId: string, competitors: string[]): Promise<{
    supplierPosition: SupplierPositionSummary;
    competitorAnalysis: CompetitorEntry[];
    insights: string[];
  }> {
    try {
      const supplier = await SupplierCrudService.getById(supplierId);
      const competitorData = await Promise.all(
        competitors.map(id => SupplierCrudService.getById(id))
      );

      const supplierScores = this.extractPerformanceMetrics(supplier);
      const supplierPosition: SupplierPositionSummary = {
        id: supplier.id,
        name: supplier.name,
        scores: supplierScores,
        marketPosition: this.determineMarketPosition(supplierScores, competitorData)
      };

      const competitorAnalysis: CompetitorEntry[] = competitorData.map(competitor => {
        const competitorScores = this.extractPerformanceMetrics(competitor);
        const gap = BenchmarkCalculator.calculateMetricsDifference(competitorScores, supplierScores);

        return {
          id: competitor.id,
          name: competitor.name,
          scores: competitorScores,
          relationToSupplier: this.determineRelation(supplierScores.overallScore, competitorScores.overallScore),
          gap
        };
      });

      const insights = this.generateCompetitiveInsights(supplierPosition, competitorAnalysis);

      return {
        supplierPosition,
        competitorAnalysis,
        insights
      };
    } catch (error) {
      log.error('Error getting competitive positioning:', { data: error }, 'comparison-engine');
      throw error;
    }
  }

  /**
   * Extract performance metrics from supplier data
   */
  private static extractPerformanceMetrics(supplier: Supplier): PerformanceMetrics {
    const performance = supplier.performance as SupplierPerformance | undefined;
    return {
      overallScore: performance?.overallScore ?? 0,
      deliveryScore: performance?.deliveryScore ?? 0,
      qualityScore: performance?.qualityScore ?? 0,
      priceScore: performance?.priceScore ?? 0,
      serviceScore: performance?.serviceScore ?? 0
    };
  }

  /**
   * Determine market position based on performance
   */
  private static determineMarketPosition(
    supplierScores: PerformanceMetrics,
    competitors: Supplier[]
  ): 'leader' | 'challenger' | 'follower' | 'niche' {
    const competitorScores = competitors.map(c => this.extractPerformanceMetrics(c));
    const allScores = [supplierScores, ...competitorScores].map(s => s.overallScore);
    const maxScore = Math.max(...allScores);
    const avgScore = allScores.reduce((sum, score) => sum + score, 0) / allScores.length;

    const supplierScore = supplierScores.overallScore;

    if (supplierScore === maxScore) return 'leader';
    if (supplierScore >= avgScore + 5) return 'challenger';
    if (supplierScore >= avgScore - 5) return 'follower';
    return 'niche';
  }

  /**
   * Determine relationship between two scores
   */
  private static determineRelation(supplierScore: number, competitorScore: number): 'ahead' | 'behind' | 'similar' {
    const diff = Math.abs(supplierScore - competitorScore);
    if (diff <= 3) return 'similar';
    return supplierScore > competitorScore ? 'ahead' : 'behind';
  }

  /**
   * Generate competitive insights from typed supplier position and competitor data
   */
  private static generateCompetitiveInsights(
    supplierPosition: SupplierPositionSummary,
    competitorAnalysis: CompetitorEntry[]
  ): string[] {
    const insights: string[] = [];
    const scores = supplierPosition.scores;

    // Market position insight
    insights.push(`Market position: ${supplierPosition.marketPosition.charAt(0).toUpperCase() + supplierPosition.marketPosition.slice(1)}`);

    // Performance insights
    const strongestMetric = Object.entries(scores).reduce((prev, current) =>
      (current[1] as number) > (prev[1] as number) ? current : prev
    )[0]!;
    insights.push(`Strongest performance area: ${strongestMetric.replace('Score', '')}`);

    const weakestMetric = Object.entries(scores).reduce((prev, current) =>
      (current[1] as number) < (prev[1] as number) ? current : prev
    )[0]!;
    insights.push(`Area for improvement: ${weakestMetric.replace('Score', '')}`);

    // Competitive insights
    const aheadCount = competitorAnalysis.filter(c => c.relationToSupplier === 'ahead').length;
    const behindCount = competitorAnalysis.filter(c => c.relationToSupplier === 'behind').length;

    if (aheadCount > behindCount) {
      insights.push(`Outperforming ${aheadCount} of ${competitorAnalysis.length} competitors`);
    } else {
      insights.push(`${behindCount} competitors are performing better`);
    }

    return insights;
  }
}

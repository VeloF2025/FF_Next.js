/**
 * Performance Reports Generator
 * Generate formatted reports and summaries for performance analysis
 */

import { PerformanceTrends, PerformanceBenchmarks, TrendAnalysis, BenchmarkStats } from './analyzer-types';

export class PerformanceReportsGenerator {
  /**
   * Generate performance trends summary report
   */
  static generateTrendsSummaryReport(trends: PerformanceTrends[]): string {
    if (trends.length === 0) {
      return 'No performance trends data available.';
    }

    const latest = trends[trends.length - 1];
    const previous = trends.length > 1 ? trends[trends.length - 2] : null;

    let report = `Performance Trends Summary - ${latest.month} ${latest.year}\n`;
    report += `${'='.repeat(50)}\n\n`;

    report += `Current Period:\n`;
    report += `- Total Suppliers: ${latest.totalSuppliers}\n`;
    report += `- New Suppliers: ${latest.newSuppliers}\n`;
    report += `- Average Rating: ${latest.averageRating.toFixed(2)}\n`;
    report += `- Average Performance: ${latest.averagePerformance.toFixed(2)}\n`;
    report += `- Top Performers: ${latest.topPerformers}\n`;
    report += `- Underperformers: ${latest.underPerformers}\n\n`;

    if (previous) {
      const ratingChange = ((latest.averageRating - previous.averageRating) / previous.averageRating * 100);
      const supplierChange = latest.totalSuppliers - previous.totalSuppliers;
      
      report += `Month-over-Month Changes:\n`;
      report += `- Rating Change: ${ratingChange >= 0 ? '+' : ''}${ratingChange.toFixed(2)}%\n`;
      report += `- Supplier Count Change: ${supplierChange >= 0 ? '+' : ''}${supplierChange}\n\n`;
    }

    report += `Category Breakdown:\n`;
    Object.entries(latest.categoryBreakdown).forEach(([category, count]) => {
      report += `- ${category}: ${count} suppliers\n`;
    });

    return report;
  }

  /**
   * Generate benchmarks summary report
   */
  static generateBenchmarksSummaryReport(benchmarks: PerformanceBenchmarks): string {
    let report = `Performance Benchmarks Report\n`;
    report += `${'='.repeat(40)}\n`;
    report += `Generated: ${new Date(benchmarks.lastUpdated).toISOString().split('T')[0]}\n\n`;

    report += `Overall Performance:\n`;
    report += this.formatBenchmarkStats(benchmarks.overall);
    report += `\n`;

    if (Object.keys(benchmarks.byCategory).length > 0) {
      report += `Performance by Category:\n`;
      report += `${'-'.repeat(25)}\n`;
      Object.entries(benchmarks.byCategory).forEach(([category, stats]) => {
        report += `${category}:\n`;
        report += this.formatBenchmarkStats(stats, '  ');
        report += `\n`;
      });
    }

    if (Object.keys(benchmarks.byBusinessType).length > 0) {
      report += `Performance by Business Type:\n`;
      report += `${'-'.repeat(30)}\n`;
      Object.entries(benchmarks.byBusinessType).forEach(([type, stats]) => {
        report += `${type}:\n`;
        report += this.formatBenchmarkStats(stats, '  ');
        report += `\n`;
      });
    }

    return report;
  }

  /**
   * Generate trend analysis report
   */
  static generateTrendAnalysisReport(analyses: TrendAnalysis[]): string {
    if (analyses.length === 0) {
      return 'No trend analysis data available.';
    }

    let report = `Trend Analysis Report\n`;
    report += `${'='.repeat(25)}\n\n`;

    analyses.forEach(analysis => {
      report += `${analysis.category} (${analysis.timeframe}):\n`;
      report += `- Trend: ${analysis.trend.toUpperCase()}\n`;
      report += `- Significance: ${analysis.significance.toUpperCase()}\n`;
      report += `- Change: ${analysis.changePercent >= 0 ? '+' : ''}${analysis.changePercent.toFixed(2)}%\n`;
      report += `- Current Value: ${analysis.currentValue.toFixed(2)}\n`;
      report += `- Previous Value: ${analysis.previousValue.toFixed(2)}\n\n`;
    });

    return report;
  }

  /**
   * Generate comprehensive performance report
   */
  static generateComprehensiveReport(
    trends: PerformanceTrends[],
    benchmarks: PerformanceBenchmarks,
    analyses: TrendAnalysis[]
  ): string {
    let report = `COMPREHENSIVE PERFORMANCE ANALYSIS REPORT\n`;
    report += `${'='.repeat(50)}\n`;
    report += `Generated: ${new Date().toISOString().split('T')[0]} ${new Date().toTimeString().slice(0, 5)}\n\n`;

    // Executive Summary
    report += `EXECUTIVE SUMMARY\n`;
    report += `${'-'.repeat(17)}\n`;
    if (trends.length > 0) {
      const latest = trends[trends.length - 1];
      report += `Current supplier base: ${latest.totalSuppliers} active suppliers\n`;
      report += `Overall performance rating: ${latest.averageRating.toFixed(2)}/5.0\n`;
      report += `Performance score: ${latest.averagePerformance.toFixed(2)}\n`;
    }
    report += `\n`;

    // Trends Section
    report += this.generateTrendsSummaryReport(trends);
    report += `\n`;

    // Benchmarks Section
    report += this.generateBenchmarksSummaryReport(benchmarks);
    report += `\n`;

    // Analysis Section
    report += this.generateTrendAnalysisReport(analyses);

    return report;
  }

  /**
   * Generate performance dashboard data
   */
  static generateDashboardData(
    trends: PerformanceTrends[],
    benchmarks: PerformanceBenchmarks
  ): {
    kpis: Record<string, { value: number; change?: number; trend?: string }>;
    chartData: {
      trends: { month: string; rating: number; performance: number }[];
      categories: { name: string; count: number; avgRating: number }[];
    };
    alerts: { type: 'warning' | 'info' | 'error'; message: string }[];
  } {
    const kpis: Record<string, { value: number; change?: number; trend?: string }> = {};
    const alerts: { type: 'warning' | 'info' | 'error'; message: string }[] = [];

    if (trends.length > 0) {
      const latest = trends[trends.length - 1];
      const previous = trends.length > 1 ? trends[trends.length - 2] : null;

      kpis.totalSuppliers = { value: latest.totalSuppliers };
      kpis.averageRating = { value: latest.averageRating };
      kpis.newSuppliers = { value: latest.newSuppliers };
      kpis.topPerformers = { value: latest.topPerformers };

      if (previous) {
        kpis.averageRating.change = ((latest.averageRating - previous.averageRating) / previous.averageRating * 100);
        kpis.averageRating.trend = kpis.averageRating.change > 0 ? 'up' : 'down';
        
        const supplierChange = latest.totalSuppliers - previous.totalSuppliers;
        kpis.totalSuppliers.change = supplierChange;
        kpis.totalSuppliers.trend = supplierChange > 0 ? 'up' : 'down';

        // Generate alerts
        if (Math.abs(kpis.averageRating.change) > 10) {
          alerts.push({
            type: 'warning',
            message: `Significant rating change: ${kpis.averageRating.change.toFixed(1)}% this month`
          });
        }

        if (latest.underPerformers > latest.totalSuppliers * 0.3) {
          alerts.push({
            type: 'error',
            message: `High number of underperformers: ${latest.underPerformers} suppliers need attention`
          });
        }
      }
    }

    const chartData = {
      trends: trends.map(t => ({
        month: `${t.month.substring(0, 3)} ${t.year}`,
        rating: t.averageRating,
        performance: t.averagePerformance
      })),
      categories: Object.entries(benchmarks.byCategory).map(([name, stats]) => ({
        name,
        count: stats.sampleSize,
        avgRating: stats.mean
      }))
    };

    return { kpis, chartData, alerts };
  }

  /**
   * Export trends data to CSV format
   */
  static exportTrendsToCSV(trends: PerformanceTrends[]): string {
    const headers = [
      'Month', 'Year', 'Total Suppliers', 'New Suppliers', 
      'Average Rating', 'Average Performance', 'Top Performers', 'Underperformers'
    ];

    const rows = trends.map(trend => [
      trend.month,
      trend.year.toString(),
      trend.totalSuppliers.toString(),
      trend.newSuppliers.toString(),
      trend.averageRating.toFixed(2),
      trend.averagePerformance.toFixed(2),
      trend.topPerformers.toString(),
      trend.underPerformers.toString()
    ]);

    return [headers, ...rows].map(row => row.join(',')).join('\n');
  }

  /**
   * Export benchmarks data to CSV format
   */
  static exportBenchmarksToCSV(benchmarks: PerformanceBenchmarks): string {
    const headers = [
      'Category', 'Type', 'Mean', 'Median', 'Q1', 'Q3', 
      'Min', 'Max', 'Std Dev', 'Sample Size'
    ];

    const rows: string[][] = [];

    // Overall benchmarks
    rows.push([
      'Overall', 'All', 
      benchmarks.overall.mean.toFixed(2),
      benchmarks.overall.median.toFixed(2),
      benchmarks.overall.q1.toFixed(2),
      benchmarks.overall.q3.toFixed(2),
      benchmarks.overall.min.toFixed(2),
      benchmarks.overall.max.toFixed(2),
      benchmarks.overall.standardDeviation.toFixed(2),
      benchmarks.overall.sampleSize.toString()
    ]);

    // By category
    Object.entries(benchmarks.byCategory).forEach(([category, stats]) => {
      rows.push([
        category, 'Category',
        stats.mean.toFixed(2),
        stats.median.toFixed(2),
        stats.q1.toFixed(2),
        stats.q3.toFixed(2),
        stats.min.toFixed(2),
        stats.max.toFixed(2),
        stats.standardDeviation.toFixed(2),
        stats.sampleSize.toString()
      ]);
    });

    // By business type
    Object.entries(benchmarks.byBusinessType).forEach(([type, stats]) => {
      rows.push([
        type, 'Business Type',
        stats.mean.toFixed(2),
        stats.median.toFixed(2),
        stats.q1.toFixed(2),
        stats.q3.toFixed(2),
        stats.min.toFixed(2),
        stats.max.toFixed(2),
        stats.standardDeviation.toFixed(2),
        stats.sampleSize.toString()
      ]);
    });

    return [headers, ...rows].map(row => row.join(',')).join('\n');
  }

  /**
   * Format benchmark statistics for display
   */
  private static formatBenchmarkStats(stats: BenchmarkStats, indent: string = ''): string {
    let output = `${indent}- Mean: ${stats.mean.toFixed(2)}\n`;
    output += `${indent}- Median: ${stats.median.toFixed(2)}\n`;
    output += `${indent}- Q1-Q3: ${stats.q1.toFixed(2)} - ${stats.q3.toFixed(2)}\n`;
    output += `${indent}- Range: ${stats.min.toFixed(2)} - ${stats.max.toFixed(2)}\n`;
    output += `${indent}- Std Dev: ${stats.standardDeviation.toFixed(2)}\n`;
    output += `${indent}- Sample Size: ${stats.sampleSize}`;
    return output;
  }
}
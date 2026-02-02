/**
 * Database Query Performance Monitoring
 * Story 3.2: Database Query Optimization
 *
 * Tracks query execution times and identifies slow queries
 */

import { log } from '@/lib/logger';

interface QueryMetric {
  query: string;
  duration: number;
  timestamp: number;
  params?: any;
  stackTrace?: string;
}

interface QueryStats {
  query: string;
  count: number;
  totalDuration: number;
  averageDuration: number;
  minDuration: number;
  maxDuration: number;
  lastExecuted: number;
}

class QueryPerformanceMonitor {
  private metrics: QueryMetric[] = [];
  private readonly maxMetrics = 1000; // Keep last 1000 queries
  private readonly slowQueryThreshold = 100; // 100ms
  private enabled: boolean = false;

  constructor() {
    // Enable in development or if explicitly enabled
    this.enabled =
      process.env.NODE_ENV === 'development' ||
      process.env.ENABLE_QUERY_MONITORING === 'true';
  }

  /**
   * Track a query execution
   */
  track(query: string, duration: number, params?: any): void {
    if (!this.enabled) return;

    const metric: QueryMetric = {
      query: this.normalizeQuery(query),
      duration,
      timestamp: Date.now(),
      params,
    };

    // Capture stack trace for slow queries
    if (duration > this.slowQueryThreshold) {
      metric.stackTrace = new Error().stack;
    }

    this.metrics.push(metric);

    // Keep only last N metrics
    if (this.metrics.length > this.maxMetrics) {
      this.metrics.shift();
    }

    // Log slow queries
    if (duration > this.slowQueryThreshold) {
      log.warn(
        `${duration.toFixed(2)}ms: ${this.truncateQuery(query)}`,
        { duration, query: this.truncateQuery(query) },
        'SlowQuery'
      );
    }
  }

  /**
   * Measure query execution time
   */
  async measure<T>(
    queryFn: () => Promise<T>,
    queryName: string,
    params?: any
  ): Promise<T> {
    if (!this.enabled) {
      return queryFn();
    }

    const start = performance.now();
    try {
      const result = await queryFn();
      const duration = performance.now() - start;
      this.track(queryName, duration, params);
      return result;
    } catch (error) {
      const duration = performance.now() - start;
      this.track(`${queryName} [ERROR]`, duration, params);
      throw error;
    }
  }

  /**
   * Get query statistics
   */
  getStats(): QueryStats[] {
    const statsMap = new Map<string, QueryStats>();

    this.metrics.forEach((metric) => {
      const existing = statsMap.get(metric.query);

      if (existing) {
        existing.count++;
        existing.totalDuration += metric.duration;
        existing.averageDuration = existing.totalDuration / existing.count;
        existing.minDuration = Math.min(existing.minDuration, metric.duration);
        existing.maxDuration = Math.max(existing.maxDuration, metric.duration);
        existing.lastExecuted = Math.max(existing.lastExecuted, metric.timestamp);
      } else {
        statsMap.set(metric.query, {
          query: metric.query,
          count: 1,
          totalDuration: metric.duration,
          averageDuration: metric.duration,
          minDuration: metric.duration,
          maxDuration: metric.duration,
          lastExecuted: metric.timestamp,
        });
      }
    });

    return Array.from(statsMap.values())
      .sort((a, b) => b.averageDuration - a.averageDuration);
  }

  /**
   * Get slow queries (above threshold)
   */
  getSlowQueries(): QueryMetric[] {
    return this.metrics
      .filter((m) => m.duration > this.slowQueryThreshold)
      .sort((a, b) => b.duration - a.duration);
  }

  /**
   * Get most frequent queries
   */
  getMostFrequent(limit: number = 10): Array<{ query: string; count: number }> {
    const frequency = new Map<string, number>();

    this.metrics.forEach((metric) => {
      const count = frequency.get(metric.query) || 0;
      frequency.set(metric.query, count + 1);
    });

    return Array.from(frequency.entries())
      .map(([query, count]) => ({ query, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }

  /**
   * Generate performance report
   */
  generateReport(): string {
    const stats = this.getStats();
    const slowQueries = this.getSlowQueries();
    const frequent = this.getMostFrequent(5);

    let report = '=== Database Query Performance Report ===\n\n';

    // Overall stats
    report += `Total Queries: ${this.metrics.length}\n`;
    report += `Slow Queries (>${this.slowQueryThreshold}ms): ${slowQueries.length}\n`;
    report += `Average Query Time: ${(
      stats.reduce((sum, s) => sum + s.averageDuration, 0) / stats.length || 0
    ).toFixed(2)}ms\n\n`;

    // Slowest queries
    report += '=== Top 10 Slowest Queries (by average) ===\n';
    stats.slice(0, 10).forEach((stat, i) => {
      report += `${i + 1}. ${this.truncateQuery(stat.query)}\n`;
      report += `   Avg: ${stat.averageDuration.toFixed(2)}ms | `;
      report += `Max: ${stat.maxDuration.toFixed(2)}ms | `;
      report += `Count: ${stat.count}\n\n`;
    });

    // Most frequent
    report += '=== Top 5 Most Frequent Queries ===\n';
    frequent.forEach((q, i) => {
      report += `${i + 1}. ${this.truncateQuery(q.query)} (${q.count} times)\n`;
    });

    return report;
  }

  /**
   * Print performance report to console
   */
  printReport(): void {
    log.info('Database Query Performance Report', { report: this.generateReport() }, 'QueryPerformance');
  }

  /**
   * Clear all metrics
   */
  clear(): void {
    this.metrics = [];
  }

  /**
   * Enable monitoring
   */
  enable(): void {
    this.enabled = true;
  }

  /**
   * Disable monitoring
   */
  disable(): void {
    this.enabled = false;
  }

  /**
   * Check if monitoring is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Set slow query threshold
   */
  setSlowQueryThreshold(ms: number): void {
    this.slowQueryThreshold = ms;
  }

  /**
   * Normalize query (remove extra whitespace, etc.)
   */
  private normalizeQuery(query: string): string {
    return query.replace(/\s+/g, ' ').trim();
  }

  /**
   * Truncate query for display
   */
  private truncateQuery(query: string, maxLength: number = 100): string {
    if (query.length <= maxLength) return query;
    return query.substring(0, maxLength) + '...';
  }

  /**
   * Export metrics for analysis
   */
  exportMetrics(): QueryMetric[] {
    return [...this.metrics];
  }

  /**
   * Get metrics for specific time range
   */
  getMetricsByTimeRange(startTime: number, endTime: number): QueryMetric[] {
    return this.metrics.filter(
      (m) => m.timestamp >= startTime && m.timestamp <= endTime
    );
  }
}

// Singleton instance
export const queryPerformance = new QueryPerformanceMonitor();

/**
 * Decorator for monitoring query performance
 */
export function monitorQuery(queryName?: string) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;
    const name = queryName || `${target.constructor.name}.${propertyKey}`;

    descriptor.value = async function (...args: any[]) {
      return queryPerformance.measure(
        () => originalMethod.apply(this, args),
        name,
        args
      );
    };

    return descriptor;
  };
}

/**
 * Utility to wrap a query function with performance tracking
 */
export async function trackQuery<T>(
  queryName: string,
  queryFn: () => Promise<T>,
  params?: any
): Promise<T> {
  return queryPerformance.measure(queryFn, queryName, params);
}

/**
 * N+1 Query Detector
 * Detects potential N+1 query problems by looking for repeated similar queries
 */
export class N1QueryDetector {
  private queryPatterns: Map<string, number[]> = new Map();
  private readonly detectionWindow = 1000; // 1 second window
  private readonly threshold = 5; // Alert if same query runs 5+ times

  /**
   * Track a query and check for N+1 pattern
   */
  track(query: string): void {
    const pattern = this.extractPattern(query);
    const now = Date.now();

    const timestamps = this.queryPatterns.get(pattern) || [];

    // Remove old timestamps outside detection window
    const recent = timestamps.filter((t) => now - t < this.detectionWindow);
    recent.push(now);

    this.queryPatterns.set(pattern, recent);

    // Check for N+1 pattern
    if (recent.length >= this.threshold) {
      log.warn(
        `Query pattern executed ${recent.length} times in ${this.detectionWindow}ms: ${this.truncateQuery(query)}`,
        { count: recent.length, detectionWindow: this.detectionWindow, query: this.truncateQuery(query) },
        'N+1QueryDetected'
      );
    }
  }

  /**
   * Extract query pattern (remove parameter values)
   */
  private extractPattern(query: string): string {
    return query
      .replace(/\$\d+/g, '$?') // Replace $1, $2, etc. with $?
      .replace(/'\w+'/g, "'?'") // Replace string literals
      .replace(/\d+/g, '?') // Replace numbers
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Truncate query for display
   */
  private truncateQuery(query: string, maxLength: number = 100): string {
    if (query.length <= maxLength) return query;
    return query.substring(0, maxLength) + '...';
  }

  /**
   * Clear tracked patterns
   */
  clear(): void {
    this.queryPatterns.clear();
  }

  /**
   * Get detected N+1 patterns
   */
  getDetectedPatterns(): Array<{ pattern: string; count: number }> {
    const now = Date.now();
    const detected: Array<{ pattern: string; count: number }> = [];

    this.queryPatterns.forEach((timestamps, pattern) => {
      const recent = timestamps.filter((t) => now - t < this.detectionWindow);
      if (recent.length >= this.threshold) {
        detected.push({ pattern, count: recent.length });
      }
    });

    return detected.sort((a, b) => b.count - a.count);
  }
}

// Singleton instance
export const n1Detector = new N1QueryDetector();

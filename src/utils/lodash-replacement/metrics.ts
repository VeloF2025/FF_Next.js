/**
 * Performance Monitoring
 * Tracks performance metrics for utility functions
 */

export class LodashReplacementMetrics {
  private static metrics = new Map<string, { calls: number; totalTime: number }>();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  static trackPerformance<T extends (...args: any[]) => any>(
    name: string,
    func: T
  ): T {
    return ((...args: Parameters<T>) => {
      const start = performance.now();
      const result = func(...args);
      const end = performance.now();

      const current = this.metrics.get(name) || { calls: 0, totalTime: 0 };
      this.metrics.set(name, {
        calls: current.calls + 1,
        totalTime: current.totalTime + (end - start)
      });

      return result;
    }) as T;
  }

  static getMetrics(): Record<string, { calls: number; avgTime: number; totalTime: number }> {
    const result: Record<string, { calls: number; avgTime: number; totalTime: number }> = {};

    for (const [name, metrics] of this.metrics) {
      result[name] = {
        calls: metrics.calls,
        totalTime: Math.round(metrics.totalTime * 100) / 100,
        avgTime: Math.round((metrics.totalTime / metrics.calls) * 100) / 100
      };
    }

    return result;
  }

  static resetMetrics(): void {
    this.metrics.clear();
  }
}

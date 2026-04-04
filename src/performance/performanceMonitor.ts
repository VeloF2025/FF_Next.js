/**
 * Performance Monitoring Utilities
 * Tracks Core Web Vitals, bundle sizes, and runtime performance
 */

import * as React from 'react';
import { log } from '@/lib/logger';

// Extended performance entry types for Web Vitals
interface LayoutShift extends PerformanceEntry {
  value: number;
  hadRecentInput: boolean;
}


// Core Web Vitals tracking
export interface CoreWebVitals {
  LCP: number; // Largest Contentful Paint
  FID: number; // First Input Delay
  CLS: number; // Cumulative Layout Shift
  FCP: number; // First Contentful Paint
  TTI: number; // Time to Interactive
  TTFB: number; // Time to First Byte
}

export interface PerformanceMetrics {
  coreWebVitals: Partial<CoreWebVitals>;
  bundleSize: number;
  loadTime: number;
  renderTime: number;
  memoryUsage: number;
  timestamp: number;
}

class PerformanceMonitor {
  private metrics: PerformanceMetrics[] = [];
  private observer: PerformanceObserver | null = null;
  private readonly maxMetricsHistory = 50;

  constructor() {
    this.initializeWebVitalsTracking();
    this.initializeMemoryTracking();
  }

  /**
   * Initialize Core Web Vitals tracking
   */
  private initializeWebVitalsTracking() {
    if (typeof window === 'undefined' || !window.PerformanceObserver) {
      return;
    }

    try {
      // Track LCP (Largest Contentful Paint)
      this.trackLCP();
      
      // Track FID (First Input Delay)
      this.trackFID();
      
      // Track CLS (Cumulative Layout Shift)
      this.trackCLS();
      
      // Track FCP (First Contentful Paint)
      this.trackFCP();
      
      // Track navigation timing
      this.trackNavigationTiming();
    } catch (error) {
      log.warn('Performance tracking not supported:', { data: error }, 'performanceMonitor');
    }
  }

  private trackLCP() {
    const observer = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const lastEntry = entries[entries.length - 1];
      this.updateMetric('LCP', lastEntry.startTime);
    });
    
    observer.observe({ entryTypes: ['largest-contentful-paint'] });
  }

  private trackFID() {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        // Type assertion for first-input performance entry
        const firstInputEntry = entry as any;
        this.updateMetric('FID', firstInputEntry.processingStart || entry.startTime - entry.startTime);
      }
    });
    
    observer.observe({ entryTypes: ['first-input'] });
  }

  private trackCLS() {
    let clsValue = 0;
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        // Type assertion for layout-shift performance entry
        const layoutShiftEntry = entry as LayoutShift;
        if (!layoutShiftEntry.hadRecentInput) {
          clsValue += layoutShiftEntry.value;
          this.updateMetric('CLS', clsValue);
        }
      }
    });
    
    observer.observe({ entryTypes: ['layout-shift'] });
  }

  private trackFCP() {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.name === 'first-contentful-paint') {
          this.updateMetric('FCP', entry.startTime);
        }
      }
    });
    
    observer.observe({ entryTypes: ['paint'] });
  }

  private trackNavigationTiming() {
    if (window.performance && window.performance.getEntriesByType) {
      const navTiming = window.performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
      if (navTiming) {
        this.updateMetric('TTFB', navTiming.responseStart - navTiming.fetchStart);
        
        // Estimate TTI (simplified)
        const tti = navTiming.domContentLoadedEventEnd - navTiming.fetchStart;
        this.updateMetric('TTI', tti);
      }
    }
  }

  private updateMetric(name: keyof CoreWebVitals, value: number) {
    const currentMetrics = this.getCurrentMetrics();
    currentMetrics.coreWebVitals[name] = value;
    this.recordMetrics(currentMetrics);
  }

  /**
   * Track memory usage
   */
  private initializeMemoryTracking() {
    if (typeof window !== 'undefined' && 'performance' in window && 'memory' in window.performance) {
      setInterval(() => {
        const memInfo = (window.performance as any).memory;
        if (memInfo) {
          const memoryUsage = memInfo.usedJSHeapSize / (1024 * 1024); // MB
          this.updateMemoryUsage(memoryUsage);
        }
      }, 10000); // Every 10 seconds
    }
  }

  private updateMemoryUsage(memoryUsage: number) {
    const currentMetrics = this.getCurrentMetrics();
    currentMetrics.memoryUsage = memoryUsage;
  }

  /**
   * Get current performance metrics
   */
  private getCurrentMetrics(): PerformanceMetrics {
    return {
      coreWebVitals: {},
      bundleSize: this.estimateBundleSize(),
      loadTime: window.performance?.now() || 0,
      renderTime: 0,
      memoryUsage: 0,
      timestamp: Date.now()
    };
  }

  /**
   * Estimate bundle size from loaded resources
   */
  private estimateBundleSize(): number {
    if (typeof window === 'undefined' || !window.performance) return 0;
    
    const resources = window.performance.getEntriesByType('resource') as PerformanceResourceTiming[];
    let totalSize = 0;
    
    resources.forEach(resource => {
      if (resource.name.includes('.js') || resource.name.includes('.css')) {
        totalSize += resource.transferSize || resource.encodedBodySize || 0;
      }
    });
    
    return Math.round(totalSize / 1024); // KB
  }

  /**
   * Record performance metrics
   */
  private recordMetrics(metrics: PerformanceMetrics) {
    this.metrics.push(metrics);
    
    // Keep only recent metrics
    if (this.metrics.length > this.maxMetricsHistory) {
      this.metrics = this.metrics.slice(-this.maxMetricsHistory);
    }
    
    // Report to analytics if available
    this.reportToAnalytics(metrics);
  }

  /**
   * Report metrics to analytics service
   */
  private reportToAnalytics(metrics: PerformanceMetrics) {
    // Send to your analytics service
    if (window.gtag) {
      // Google Analytics 4
      window.gtag('event', 'performance_metric', {
        custom_map: {
          lcp: metrics.coreWebVitals.LCP,
          fid: metrics.coreWebVitals.FID,
          cls: metrics.coreWebVitals.CLS,
          bundle_size: metrics.bundleSize,
          memory_usage: metrics.memoryUsage
        }
      });
    }
  }

  /**
   * Measure component render time
   */
  measureRender<T>(_componentName: string, renderFn: () => T): T {
    // Performance measurement disabled in production
    const result = renderFn();
    return result;
  }

  /**
   * Measure async operation time
   */
  async measureAsync<T>(_operationName: string, asyncFn: () => Promise<T>): Promise<T> {
    // Performance measurement disabled in production
    try {
      const result = await asyncFn();
      return result;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Get performance report
   */
  getPerformanceReport(): {
    current: PerformanceMetrics;
    average: Partial<CoreWebVitals>;
    trends: { improving: boolean; declining: boolean };
    recommendations: string[];
  } {
    if (this.metrics.length === 0) {
      return {
        current: this.getCurrentMetrics(),
        average: {},
        trends: { improving: false, declining: false },
        recommendations: []
      };
    }

    const current = this.metrics[this.metrics.length - 1];
    const average = this.calculateAverage();
    const trends = this.analyzeTrends();
    const recommendations = this.generateRecommendations(current, average);

    return {
      current,
      average,
      trends,
      recommendations
    };
  }

  private calculateAverage(): Partial<CoreWebVitals> {
    if (this.metrics.length === 0) return {};

    const totals: Partial<CoreWebVitals> = {};
    const counts: Partial<Record<keyof CoreWebVitals, number>> = {};

    this.metrics.forEach(metric => {
      Object.entries(metric.coreWebVitals).forEach(([key, value]) => {
        const k = key as keyof CoreWebVitals;
        if (value != null) {
          totals[k] = (totals[k] || 0) + value;
          counts[k] = (counts[k] || 0) + 1;
        }
      });
    });

    const average: Partial<CoreWebVitals> = {};
    Object.entries(totals).forEach(([key, total]) => {
      const k = key as keyof CoreWebVitals;
      const count = counts[k] || 1;
      average[k] = total / count;
    });

    return average;
  }

  private analyzeTrends(): { improving: boolean; declining: boolean } {
    if (this.metrics.length < 2) {
      return { improving: false, declining: false };
    }

    const recent = this.metrics.slice(-5);
    const older = this.metrics.slice(-10, -5);

    if (recent.length === 0 || older.length === 0) {
      return { improving: false, declining: false };
    }

    const recentAvgLCP = recent.reduce((sum, m) => sum + (m.coreWebVitals.LCP || 0), 0) / recent.length;
    const olderAvgLCP = older.reduce((sum, m) => sum + (m.coreWebVitals.LCP || 0), 0) / older.length;

    return {
      improving: recentAvgLCP < olderAvgLCP * 0.9, // 10% improvement
      declining: recentAvgLCP > olderAvgLCP * 1.1   // 10% regression
    };
  }

  private generateRecommendations(current: PerformanceMetrics, _average: Partial<CoreWebVitals>): string[] {
    const recommendations: string[] = [];

    // LCP recommendations
    if ((current.coreWebVitals.LCP || 0) > 2500) {
      recommendations.push('Optimize images and implement lazy loading to improve LCP');
    }

    // FID recommendations  
    if ((current.coreWebVitals.FID || 0) > 100) {
      recommendations.push('Reduce JavaScript execution time and implement code splitting');
    }

    // CLS recommendations
    if ((current.coreWebVitals.CLS || 0) > 0.1) {
      recommendations.push('Reserve space for images and ads to reduce layout shifts');
    }

    // Bundle size recommendations
    if (current.bundleSize > 500) {
      recommendations.push('Consider code splitting to reduce initial bundle size');
    }

    // Memory recommendations
    if (current.memoryUsage > 50) {
      recommendations.push('Monitor for memory leaks and optimize component re-renders');
    }

    return recommendations;
  }

  /**
   * Cleanup resources
   */
  destroy() {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
  }
}

// Global performance monitor instance
export const performanceMonitor = new PerformanceMonitor();

/**
 * React hook for component performance monitoring
 */
export function usePerformanceMonitor(componentName: string) {
  const _startTime = performance.now();

  React.useEffect(() => {
    // Performance measurement disabled in production
    // const endTime = performance.now();
    // log.debug(`${componentName} mount time: ${(endTime - startTime, undefined, 'performanceMonitor');.toFixed(2)}ms`);
  }, [componentName, _startTime]);

  const measureRender = React.useCallback((renderFn: () => any) => {
    return performanceMonitor.measureRender(componentName, renderFn);
  }, [componentName]);

  return { measureRender };
}

/**
 * Performance decorator for class components
 */
export function withPerformanceMonitoring<P extends Record<string, unknown>>(
  WrappedComponent: React.ComponentType<P>,
  componentName?: string
) {
  const displayName = componentName || WrappedComponent.displayName || WrappedComponent.name || 'Component';

  const EnhancedComponent = React.memo((props: P) => {
    // Performance measurement disabled in production
    
    React.useEffect(() => {
      // log.debug(`${displayName} rendered`, undefined, 'performanceMonitor');
    });

    return React.createElement(WrappedComponent, props);
  });

  EnhancedComponent.displayName = `withPerformanceMonitoring(${displayName})`;
  return EnhancedComponent;
}

// Type augmentation for gtag
declare global {
  interface Window {
    gtag?: (command: string, targetId: string, config?: any) => void;
  }
}

// React is imported at the top of the file
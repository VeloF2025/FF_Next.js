/**
 * Performance Monitoring & Web Vitals
 *
 * Tracks Core Web Vitals and custom performance metrics
 *
 * Core Web Vitals:
 * - LCP (Largest Contentful Paint) - Loading performance
 * - FID (First Input Delay) - Interactivity
 * - CLS (Cumulative Layout Shift) - Visual stability
 * - TTFB (Time to First Byte) - Server response time
 * - FCP (First Contentful Paint) - Initial render
 */

import type { NextWebVitalsMetric } from 'next/app';
import { log } from '@/lib/logger';

// Non-standard browser APIs (Chrome-specific)
interface PerformanceMemory {
  jsHeapSizeLimit: number;
  totalJSHeapSize: number;
  usedJSHeapSize: number;
}

interface NetworkInformation {
  effectiveType?: string;
  downlink?: number;
  rtt?: number;
  saveData?: boolean;
}

// Performance thresholds (in milliseconds or score)
export const THRESHOLDS = {
  // Core Web Vitals
  LCP: { good: 2500, poor: 4000 },      // Largest Contentful Paint
  FID: { good: 100, poor: 300 },        // First Input Delay
  CLS: { good: 0.1, poor: 0.25 },       // Cumulative Layout Shift (score)
  TTFB: { good: 600, poor: 1500 },      // Time to First Byte
  FCP: { good: 1800, poor: 3000 },      // First Contentful Paint
  INP: { good: 200, poor: 500 },        // Interaction to Next Paint
} as const;

/**
 * Calculate rating based on value and thresholds
 */
function getRating(
  value: number,
  thresholds: { good: number; poor: number }
): 'good' | 'needs-improvement' | 'poor' {
  if (value <= thresholds.good) return 'good';
  if (value <= thresholds.poor) return 'needs-improvement';
  return 'poor';
}

/**
 * Send metrics to analytics endpoint
 */
async function sendToAnalytics(metric: WebVitalsMetric): Promise<void> {
  // Only send in production
  if (process.env.NODE_ENV !== 'production') {
    log.debug('performance', { action: 'web-vitals-metric', metric });
    return;
  }

  try {
    // Send to Vercel Analytics (if available)
    if (typeof window !== 'undefined' && 'va' in window) {
      (window as unknown as { va?: (event: string, name: string, data: WebVitalsMetric) => void }).va?.('track', 'web-vitals', metric);
    }

    // Send to custom analytics endpoint
    await fetch('/api/analytics/web-vitals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(metric),
      // Don't wait for response
      keepalive: true,
    }).catch(() => {
      // Silently fail - don't impact user experience
    });
  } catch (error) {
    // Silently fail - performance tracking shouldn't break the app
    log.error('performance', { action: 'send-metric-failed', error });
  }
}

/**
 * Extended Web Vitals metric with additional context
 */
export interface WebVitalsMetric {
  id: string;
  name: 'FCP' | 'LCP' | 'CLS' | 'FID' | 'TTFB' | 'INP';
  value: number;
  rating: 'good' | 'needs-improvement' | 'poor';
  delta: number;
  navigationType: string;
  pathname: string;
  timestamp: number;
}

/**
 * Report Web Vitals metrics
 *
 * Automatically called by Next.js when metrics are available
 */
export function reportWebVitals(metric: NextWebVitalsMetric): void {
  // Extend metric with additional context
  const extendedMetric: WebVitalsMetric = {
    id: metric.id,
    name: metric.name as WebVitalsMetric['name'],
    value: metric.value,
    rating: 'good', // Will be calculated below
    delta: metric.value,
    navigationType: getNavigationType(),
    pathname: window.location.pathname,
    timestamp: Date.now(),
  };

  // Calculate rating based on metric type
  switch (metric.name) {
    case 'LCP':
      extendedMetric.rating = getRating(metric.value, THRESHOLDS.LCP);
      break;
    case 'FID':
      extendedMetric.rating = getRating(metric.value, THRESHOLDS.FID);
      break;
    case 'CLS':
      extendedMetric.rating = getRating(metric.value, THRESHOLDS.CLS);
      break;
    case 'TTFB':
      extendedMetric.rating = getRating(metric.value, THRESHOLDS.TTFB);
      break;
    case 'FCP':
      extendedMetric.rating = getRating(metric.value, THRESHOLDS.FCP);
      break;
    case 'INP':
      extendedMetric.rating = getRating(metric.value, THRESHOLDS.INP);
      break;
  }

  // Send to analytics
  sendToAnalytics(extendedMetric);

  // Log poor metrics in development
  if (process.env.NODE_ENV === 'development' && extendedMetric.rating === 'poor') {
    log.error('performance', {
      action: 'poor-metric',
      metricName: metric.name,
      value: `${metric.value.toFixed(2)}ms`,
      threshold: `${getThreshold(metric.name)}ms`,
    });
  }
}

/**
 * Get threshold for a metric
 */
function getThreshold(metricName: string): number {
  const thresholds = THRESHOLDS[metricName as keyof typeof THRESHOLDS];
  return thresholds?.poor ?? 0;
}

/**
 * Get navigation type
 */
function getNavigationType(): string {
  if (typeof window === 'undefined') return 'unknown';

  const navEntry = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
  return navEntry?.type ?? 'unknown';
}

/**
 * Custom performance measurement utilities
 */
export const performanceMetrics = {
  /**
   * Mark the start of a custom metric
   */
  startMeasure(name: string): void {
    if (typeof window !== 'undefined' && 'performance' in window) {
      performance.mark(`${name}-start`);
    }
  },

  /**
   * Mark the end and measure a custom metric
   */
  endMeasure(name: string): number | null {
    if (typeof window === 'undefined' || !('performance' in window)) {
      return null;
    }

    try {
      performance.mark(`${name}-end`);
      const measure = performance.measure(name, `${name}-start`, `${name}-end`);

      // Log in development
      if (process.env.NODE_ENV === 'development') {
        log.debug('performance', {
          action: 'custom-measure',
          name,
          duration: `${measure.duration.toFixed(2)}ms`,
        });
      }

      return measure.duration;
    } catch (error) {
      log.error('performance', { action: 'measure-failed', name, error });
      return null;
    }
  },

  /**
   * Measure async operation
   */
  async measureAsync<T>(name: string, fn: () => Promise<T>): Promise<T> {
    this.startMeasure(name);
    try {
      const result = await fn();
      this.endMeasure(name);
      return result;
    } catch (error) {
      this.endMeasure(name);
      throw error;
    }
  },

  /**
   * Measure sync operation
   */
  measureSync<T>(name: string, fn: () => T): T {
    this.startMeasure(name);
    try {
      const result = fn();
      this.endMeasure(name);
      return result;
    } catch (error) {
      this.endMeasure(name);
      throw error;
    }
  },

  /**
   * Get resource timing for a specific resource
   */
  getResourceTiming(url: string): PerformanceResourceTiming | undefined {
    if (typeof window === 'undefined') return undefined;

    const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
    return resources.find((entry) => entry.name.includes(url));
  },

  /**
   * Get all long tasks (>50ms)
   */
  getLongTasks(): PerformanceEntry[] {
    if (typeof window === 'undefined') return [];

    try {
      return performance.getEntriesByType('longtask');
    } catch {
      return [];
    }
  },

  /**
   * Clear all marks and measures
   */
  clear(): void {
    if (typeof window !== 'undefined' && 'performance' in window) {
      performance.clearMarks();
      performance.clearMeasures();
    }
  },
};

/**
 * Get current performance metrics snapshot
 */
export function getPerformanceSnapshot(): {
  navigation: PerformanceNavigationTiming | null;
  memory?: PerformanceMemory;
  connectionInfo?: NetworkInformation;
} {
  if (typeof window === 'undefined') {
    return { navigation: null };
  }

  const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;

  return {
    navigation,
    memory: (performance as unknown as { memory?: PerformanceMemory }).memory,
    connectionInfo: (navigator as unknown as { connection?: NetworkInformation }).connection,
  };
}

/**
 * Monitor FPS (Frames Per Second)
 */
export function monitorFPS(callback: (fps: number) => void): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  let lastTime = performance.now();
  let frames = 0;
  let rafId: number;

  function measureFPS() {
    const currentTime = performance.now();
    frames++;

    if (currentTime >= lastTime + 1000) {
      const fps = Math.round((frames * 1000) / (currentTime - lastTime));
      callback(fps);
      frames = 0;
      lastTime = currentTime;
    }

    rafId = requestAnimationFrame(measureFPS);
  }

  rafId = requestAnimationFrame(measureFPS);

  // Return cleanup function
  return () => {
    if (rafId) {
      cancelAnimationFrame(rafId);
    }
  };
}

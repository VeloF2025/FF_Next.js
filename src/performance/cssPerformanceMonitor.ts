/**
 * CSS Performance Monitor
 * Tracks CSS loading performance and identifies bottlenecks
 */

import { log } from '@/lib/logger';

interface CSSMetrics {
  loadTime: number;
  renderTime: number;
  totalRules: number;
  failedImports: string[];
  criticalPath: boolean;
}

interface PerformanceEntry extends Performance {
  getEntriesByType(type: 'paint'): PerformancePaintTiming[];
  getEntriesByType(type: 'navigation'): PerformanceNavigationTiming[];
  getEntriesByType(type: 'resource'): PerformanceResourceTiming[];
}

declare global {
  interface PerformancePaintTiming extends PerformanceEntry {
    name: 'first-paint' | 'first-contentful-paint';
    startTime: number;
  }
}

class CSSPerformanceMonitor {
  private metrics: Map<string, CSSMetrics> = new Map();
  private observer: MutationObserver | null = null;
  // startTime removed - not used in current implementation

  constructor() {
    this.initializeMonitoring();
  }

  private initializeMonitoring(): void {
    // Monitor CSS loading
    this.trackCSSLoading();
    
    // Monitor DOM changes for style computation
    this.trackStyleChanges();
    
    // Monitor critical rendering path
    this.trackCriticalPath();
  }

  private trackCSSLoading(): void {
    // Track all CSS file loading
    const cssFiles = Array.from(document.querySelectorAll('link[rel="stylesheet"]'));
    
    cssFiles.forEach((link) => {
      const href = (link as HTMLLinkElement).href;
      const startTime = performance.now();
      
      (link as HTMLLinkElement).addEventListener('load', () => {
        const loadTime = performance.now() - startTime;
        this.recordMetric(href, { loadTime, type: 'css-file' });
      });

      (link as HTMLLinkElement).addEventListener('error', () => {
        this.recordError(href, 'Failed to load CSS file');
      });
    });

    // Track inline styles processing
    this.trackInlineStyles();
  }

  private trackInlineStyles(): void {
    const inlineStyles = Array.from(document.querySelectorAll('style'));
    
    inlineStyles.forEach((style, index) => {
      const startTime = performance.now();
      const rules = style.sheet?.cssRules?.length || 0;
      const processTime = performance.now() - startTime;
      
      this.recordMetric(`inline-style-${index}`, {
        loadTime: processTime,
        totalRules: rules,
        type: 'inline-style'
      });
    });
  }

  private trackStyleChanges(): void {
    this.observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'childList') {
          const addedNodes = Array.from(mutation.addedNodes);
          addedNodes.forEach((node) => {
            if (node.nodeType === Node.ELEMENT_NODE) {
              const element = node as Element;
              if (element.tagName === 'STYLE' || element.tagName === 'LINK') {
                this.trackNewStyleElement(element);
              }
            }
          });
        }
      });
    });

    this.observer.observe(document.head, {
      childList: true,
      subtree: true
    });
  }

  private trackNewStyleElement(element: Element): void {
    if (element.tagName === 'LINK' && (element as HTMLLinkElement).rel === 'stylesheet') {
      const href = (element as HTMLLinkElement).href;
      const startTime = performance.now();
      
      (element as HTMLLinkElement).addEventListener('load', () => {
        const loadTime = performance.now() - startTime;
        this.recordMetric(href, { loadTime, type: 'dynamic-css' });
      });
    }
  }

  private trackCriticalPath(): void {
    // Monitor First Contentful Paint
    if ('PerformanceObserver' in window) {
      const perfObserver = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        entries.forEach((entry) => {
          if (entry.name === 'first-contentful-paint') {
            this.recordMetric('first-contentful-paint', {
              loadTime: entry.startTime,
              criticalPath: true,
              type: 'paint-timing'
            });
          }
        });
      });
      
      perfObserver.observe({ entryTypes: ['paint'] });
    }
  }

  private recordMetric(key: string, data: Partial<CSSMetrics> & { lastUpdated?: number }): void {
    const existing = this.metrics.get(key) || {
      loadTime: 0,
      renderTime: 0,
      totalRules: 0,
      failedImports: [],
      criticalPath: false
    };

    this.metrics.set(key, {
      ...existing,
      ...data,
      lastUpdated: Date.now()
    });

    // Log performance issues
    if (data.loadTime > 1000) { // > 1 second
      log.warn('Slow CSS loading detected', { key, loadTime: data.loadTime }, 'CSSPerformanceMonitor');
    }
  }

  private recordError(key: string, error: string): void {
    const existing = this.metrics.get(key) || {
      loadTime: 0,
      renderTime: 0,
      totalRules: 0,
      failedImports: [],
      criticalPath: false
    };

    existing.failedImports.push(error);
    this.metrics.set(key, existing);

    log.error('CSS loading error', { key, error }, 'CSSPerformanceMonitor');
  }

  public getMetrics(): Map<string, CSSMetrics> {
    return new Map(this.metrics);
  }

  public getPerformanceReport(): {
    totalCSSLoadTime: number;
    slowestFile: string;
    failedImports: string[];
    recommendations: string[];
  } {
    let totalLoadTime = 0;
    let slowestFile = '';
    let slowestTime = 0;
    const failedImports: string[] = [];
    const recommendations: string[] = [];

    this.metrics.forEach((metric, key) => {
      totalLoadTime += metric.loadTime;
      
      if (metric.loadTime > slowestTime) {
        slowestTime = metric.loadTime;
        slowestFile = key;
      }

      failedImports.push(...metric.failedImports);
    });

    // Generate recommendations
    if (slowestTime > 1000) {
      recommendations.push(`Consider optimizing ${slowestFile} (${slowestTime.toFixed(2)}ms)`);
    }
    
    if (totalLoadTime > 2000) {
      recommendations.push('Consider implementing critical CSS splitting');
    }
    
    if (failedImports.length > 0) {
      recommendations.push('Fix failed CSS imports to improve performance');
    }

    return {
      totalCSSLoadTime: totalLoadTime,
      slowestFile,
      failedImports,
      recommendations
    };
  }

  public destroy(): void {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
  }
}

// Auto-initialize in development mode
let cssMonitor: CSSPerformanceMonitor | null = null;

if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  cssMonitor = new CSSPerformanceMonitor();
  
  // Add to window for debugging
  (window as Window & { __cssPerformanceMonitor?: CSSPerformanceMonitor }).__cssPerformanceMonitor = cssMonitor;
  
  // Auto-report after 5 seconds
  setTimeout(() => {
    if (cssMonitor) {
      const report = cssMonitor.getPerformanceReport();
      log.info('CSS Performance Report', {
        totalCSSLoadTime: `${report.totalCSSLoadTime.toFixed(2)}ms`,
        slowestFile: report.slowestFile,
        failedImports: report.failedImports,
        recommendations: report.recommendations
      }, 'CSSPerformanceMonitor');
    }
  }, 5000);
}

export { CSSPerformanceMonitor, cssMonitor };
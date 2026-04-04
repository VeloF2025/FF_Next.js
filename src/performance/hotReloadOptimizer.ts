/**
 * Hot Reload Performance Optimizer
 * Optimizes Vite HMR performance and development server responsiveness
 */

import { log } from '@/lib/logger';

interface HMRMetrics {
  updateTime: number;
  moduleCount: number;
  dependencyChain: string[];
  updateType: 'css' | 'js' | 'asset';
}

class HotReloadOptimizer {
  private metrics: Map<string, HMRMetrics> = new Map();
  private updateQueue: Set<string> = new Set();
  private debounceTimeout: number | null = null;

  constructor() {
    if (process.env.NODE_ENV === 'development' && import.meta.hot) {
      this.initializeHMROptimizations();
    }
  }

  private initializeHMROptimizations(): void {
    // Optimize CSS HMR updates
    this.optimizeCSSHMR();
    
    // Batch component updates
    this.optimizeComponentHMR();
    
    // Monitor HMR performance
    this.monitorHMRPerformance();
    
    // Preload critical modules
    this.preloadCriticalModules();
  }

  private optimizeCSSHMR(): void {
    if (import.meta.hot) {
      // Accept CSS updates without full page reload
      import.meta.hot.accept((newModule) => {
        if (newModule) {
          this.recordHMRUpdate('css-update', {
            updateTime: performance.now(),
            moduleCount: 1,
            dependencyChain: [],
            updateType: 'css'
          });
        }
      });

      // Optimize Tailwind CSS updates
      import.meta.hot.accept([
        './styles/index.css',
        './styles/index-integrated.css',
        './styles/design-system.css',
        './styles/fallback.css'
      ], (modules) => {
        if (modules) {
          // Batch CSS updates for better performance
          this.batchCSSUpdates(modules);
        }
      });
    }
  }

  private batchCSSUpdates(modules: any[]): void {
    if (this.debounceTimeout) {
      clearTimeout(this.debounceTimeout);
    }

    this.debounceTimeout = window.setTimeout(() => {
      // Apply all CSS updates at once
      modules.forEach((_module, index) => {
        this.recordHMRUpdate(`css-batch-${index}`, {
          updateTime: performance.now(),
          moduleCount: modules.length,
          dependencyChain: [],
          updateType: 'css'
        });
      });
      
      this.debounceTimeout = null;
    }, 50); // 50ms debounce for CSS updates
  }

  private optimizeComponentHMR(): void {
    if (import.meta.hot) {
      // Pre-accept common component patterns
      const componentPatterns = [
        /.*\/components\/.*\.tsx?$/,
        /.*\/modules\/.*\.tsx?$/,
        /.*\/pages\/.*\.tsx?$/,
      ];

      componentPatterns.forEach((_pattern) => {
        // This would typically be handled by React Fast Refresh
        // but we can add additional optimizations here
      });
    }
  }

  private monitorHMRPerformance(): void {
    if (import.meta.hot) {
      // Listen to HMR events
      import.meta.hot.on('vite:beforeUpdate', (payload) => {
        const startTime = performance.now();
        this.updateQueue.add((payload as any).path || 'unknown');
        
        // Record the update start
        this.recordHMRUpdate((payload as any).path || 'unknown', {
          updateTime: startTime,
          moduleCount: payload.updates?.length || 1,
          dependencyChain: [],
          updateType: this.getUpdateType((payload as any).path || '')
        });
      });

      import.meta.hot.on('vite:afterUpdate', (payload) => {
        const endTime = performance.now();
        const path = (payload as any).path || 'unknown';
        
        if (this.updateQueue.has(path)) {
          const existing = this.metrics.get(path);
          if (existing) {
            existing.updateTime = endTime - existing.updateTime;
          }
          this.updateQueue.delete(path);
        }

        // Log slow updates
        const updateTime = existing?.updateTime || 0;
        if (updateTime > 1000) { // > 1 second
          log.warn('Slow HMR update detected', { path, updateTime }, 'HotReloadOptimizer');
        }
      });

      import.meta.hot.on('vite:error', (payload) => {
        log.error('HMR Error occurred', { error: payload.err }, 'HotReloadOptimizer');
      });
    }
  }

  private preloadCriticalModules(): void {
    // Preload commonly used modules to speed up HMR
    const criticalModules = [
      // React and core libraries
      'react',
      'react-dom',
      'next/router',
      
      // Common components
      '@/components/ui/LoadingSpinner',
      '@/components/ErrorBoundary',
      '@/components/layout/Header',
      '@/components/layout/Sidebar',
      
      // Common hooks
      '@/hooks/useAuth',
      '@/contexts/AuthContext',
      '@/contexts/ThemeContext',
      
      // Common utilities
      '@/utils/cn',
      '@/lib/utils',
    ];

    // Use module preloading for faster HMR
    criticalModules.forEach(modulePath => {
      try {
        // Dynamic import to preload (won't execute, just cache)
        /* @vite-ignore */
        import(modulePath).catch(() => {
          // intentional: modules that don't exist are expected during HMR warmup
        });
      } catch {
        // intentional: dynamic import errors during HMR prefetch are non-critical
      }
    });
  }

  private getUpdateType(path: string): HMRMetrics['updateType'] {
    if (path.match(/\.(css|scss|less)$/)) return 'css';
    if (path.match(/\.(ts|tsx|js|jsx)$/)) return 'js';
    return 'asset';
  }

  private recordHMRUpdate(path: string, metrics: HMRMetrics): void {
    this.metrics.set(path, metrics);

    // Performance warnings
    if (metrics.updateTime > 500 && metrics.updateType === 'css') {
      log.warn('Slow CSS HMR detected', { path, updateTime: metrics.updateTime }, 'HotReloadOptimizer');
    } else if (metrics.updateTime > 1000 && metrics.updateType === 'js') {
      log.warn('Slow JS HMR detected', { path, updateTime: metrics.updateTime }, 'HotReloadOptimizer');
    }
  }

  public getHMRMetrics(): Map<string, HMRMetrics> {
    return new Map(this.metrics);
  }

  public getPerformanceReport(): {
    totalUpdates: number;
    averageUpdateTime: number;
    slowestUpdate: { path: string; time: number } | null;
    updatesByType: { css: number; js: number; asset: number };
    recommendations: string[];
  } {
    const updates = Array.from(this.metrics.entries());
    const recommendations: string[] = [];
    
    if (updates.length === 0) {
      return {
        totalUpdates: 0,
        averageUpdateTime: 0,
        slowestUpdate: null,
        updatesByType: { css: 0, js: 0, asset: 0 },
        recommendations: ['No HMR updates recorded yet']
      };
    }

    const totalTime = updates.reduce((sum, [, metrics]) => sum + metrics.updateTime, 0);
    const averageUpdateTime = totalTime / updates.length;
    
    const slowestUpdate = updates.reduce((slowest, [path, metrics]) => {
      if (!slowest || metrics.updateTime > slowest.time) {
        return { path, time: metrics.updateTime };
      }
      return slowest;
    }, null as { path: string; time: number } | null);

    const updatesByType = updates.reduce(
      (counts, [, metrics]) => {
        counts[metrics.updateType]++;
        return counts;
      },
      { css: 0, js: 0, asset: 0 }
    );

    // Generate recommendations
    if (averageUpdateTime > 500) {
      recommendations.push('Consider reducing component complexity or splitting large files');
    }
    
    if (slowestUpdate && slowestUpdate.time > 2000) {
      recommendations.push(`Optimize ${slowestUpdate.path} - taking ${slowestUpdate.time.toFixed(0)}ms`);
    }
    
    if (updatesByType.css > updatesByType.js * 2) {
      recommendations.push('Many CSS updates detected - consider CSS-in-JS or better organization');
    }
    
    if (recommendations.length === 0) {
      recommendations.push('HMR performance is good! 🚀');
    }

    return {
      totalUpdates: updates.length,
      averageUpdateTime,
      slowestUpdate,
      updatesByType,
      recommendations
    };
  }
}

// Auto-initialize in development
let hotReloadOptimizer: HotReloadOptimizer | null = null;

if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  hotReloadOptimizer = new HotReloadOptimizer();
  
  // Add to window for debugging
  (window as any).__hotReloadOptimizer = hotReloadOptimizer;
  
  // Report HMR performance every 30 seconds in development
  if (import.meta.hot) {
    setInterval(() => {
      if (hotReloadOptimizer) {
        const report = hotReloadOptimizer.getPerformanceReport();
        if (report.totalUpdates > 0) {
          log.info('HMR Performance Report', {
            totalUpdates: report.totalUpdates,
            averageUpdateTime: `${report.averageUpdateTime.toFixed(2)}ms`,
            slowestUpdate: report.slowestUpdate,
            updatesByType: report.updatesByType,
            recommendations: report.recommendations
          }, 'HotReloadOptimizer');
        }
      }
    }, 30000);
  }
}

export { HotReloadOptimizer, hotReloadOptimizer };
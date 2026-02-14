/**
 * Lazy Loading Utilities
 * Story 3.3: Frontend Performance Optimization
 *
 * Utilities for code splitting and lazy loading components
 */

import dynamic from 'next/dynamic';
import { ComponentType, lazy, Suspense } from 'react';
import { log } from '@/lib/logger';

/**
 * Loading fallback component
 */
export function LoadingFallback({ message = 'Loading...' }: { message?: string }) {
  return (
    <div className="flex items-center justify-center p-8">
      <div className="text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto mb-2"></div>
        <p className="text-sm text-gray-500 dark:text-gray-400">{message}</p>
      </div>
    </div>
  );
}

/**
 * Lazy load a component with Next.js dynamic import
 *
 * Benefits:
 * - Automatic code splitting
 * - Loading states
 * - SSR control
 *
 * @example
 * const HeavyChart = lazyLoad(() => import('./HeavyChart'));
 */
export function lazyLoad<T extends ComponentType<any>>(
  importFunc: () => Promise<{ default: T }>,
  options?: {
    loading?: ComponentType;
    ssr?: boolean;
    loadingMessage?: string;
  }
) {
  return dynamic(importFunc, {
    loading: options?.loading || (() => <LoadingFallback message={options?.loadingMessage} />),
    ssr: options?.ssr ?? true,
  });
}

/**
 * Lazy load with custom loading component
 */
export function lazyLoadWithLoader<T extends ComponentType<any>>(
  importFunc: () => Promise<{ default: T }>,
  LoadingComponent: ComponentType
) {
  return dynamic(importFunc, {
    loading: LoadingComponent,
    ssr: true,
  });
}

/**
 * Lazy load without SSR (client-side only)
 * Use for components that rely on browser APIs
 */
export function lazyLoadClient<T extends ComponentType<any>>(
  importFunc: () => Promise<{ default: T }>,
  loadingMessage?: string
) {
  return dynamic(importFunc, {
    loading: () => <LoadingFallback message={loadingMessage} />,
    ssr: false,
  });
}

/**
 * Preload a component
 * Useful for prefetching components before they're needed
 *
 * @example
 * // Preload on hover
 * <button onMouseEnter={() => preload(() => import('./Modal'))}>
 *   Open Modal
 * </button>
 */
export async function preload<T>(
  importFunc: () => Promise<{ default: T }>
): Promise<void> {
  try {
    await importFunc();
  } catch (error) {
    log.warn('Failed to preload component', error instanceof Error ? { message: error.message } : { error }, 'Preload');
  }
}

/**
 * Lazy load multiple components at once
 * Returns an object with all components
 */
export function lazyLoadMultiple<T extends Record<string, () => Promise<{ default: any }>>>(
  imports: T
): Record<keyof T, ReturnType<typeof dynamic>> {
  const components = {} as Record<keyof T, ReturnType<typeof dynamic>>;

  for (const [key, importFunc] of Object.entries(imports)) {
    components[key as keyof T] = lazyLoad(importFunc);
  }

  return components;
}

/**
 * Suspense wrapper with custom loading
 */
export function SuspenseWithLoading({
  children,
  fallback,
  message = 'Loading...',
}: {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  message?: string;
}) {
  return (
    <Suspense fallback={fallback || <LoadingFallback message={message} />}>
      {children}
    </Suspense>
  );
}

/**
 * Route-based code splitting helper
 * For lazy loading entire pages/routes
 */
export function lazyRoute<T extends ComponentType<any>>(
  importFunc: () => Promise<{ default: T }>
) {
  return lazyLoad(importFunc, {
    loadingMessage: 'Loading page...',
  });
}

/**
 * Module-based code splitting
 * For lazy loading feature modules
 */
export function lazyModule<T extends ComponentType<any>>(
  importFunc: () => Promise<{ default: T }>,
  moduleName: string
) {
  return lazyLoad(importFunc, {
    loadingMessage: `Loading ${moduleName}...`,
  });
}

/**
 * Conditional lazy loading
 * Only loads component if condition is true
 *
 * @example
 * const HeavyFeature = conditionalLazy(
 *   () => import('./HeavyFeature'),
 *   userHasPermission
 * );
 */
export function conditionalLazy<T extends ComponentType<any>>(
  importFunc: () => Promise<{ default: T }>,
  condition: boolean
) {
  if (!condition) {
    return () => null;
  }
  return lazyLoad(importFunc);
}

/**
 * Retry lazy loading on failure
 * Useful for handling network errors
 */
export function lazyLoadWithRetry<T extends ComponentType<any>>(
  importFunc: () => Promise<{ default: T }>,
  retries: number = 3
) {
  return lazyLoad(async () => {
    let lastError: Error | null = null;

    for (let i = 0; i < retries; i++) {
      try {
        return await importFunc();
      } catch (error) {
        lastError = error as Error;
        // Wait before retrying (exponential backoff)
        await new Promise((resolve) => setTimeout(resolve, Math.pow(2, i) * 1000));
      }
    }

    throw lastError || new Error('Failed to load component');
  });
}

/**
 * Prefetch multiple components
 * Useful for prefetching related components
 */
export async function prefetchComponents(
  imports: Array<() => Promise<any>>
): Promise<void> {
  await Promise.all(imports.map((importFunc) => preload(importFunc)));
}

/**
 * Check if code splitting is supported
 */
export function isCodeSplittingSupported(): boolean {
  return typeof window !== 'undefined' && 'import' in Function.prototype;
}

/**
 * Get loading statistics
 * For debugging and monitoring
 */
export class LazyLoadMonitor {
  private static loadTimes: Map<string, number> = new Map();

  static trackLoad(name: string, duration: number): void {
    this.loadTimes.set(name, duration);
  }

  static getLoadTime(name: string): number | undefined {
    return this.loadTimes.get(name);
  }

  static getAllLoadTimes(): Record<string, number> {
    return Object.fromEntries(this.loadTimes.entries());
  }

  static clear(): void {
    this.loadTimes.clear();
  }
}

/**
 * Monitored lazy load
 * Tracks loading time for performance analysis
 */
export function lazyLoadMonitored<T extends ComponentType<any>>(
  importFunc: () => Promise<{ default: T }>,
  name: string
) {
  return lazyLoad(async () => {
    const start = performance.now();
    try {
      const module = await importFunc();
      const duration = performance.now() - start;
      LazyLoadMonitor.trackLoad(name, duration);
      log.info(`${name} loaded in ${duration.toFixed(2)}ms`, { name, duration }, 'LazyLoad');
      return module;
    } catch (error) {
      log.error(`Failed to load ${name}`, error instanceof Error ? { message: error.message } : { error }, 'LazyLoad');
      throw error;
    }
  });
}

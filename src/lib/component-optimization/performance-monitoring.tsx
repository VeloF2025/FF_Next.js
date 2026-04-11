/**
 * Performance Monitoring Utilities
 * Development tools for tracking component performance
 */

import { ComponentType, useRef, useEffect } from 'react';
import { log } from '@/lib/logger';

/**
 * Performance monitor component
 * Logs render times in development
 */
export function withPerformanceMonitor<P extends object>(
  Component: ComponentType<P>,
  name: string
): ComponentType<P> {
  if (process.env.NODE_ENV !== 'development') {
    return Component;
  }

  return function PerformanceMonitoredComponent(props: P) {
    const renderCount = useRef(0);
    const startTime = useRef(0);

    useEffect(() => {
      renderCount.current++;
      const renderTime = performance.now() - startTime.current;
      log.debug(
        `${name} render #${renderCount.current}: ${renderTime.toFixed(2)}ms`,
        { renderCount: renderCount.current, renderTime },
        'Performance'
      );
    });

    startTime.current = performance.now();

    return <Component {...props} />;
  };
}

/**
 * Render count tracker
 * For debugging unnecessary re-renders
 */
export function useRenderCount(componentName: string) {
  const renderCount = useRef(0);

  useEffect(() => {
    renderCount.current++;
    if (process.env.NODE_ENV === 'development') {
      log.debug(`${componentName}: ${renderCount.current}`, { renderCount: renderCount.current }, 'RenderCount');
    }
  });

  return renderCount.current;
}

/**
 * Why did you update hook
 * Logs which props caused a re-render
 */
export function useWhyDidYouUpdate(name: string, props: Record<string, any>) {
  const previousProps = useRef<Record<string, any>>();

  useEffect(() => {
    if (previousProps.current && process.env.NODE_ENV === 'development') {
      const allKeys = Object.keys({ ...previousProps.current, ...props });
      const changedProps: Record<string, { from: any; to: any }> = {};

      allKeys.forEach((key) => {
        if (previousProps.current![key] !== props[key]) {
          changedProps[key] = {
            from: previousProps.current![key],
            to: props[key],
          };
        }
      });

      if (Object.keys(changedProps).length > 0) {
        log.debug(`${name}`, changedProps, 'WhyDidYouUpdate');
      }
    }

    previousProps.current = props;
  });
}

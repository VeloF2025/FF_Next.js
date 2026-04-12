/**
 * Memoization Utilities
 * React memoization helpers for component optimization
 */

import { memo, ComponentType } from 'react';

/**
 * Deep equality check
 */
function deepEqual(prev: object, next: object): boolean {
  return JSON.stringify(prev) === JSON.stringify(next);
}

/**
 * Deep comparison memo
 * Use for components with complex props
 */
export function deepMemo<T extends ComponentType<object>>(
  Component: T,
  propsAreEqual?: (prev: object, next: object) => boolean
): T {
  return memo(Component, propsAreEqual || deepEqual) as unknown as T;
}

/**
 * Shallow comparison memo (React.memo default behavior)
 * Best for simple props
 */
export function shallowMemo<T extends ComponentType<object>>(Component: T): T {
  return memo(Component) as unknown as T;
}

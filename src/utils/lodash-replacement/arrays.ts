/**
 * Array Utilities
 * High-performance array manipulation functions
 */

/**
 * Flatten array function with performance optimization
 * Replaces lodash.flatten with better performance
 */
export function flatten<T>(array: (T | T[])[]): T[] {
  const result: T[] = [];
  for (const item of array) {
    if (Array.isArray(item)) {
      result.push(...item);
    } else {
      result.push(item);
    }
  }
  return result;
}

/**
 * FlattenDeep function with performance optimization
 * Replaces lodash.flattenDeep with better performance
 */
export function flattenDeep(array: unknown[]): unknown[] {
  const result: unknown[] = [];
  const stack = [...array];

  while (stack.length) {
    const next = stack.pop();
    if (Array.isArray(next)) {
      stack.push(...next);
    } else {
      result.push(next);
    }
  }

  return result.reverse();
}

/**
 * Unique array function with performance optimization
 * Replaces lodash.uniq with better performance
 */
export function uniq<T>(array: T[]): T[] {
  return Array.from(new Set(array));
}

/**
 * UniqueBy function with performance optimization
 * Replaces lodash.uniqBy with better performance
 */
export function uniqBy<T>(array: T[], iteratee: (item: T) => unknown): T[] {
  const seen = new Set();
  const result: T[] = [];

  for (const item of array) {
    const key = iteratee(item);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
  }

  return result;
}

/**
 * Chunk array function with performance optimization
 * Replaces lodash.chunk with better performance
 */
export function chunk<T>(array: T[], size: number): T[][] {
  if (size <= 0) return [];

  const result: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size));
  }
  return result;
}

/**
 * GroupBy function with performance optimization
 * Replaces lodash.groupBy with better performance
 */
export function groupBy<T>(
  array: T[],
  iteratee: (item: T) => string | number
): Record<string, T[]> {
  const result: Record<string, T[]> = {};

  for (const item of array) {
    const key = String(iteratee(item));
    if (!result[key]) {
      result[key] = [];
    }
    result[key].push(item);
  }

  return result;
}

/**
 * KeyBy function with performance optimization
 * Replaces lodash.keyBy with better performance
 */
export function keyBy<T>(
  array: T[],
  iteratee: (item: T) => string | number
): Record<string, T> {
  const result: Record<string, T> = {};

  for (const item of array) {
    const key = String(iteratee(item));
    result[key] = item;
  }

  return result;
}

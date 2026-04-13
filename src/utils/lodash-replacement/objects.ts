/**
 * Object Utilities
 * High-performance object manipulation functions
 */

/**
 * Deep clone function with performance optimization
 * Replaces lodash.cloneDeep with better performance
 */
export function cloneDeep<T>(value: T): T {
  if (value === null || typeof value !== 'object') {
    return value;
  }

  if (value instanceof Date) {
    return new Date(value.getTime()) as unknown as T;
  }

  if (value instanceof Array) {
    return value.map(item => cloneDeep(item)) as unknown as T;
  }

  if (value instanceof Set) {
    return new Set(Array.from(value, item => cloneDeep(item))) as unknown as T;
  }

  if (value instanceof Map) {
    return new Map(Array.from(value, ([k, v]) => [cloneDeep(k), cloneDeep(v)])) as unknown as T;
  }

  if (typeof value === 'object' && value.constructor === Object) {
    const cloned = {} as T;
    for (const key in value) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        (cloned as Record<string, unknown>)[key] = cloneDeep((value as Record<string, unknown>)[key]);
      }
    }
    return cloned;
  }

  // For other objects, return as-is (functions, etc.)
  return value;
}

/**
 * IsEqual function with performance optimization
 * Replaces lodash.isEqual with better performance
 */
export function isEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;

  if (a == null || b == null) return a === b;

  if (typeof a !== typeof b) return false;

  if (typeof a !== 'object') return a === b;

  const aArr = a as unknown[];
  const bArr = b as unknown[];
  if (Array.isArray(a) !== Array.isArray(b)) return false;

  if (Array.isArray(a)) {
    if (aArr.length !== bArr.length) return false;
    for (let i = 0; i < aArr.length; i++) {
      if (!isEqual(aArr[i], bArr[i])) return false;
    }
    return true;
  }

  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;
  const keysA = Object.keys(aObj);
  const keysB = Object.keys(bObj);

  if (keysA.length !== keysB.length) return false;

  for (const key of keysA) {
    if (!keysB.includes(key)) return false;
    if (!isEqual(aObj[key], bObj[key])) return false;
  }

  return true;
}

/**
 * Pick function with performance optimization
 * Replaces lodash.pick with better performance and type safety
 */
export function pick<T extends Record<string, unknown>, K extends keyof T>(
  object: T,
  keys: K[]
): Pick<T, K> {
  const result = {} as Pick<T, K>;
  for (const key of keys) {
    if (key in object) {
      result[key] = object[key];
    }
  }
  return result;
}

/**
 * Omit function with performance optimization
 * Replaces lodash.omit with better performance and type safety
 */
export function omit<T extends Record<string, unknown>, K extends keyof T>(
  object: T,
  keys: K[]
): Omit<T, K> {
  const result = { ...object } as Record<string, unknown>;
  for (const key of keys) {
    delete result[key as string];
  }
  return result as Omit<T, K>;
}

/**
 * Merge function with performance optimization
 * Replaces lodash.merge with better performance
 */
export function merge<T extends Record<string, unknown>>(...sources: Partial<T>[]): T {
  const result = {} as T;

  for (const source of sources) {
    if (source == null) continue;

    for (const key in source) {
      if (Object.prototype.hasOwnProperty.call(source, key)) {
        const sourceValue = source[key];
        const currentValue = result[key];

        if (
          sourceValue &&
          currentValue &&
          typeof sourceValue === 'object' &&
          typeof currentValue === 'object' &&
          !Array.isArray(sourceValue) &&
          !Array.isArray(currentValue)
        ) {
          result[key] = merge(currentValue, sourceValue) as T[Extract<keyof T, string>];
        } else {
          result[key] = sourceValue as T[Extract<keyof T, string>];
        }
      }
    }
  }

  return result;
}

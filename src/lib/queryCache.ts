/**
 * Query Result Caching
 * Story 3.2: Database Query Optimization
 *
 * Lightweight in-memory LRU cache for database query results
 * Reduces database load by caching frequently accessed data
 */

import { log } from '@/lib/logger';

interface CacheEntry<T> {
  value: T;
  timestamp: number;
  accessCount: number;
  lastAccessed: number;
}

interface CacheStats {
  hits: number;
  misses: number;
  size: number;
  hitRate: number;
}

/**
 * Least Recently Used (LRU) Cache
 */
export class LRUCache<T = any> {
  private cache: Map<string, CacheEntry<T>> = new Map();
  private readonly maxSize: number;
  private readonly ttl: number; // Time to live in milliseconds
  private hits: number = 0;
  private misses: number = 0;

  constructor(maxSize: number = 100, ttl: number = 5 * 60 * 1000) {
    this.maxSize = maxSize;
    this.ttl = ttl; // Default: 5 minutes
  }

  /**
   * Get value from cache
   */
  get(key: string): T | null {
    const entry = this.cache.get(key);

    if (!entry) {
      this.misses++;
      return null;
    }

    // Check if expired
    if (Date.now() - entry.timestamp > this.ttl) {
      this.cache.delete(key);
      this.misses++;
      return null;
    }

    // Update access stats
    entry.accessCount++;
    entry.lastAccessed = Date.now();
    this.hits++;

    return entry.value;
  }

  /**
   * Set value in cache
   */
  set(key: string, value: T): void {
    // Check if we need to evict
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      this.evictLRU();
    }

    this.cache.set(key, {
      value,
      timestamp: Date.now(),
      accessCount: 0,
      lastAccessed: Date.now(),
    });
  }

  /**
   * Check if key exists and is not expired
   */
  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;

    if (Date.now() - entry.timestamp > this.ttl) {
      this.cache.delete(key);
      return false;
    }

    return true;
  }

  /**
   * Delete entry from cache
   */
  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  /**
   * Clear entire cache
   */
  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * Invalidate entries matching a pattern
   */
  invalidate(pattern: string | RegExp): number {
    const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern;
    let count = 0;

    for (const key of this.cache.keys()) {
      if (regex.test(key)) {
        this.cache.delete(key);
        count++;
      }
    }

    return count;
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    const total = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      size: this.cache.size,
      hitRate: total > 0 ? this.hits / total : 0,
    };
  }

  /**
   * Evict least recently used entry
   */
  private evictLRU(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this.cache.entries()) {
      if (entry.lastAccessed < oldestTime) {
        oldestTime = entry.lastAccessed;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
    }
  }

  /**
   * Get cache size
   */
  size(): number {
    return this.cache.size;
  }

  /**
   * Get all cache keys
   */
  keys(): string[] {
    return Array.from(this.cache.keys());
  }
}

/**
 * Query Cache Manager
 * Manages multiple caches for different data types
 */
class QueryCacheManager {
  private caches: Map<string, LRUCache> = new Map();
  private enabled: boolean = true;

  /**
   * Get or create a cache for a namespace
   */
  getCache(namespace: string, maxSize: number = 100, ttl: number = 5 * 60 * 1000): LRUCache {
    if (!this.caches.has(namespace)) {
      this.caches.set(namespace, new LRUCache(maxSize, ttl));
    }
    return this.caches.get(namespace)!;
  }

  /**
   * Get value from cache
   */
  get<T>(namespace: string, key: string): T | null {
    if (!this.enabled) return null;

    const cache = this.caches.get(namespace);
    if (!cache) return null;

    return cache.get(key);
  }

  /**
   * Set value in cache
   */
  set<T>(namespace: string, key: string, value: T): void {
    if (!this.enabled) return;

    const cache = this.getCache(namespace);
    cache.set(key, value);
  }

  /**
   * Delete specific key from cache
   */
  delete(namespace: string, key: string): boolean {
    const cache = this.caches.get(namespace);
    if (!cache) return false;

    return cache.delete(key);
  }

  /**
   * Clear entire namespace
   */
  clearNamespace(namespace: string): void {
    const cache = this.caches.get(namespace);
    if (cache) {
      cache.clear();
    }
  }

  /**
   * Clear all caches
   */
  clearAll(): void {
    for (const cache of this.caches.values()) {
      cache.clear();
    }
  }

  /**
   * Invalidate entries matching pattern in namespace
   */
  invalidate(namespace: string, pattern: string | RegExp): number {
    const cache = this.caches.get(namespace);
    if (!cache) return 0;

    return cache.invalidate(pattern);
  }

  /**
   * Get stats for all caches
   */
  getAllStats(): Record<string, CacheStats> {
    const stats: Record<string, CacheStats> = {};

    for (const [namespace, cache] of this.caches.entries()) {
      stats[namespace] = cache.getStats();
    }

    return stats;
  }

  /**
   * Print stats for all caches
   */
  printStats(): void {
    const stats = this.getAllStats();

    log.debug('queryCache', { message: 'Query Cache Statistics', stats });

    for (const [namespace, stat] of Object.entries(stats)) {
      log.debug('queryCache', {
        namespace,
        hits: stat.hits,
        misses: stat.misses,
        hitRate: `${(stat.hitRate * 100).toFixed(2)}%`,
        size: `${stat.size} entries`,
      });
    }
  }

  /**
   * Enable caching
   */
  enable(): void {
    this.enabled = true;
  }

  /**
   * Disable caching
   */
  disable(): void {
    this.enabled = false;
  }

  /**
   * Check if caching is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }
}

// Singleton instance
export const queryCache = new QueryCacheManager();

/**
 * Helper function to cache query results
 */
export async function cachedQuery<T>(
  namespace: string,
  key: string,
  queryFn: () => Promise<T>,
  ttl?: number
): Promise<T> {
  // Try to get from cache
  const cached = queryCache.get<T>(namespace, key);
  if (cached !== null) {
    return cached;
  }

  // Execute query
  const result = await queryFn();

  // Store in cache
  if (ttl) {
    const cache = queryCache.getCache(namespace, 100, ttl);
    cache.set(key, result);
  } else {
    queryCache.set(namespace, key, result);
  }

  return result;
}

/**
 * Decorator for caching query results
 */
export function cacheQuery(namespace: string, ttl?: number) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      const cacheKey = `${propertyKey}:${JSON.stringify(args)}`;

      return cachedQuery(
        namespace,
        cacheKey,
        () => originalMethod.apply(this, args),
        ttl
      );
    };

    return descriptor;
  };
}

/**
 * Pre-defined cache namespaces with configurations
 */
export const CacheNamespaces = {
  CONTRACTORS: 'contractors', // 5 min TTL
  PROJECTS: 'projects', // 5 min TTL
  CLIENTS: 'clients', // 10 min TTL
  TEAMS: 'contractor_teams', // 3 min TTL
  DOCUMENTS: 'contractor_documents', // 2 min TTL
  RAG_SCORES: 'contractor_rag', // 1 min TTL
  ONBOARDING: 'contractor_onboarding', // 3 min TTL
  SOW: 'sow', // 5 min TTL
} as const;

/**
 * Initialize caches with specific configurations
 */
export function initializeCaches(): void {
  // Contractors - medium frequency, 5 min TTL
  queryCache.getCache(CacheNamespaces.CONTRACTORS, 200, 5 * 60 * 1000);

  // Projects - medium frequency, 5 min TTL
  queryCache.getCache(CacheNamespaces.PROJECTS, 100, 5 * 60 * 1000);

  // Clients - low frequency, 10 min TTL
  queryCache.getCache(CacheNamespaces.CLIENTS, 50, 10 * 60 * 1000);

  // Teams - high frequency, 3 min TTL
  queryCache.getCache(CacheNamespaces.TEAMS, 150, 3 * 60 * 1000);

  // Documents - high frequency, 2 min TTL
  queryCache.getCache(CacheNamespaces.DOCUMENTS, 100, 2 * 60 * 1000);

  // RAG Scores - very high frequency, 1 min TTL
  queryCache.getCache(CacheNamespaces.RAG_SCORES, 200, 1 * 60 * 1000);

  // Onboarding - medium frequency, 3 min TTL
  queryCache.getCache(CacheNamespaces.ONBOARDING, 100, 3 * 60 * 1000);

  // SOW - low frequency, 5 min TTL
  queryCache.getCache(CacheNamespaces.SOW, 50, 5 * 60 * 1000);

  log.debug('queryCache', {
    message: 'Query Cache initialized',
    stats: queryCache.getAllStats()
  });
}

/**
 * Cache invalidation helpers
 */
export const cacheInvalidation = {
  /**
   * Invalidate contractor-related caches
   */
  contractor(contractorId?: string): void {
    if (contractorId) {
      queryCache.invalidate(CacheNamespaces.CONTRACTORS, new RegExp(contractorId));
      queryCache.invalidate(CacheNamespaces.TEAMS, new RegExp(contractorId));
      queryCache.invalidate(CacheNamespaces.DOCUMENTS, new RegExp(contractorId));
      queryCache.invalidate(CacheNamespaces.RAG_SCORES, new RegExp(contractorId));
      queryCache.invalidate(CacheNamespaces.ONBOARDING, new RegExp(contractorId));
    } else {
      queryCache.clearNamespace(CacheNamespaces.CONTRACTORS);
      queryCache.clearNamespace(CacheNamespaces.TEAMS);
      queryCache.clearNamespace(CacheNamespaces.DOCUMENTS);
      queryCache.clearNamespace(CacheNamespaces.RAG_SCORES);
      queryCache.clearNamespace(CacheNamespaces.ONBOARDING);
    }
  },

  /**
   * Invalidate project-related caches
   */
  project(projectId?: string): void {
    if (projectId) {
      queryCache.invalidate(CacheNamespaces.PROJECTS, new RegExp(projectId));
      queryCache.invalidate(CacheNamespaces.SOW, new RegExp(projectId));
    } else {
      queryCache.clearNamespace(CacheNamespaces.PROJECTS);
      queryCache.clearNamespace(CacheNamespaces.SOW);
    }
  },

  /**
   * Invalidate client-related caches
   */
  client(clientId?: string): void {
    if (clientId) {
      queryCache.invalidate(CacheNamespaces.CLIENTS, new RegExp(clientId));
      queryCache.invalidate(CacheNamespaces.PROJECTS, new RegExp(clientId));
    } else {
      queryCache.clearNamespace(CacheNamespaces.CLIENTS);
    }
  },

  /**
   * Invalidate all caches
   */
  all(): void {
    queryCache.clearAll();
  },
};

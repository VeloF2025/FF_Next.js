/**
 * Permission Cache Manager
 * Handles caching and cleanup of user permissions
 */

import { UserPermissionCache } from './permissionChecker';

/**
 * Cache manager for user permissions
 */
export class PermissionCacheManager {
  private permissionCache = new Map<string, UserPermissionCache>();
  private readonly CACHE_TTL: number;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(cacheTTL: number = 10 * 60 * 1000) { // Default 10 minutes
    this.CACHE_TTL = cacheTTL;
    this.setupCleanupInterval();
  }

  /**
   * Generate cache key for user and project
   */
  private getCacheKey(userId: string, projectId: string): string {
    return `${userId}:${projectId}`;
  }

  /**
   * Get cached permissions for user
   */
  getCachedPermissions(userId: string, projectId: string): UserPermissionCache | null {
    const cacheKey = this.getCacheKey(userId, projectId);
    const cached = this.permissionCache.get(cacheKey);
    
    if (cached && this.isCacheValid(cached)) {
      return cached;
    }
    
    // Remove expired cache entry
    if (cached) {
      this.permissionCache.delete(cacheKey);
    }
    
    return null;
  }

  /**
   * Set cached permissions for user
   */
  setCachedPermissions(
    userId: string, 
    projectId: string, 
    permissions: UserPermissionCache
  ): void {
    const cacheKey = this.getCacheKey(userId, projectId);
    this.permissionCache.set(cacheKey, permissions);
  }

  /**
   * Check if cache entry is still valid
   */
  private isCacheValid(cached: UserPermissionCache): boolean {
    return (Date.now() - cached.timestamp) < this.CACHE_TTL;
  }

  /**
   * Clear permission cache for a specific user and project
   */
  clearUserProjectCache(userId: string, projectId: string): boolean {
    const cacheKey = this.getCacheKey(userId, projectId);
    return this.permissionCache.delete(cacheKey);
  }

  /**
   * Clear all permission caches for a user
   */
  clearUserCache(userId: string): number {
    const keysToDelete = Array.from(this.permissionCache.keys())
      .filter(key => key.startsWith(`${userId}:`));
    
    keysToDelete.forEach(key => this.permissionCache.delete(key));
    return keysToDelete.length;
  }

  /**
   * Clear all permission caches for a project
   */
  clearProjectCache(projectId: string): number {
    const keysToDelete = Array.from(this.permissionCache.keys())
      .filter(key => key.endsWith(`:${projectId}`));
    
    keysToDelete.forEach(key => this.permissionCache.delete(key));
    return keysToDelete.length;
  }

  /**
   * Clear entire permission cache
   */
  clearAllCache(): void {
    this.permissionCache.clear();
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): {
    totalEntries: number;
    validEntries: number;
    expiredEntries: number;
    cacheHitRate: number;
    oldestEntry: number | null;
    newestEntry: number | null;
  } {
    const now = Date.now();
    let validEntries = 0;
    let expiredEntries = 0;
    let oldestTimestamp: number | null = null;
    let newestTimestamp: number | null = null;

    for (const cached of this.permissionCache.values()) {
      const age = now - cached.timestamp;
      
      if (age < this.CACHE_TTL) {
        validEntries++;
      } else {
        expiredEntries++;
      }

      if (oldestTimestamp === null || cached.timestamp < oldestTimestamp) {
        oldestTimestamp = cached.timestamp;
      }
      
      if (newestTimestamp === null || cached.timestamp > newestTimestamp) {
        newestTimestamp = cached.timestamp;
      }
    }

    const totalEntries = this.permissionCache.size;

    return {
      totalEntries,
      validEntries,
      expiredEntries,
      cacheHitRate: totalEntries > 0 ? validEntries / totalEntries : 0,
      oldestEntry: oldestTimestamp,
      newestEntry: newestTimestamp
    };
  }

  /**
   * Manually trigger cache cleanup
   */
  cleanupExpiredEntries(): number {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [key, cached] of this.permissionCache.entries()) {
      if (now - cached.timestamp >= this.CACHE_TTL) {
        this.permissionCache.delete(key);
        cleanedCount++;
      }
    }

    return cleanedCount;
  }

  /**
   * Setup automatic cache cleanup interval
   */
  private setupCleanupInterval(): void {
    // Clean up every 10 minutes
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredEntries();
    }, 10 * 60 * 1000);
  }

  /**
   * Get all cached user IDs
   */
  getCachedUserIds(): string[] {
    const userIds = new Set<string>();
    
    for (const key of this.permissionCache.keys()) {
      const [userId] = key.split(':');
      userIds.add(userId!);
    }
    
    return Array.from(userIds);
  }

  /**
   * Get all cached project IDs
   */
  getCachedProjectIds(): string[] {
    const projectIds = new Set<string>();
    
    for (const key of this.permissionCache.keys()) {
      const [, projectId] = key.split(':');
      if (projectId) projectIds.add(projectId);
    }
    
    return Array.from(projectIds);
  }

  /**
   * Check if user has cached permissions for any project
   */
  hasUserCache(userId: string): boolean {
    return Array.from(this.permissionCache.keys())
      .some(key => key.startsWith(`${userId}:`));
  }

  /**
   * Destroy cache manager and cleanup resources
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.clearAllCache();
  }
}
/**
 * Simple In-Memory Rate Limiter
 *
 * NOTE: This is a basic implementation for single-server deployments.
 * For production multi-server setups, use Redis-based rate limiting
 * like @upstash/ratelimit or rate-limiter-flexible.
 */

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

class RateLimiter {
  private store = new Map<string, RateLimitEntry>();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Cleanup expired entries every minute
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 60000);
  }

  /**
   * Check if a request should be allowed
   * @param key - Unique identifier (e.g., userId, IP address)
   * @param limit - Max requests allowed
   * @param windowMs - Time window in milliseconds
   * @returns { success: boolean, remaining: number, resetAt: number }
   */
  check(
    key: string,
    limit: number,
    windowMs: number
  ): { success: boolean; remaining: number; resetAt: number } {
    const now = Date.now();
    const entry = this.store.get(key);

    // No entry or expired - allow and create new entry
    if (!entry || entry.resetAt <= now) {
      const resetAt = now + windowMs;
      this.store.set(key, { count: 1, resetAt });
      return { success: true, remaining: limit - 1, resetAt };
    }

    // Entry exists and not expired
    if (entry.count < limit) {
      entry.count++;
      this.store.set(key, entry);
      return { success: true, remaining: limit - entry.count, resetAt: entry.resetAt };
    }

    // Rate limit exceeded
    return { success: false, remaining: 0, resetAt: entry.resetAt };
  }

  /**
   * Clean up expired entries
   */
  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (entry.resetAt <= now) {
        this.store.delete(key);
      }
    }
  }

  /**
   * Reset rate limit for a specific key
   */
  reset(key: string): void {
    this.store.delete(key);
  }

  /**
   * Get current stats for debugging
   */
  getStats(): { totalKeys: number; entries: number } {
    return {
      totalKeys: this.store.size,
      entries: Array.from(this.store.entries()).length
    };
  }

  /**
   * Cleanup on shutdown
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.store.clear();
  }
}

// Singleton instance
const rateLimiter = new RateLimiter();

// Preset configurations
export const RateLimits = {
  /** 10 requests per minute */
  CHAT_API: { limit: 10, windowMs: 60 * 1000 },
  /** 5 requests per minute */
  DATA_QUERY: { limit: 5, windowMs: 60 * 1000 },
  /** 20 requests per minute */
  GENEROUS: { limit: 20, windowMs: 60 * 1000 },
  /** 100 requests per hour */
  HOURLY: { limit: 100, windowMs: 60 * 60 * 1000 },
};

export default rateLimiter;

/**
 * Rate Limiting Middleware
 * Story 3.4: API Performance & Caching
 *
 * Prevents API abuse and ensures fair resource usage
 */

import type { NextApiRequest, NextApiResponse } from 'next';

interface RateLimitConfig {
  windowMs: number; // Time window in milliseconds
  max: number; // Max requests per window
  message?: string;
  statusCode?: number;
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
}

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

/**
 * In-memory rate limit store
 * For production, use Redis or similar distributed cache
 */
class RateLimitStore {
  private store: Map<string, RateLimitEntry> = new Map();
  private cleanupInterval: NodeJS.Timeout;

  constructor() {
    // Clean up expired entries every minute
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 60 * 1000);
  }

  get(key: string): RateLimitEntry | undefined {
    const entry = this.store.get(key);
    if (entry && Date.now() > entry.resetTime) {
      this.store.delete(key);
      return undefined;
    }
    return entry;
  }

  set(key: string, entry: RateLimitEntry): void {
    this.store.set(key, entry);
  }

  increment(key: string, windowMs: number): RateLimitEntry {
    const now = Date.now();
    const existing = this.get(key);

    if (existing) {
      existing.count++;
      return existing;
    }

    const newEntry: RateLimitEntry = {
      count: 1,
      resetTime: now + windowMs,
    };
    this.set(key, newEntry);
    return newEntry;
  }

  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (now > entry.resetTime) {
        this.store.delete(key);
      }
    }
  }

  clear(): void {
    this.store.clear();
  }

  size(): number {
    return this.store.size;
  }

  destroy(): void {
    clearInterval(this.cleanupInterval);
    this.clear();
  }
}

// Global store instance
const globalStore = new RateLimitStore();

/**
 * Get client identifier
 */
function getClientId(req: NextApiRequest): string {
  // Try to get user ID from session/auth
  const userId = (req as any).userId || (req as any).user?.id;
  if (userId) {
    return `user:${userId}`;
  }

  // Fall back to IP address
  const forwarded = req.headers['x-forwarded-for'];
  const ip = forwarded
    ? (Array.isArray(forwarded) ? forwarded[0] : forwarded.split(',')[0])
    : req.socket.remoteAddress;

  return `ip:${ip}`;
}

/**
 * Rate limit middleware
 */
export function rateLimit(config: RateLimitConfig) {
  const {
    windowMs,
    max,
    message = 'Too many requests, please try again later',
    statusCode = 429,
    skipSuccessfulRequests = false,
    skipFailedRequests = false,
  } = config;

  return async (
    req: NextApiRequest,
    res: NextApiResponse,
    handler: () => Promise<void> | void
  ): Promise<void> => {
    const clientId = getClientId(req);
    const key = `ratelimit:${req.url}:${clientId}`;

    // Get current rate limit status
    const entry = globalStore.increment(key, windowMs);

    // Set rate limit headers
    res.setHeader('X-RateLimit-Limit', max.toString());
    res.setHeader('X-RateLimit-Remaining', Math.max(0, max - entry.count).toString());
    res.setHeader('X-RateLimit-Reset', new Date(entry.resetTime).toISOString());

    // Check if limit exceeded
    if (entry.count > max) {
      const retryAfter = Math.ceil((entry.resetTime - Date.now()) / 1000);
      res.setHeader('Retry-After', retryAfter.toString());

      return res.status(statusCode).json({
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message,
          retryAfter,
        },
      });
    }

    // Execute handler
    const originalStatus = res.statusCode;
    await handler();

    // Optionally skip counting based on response
    if (skipSuccessfulRequests && res.statusCode < 400) {
      entry.count--;
    }
    if (skipFailedRequests && res.statusCode >= 400) {
      entry.count--;
    }
  };
}

/**
 * Rate limit presets
 */
export const RateLimitPresets = {
  /**
   * Strict - 10 requests per minute
   */
  strict: {
    windowMs: 60 * 1000,
    max: 10,
  },

  /**
   * Standard - 100 requests per minute
   */
  standard: {
    windowMs: 60 * 1000,
    max: 100,
  },

  /**
   * Generous - 1000 requests per minute
   */
  generous: {
    windowMs: 60 * 1000,
    max: 1000,
  },

  /**
   * Auth endpoints - 5 requests per 15 minutes
   */
  auth: {
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: 'Too many authentication attempts, please try again later',
  },

  /**
   * Search endpoints - 30 requests per minute
   */
  search: {
    windowMs: 60 * 1000,
    max: 30,
  },
} as const;

/**
 * HOC for rate limiting API routes
 */
export function withRateLimit(
  handler: (req: NextApiRequest, res: NextApiResponse) => Promise<void> | void,
  config: RateLimitConfig
) {
  return async (req: NextApiRequest, res: NextApiResponse) => {
    return rateLimit(config)(req, res, () => handler(req, res));
  };
}

/**
 * Get rate limit store stats (for monitoring)
 */
export function getRateLimitStats() {
  return {
    size: globalStore.size(),
  };
}

/**
 * Clear rate limit store (for testing)
 */
export function clearRateLimits() {
  globalStore.clear();
}

/**
 * Sliding window rate limiter
 * More accurate than fixed window
 */
export class SlidingWindowRateLimiter {
  private requests: Map<string, number[]> = new Map();

  check(key: string, windowMs: number, max: number): {
    allowed: boolean;
    current: number;
    resetTime: number;
  } {
    const now = Date.now();
    const windowStart = now - windowMs;

    // Get existing requests for this key
    let timestamps = this.requests.get(key) || [];

    // Remove expired timestamps
    timestamps = timestamps.filter((ts) => ts > windowStart);

    // Check if limit exceeded
    const allowed = timestamps.length < max;

    if (allowed) {
      timestamps.push(now);
      this.requests.set(key, timestamps);
    }

    const resetTime = timestamps.length > 0
      ? timestamps[0]! + windowMs
      : now + windowMs;

    return {
      allowed,
      current: timestamps.length,
      resetTime,
    };
  }

  cleanup(): void {
    const now = Date.now();
    for (const [key, timestamps] of this.requests.entries()) {
      // Remove entries with no recent timestamps
      const recent = timestamps.filter((ts) => ts > now - 60 * 60 * 1000);
      if (recent.length === 0) {
        this.requests.delete(key);
      } else {
        this.requests.set(key, recent);
      }
    }
  }
}

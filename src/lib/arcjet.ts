/**
 * Arcjet Security Configuration
 *
 * Provides bot protection, rate limiting, and attack detection
 * for FibreFlow API endpoints.
 *
 * Features:
 * - Bot detection (AI-powered)
 * - Distributed rate limiting (no Redis needed)
 * - Attack protection (SQL injection, XSS, etc.)
 *
 * @see https://docs.arcjet.com
 */

import arcjet, { detectBot, fixedWindow, shield } from "@arcjet/next";
import type { NextApiRequest, NextApiResponse } from "next";
import { log } from "@/lib/logger";

// Get API key from environment
const ARCJET_KEY = process.env.ARCJET_KEY!;

if (!ARCJET_KEY) {
  log.warn('arcjet', { action: 'init', message: 'ARCJET_KEY not found in environment variables. Arcjet protection disabled.' });
}

/**
 * Standard protection for most API endpoints
 * - Bot detection enabled
 * - Rate limit: 100 requests per minute
 * - Attack shield enabled
 */
export const aj = arcjet({
  key: ARCJET_KEY,
  rules: [
    // Detect and block bots
    detectBot({
      mode: "LIVE", // LIVE = block, DRY_RUN = log only
      allow: [
        // Allow legitimate search engine bots
        "CATEGORY:SEARCH_ENGINE",
      ],
    }),
    // Rate limiting - 100 requests per minute
    fixedWindow({
      mode: "LIVE",
      window: "1m",
      max: 100,
    }),
    // Protect against common attacks
    shield({
      mode: "LIVE",
    }),
  ],
});

/**
 * Strict protection for sensitive endpoints
 * (auth, contractors, sensitive data)
 * - Bot detection enabled
 * - Rate limit: 30 requests per minute
 * - Attack shield enabled
 */
export const ajStrict = arcjet({
  key: ARCJET_KEY,
  rules: [
    detectBot({
      mode: "LIVE",
      allow: [], // No bots allowed
    }),
    fixedWindow({
      mode: "LIVE",
      window: "1m",
      max: 30,
    }),
    shield({
      mode: "LIVE",
    }),
  ],
});

/**
 * Generous protection for public endpoints
 * (health checks, public data)
 * - Bot detection in monitoring mode
 * - Rate limit: 300 requests per minute
 */
export const ajGenerous = arcjet({
  key: ARCJET_KEY,
  rules: [
    detectBot({
      mode: "DRY_RUN", // Log but don't block
      allow: ["CATEGORY:SEARCH_ENGINE"],
    }),
    fixedWindow({
      mode: "LIVE",
      window: "1m",
      max: 300,
    }),
  ],
});

/**
 * WhatsApp Monitor protection
 * - Moderate rate limiting for external integrations
 * - Bot detection enabled
 * - Rate limit: 60 requests per minute
 */
export const ajWaMonitor = arcjet({
  key: ARCJET_KEY,
  rules: [
    detectBot({
      mode: "LIVE",
      allow: [],
    }),
    fixedWindow({
      mode: "LIVE",
      window: "1m",
      max: 60,
    }),
    shield({
      mode: "LIVE",
    }),
  ],
});

/**
 * Helper to check if Arcjet is configured
 */
export function isArcjetEnabled(): boolean {
  return Boolean(ARCJET_KEY);
}

/**
 * Middleware wrapper for protected API routes
 *
 * @example
 * ```typescript
 * import { withArcjetProtection } from '@/lib/arcjet';
 *
 * async function handler(req, res) {
 *   // Your API logic
 * }
 *
 * export default withArcjetProtection(handler);
 * ```
 */
export function withArcjetProtection(
  handler: (req: NextApiRequest, res: NextApiResponse) => Promise<void> | void,
  protection: typeof aj = aj
) {
  return async (req: NextApiRequest, res: NextApiResponse) => {
    // Skip protection if Arcjet not configured
    if (!ARCJET_KEY) {
      log.warn('arcjet', { action: 'protect', message: 'Arcjet protection skipped - ARCJET_KEY not configured' });
      return handler(req, res);
    }

    // Run Arcjet protection
    const decision = await protection.protect(req);

    // Log decision for monitoring
    log.debug('arcjet', {
      action: 'decision',
      id: decision.id,
      conclusion: decision.conclusion,
      reason: decision.reason.toString(),
      ip: decision.ip,
    });

    // Block if denied
    if (decision.isDenied()) {
      // Determine reason
      let errorMessage = 'Request blocked';
      let statusCode = 403;

      if (decision.reason.isRateLimit()) {
        errorMessage = 'Too many requests. Please try again later.';
        statusCode = 429;
      } else if (decision.reason.isBot()) {
        errorMessage = 'Automated requests are not allowed.';
        statusCode = 403;
      } else if (decision.reason.isShield()) {
        errorMessage = 'Request blocked for security reasons.';
        statusCode = 403;
      }

      return res.status(statusCode).json({
        success: false,
        error: {
          code: decision.reason.toString(),
          message: errorMessage,
        },
        meta: {
          timestamp: new Date().toISOString(),
        },
      });
    }

    // Request allowed - proceed to handler
    return handler(req, res);
  };
}

export default aj;

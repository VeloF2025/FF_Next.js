/**
 * Error Tracking Analytics Endpoint
 *
 * Collects error events from clients for monitoring
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { log } from '@/lib/logger';
import { withAuth, withRole } from '@/lib/auth';
type ErrorSeverity = 'fatal' | 'error' | 'warning' | 'info' | 'debug';

interface ErrorContext {
  user?: {
    id: string;
    email?: string;
    role?: string;
  };
  page?: {
    url: string;
    pathname: string;
    referrer: string;
  };
  environment?: {
    userAgent: string;
    viewport: { width: number; height: number };
    connection?: any;
  };
  tags?: Record<string, string>;
  extra?: Record<string, any>;
}

interface ErrorEvent {
  message: string;
  stack?: string;
  severity: ErrorSeverity;
  timestamp: number;
  context: ErrorContext;
  fingerprint?: string[];
}

/**
 * Store error event
 */
function storeError(error: ErrorEvent): void {
  // In development, log to console
  if (process.env.NODE_ENV === 'development') {
    log.error('[Error Tracking]', {
      severity: error.severity,
      message: error.message,
      page: error.context.page?.pathname,
      user: error.context.user?.email || 'anonymous',
      stack: error.stack?.split('\n').slice(0, 3).join('\n'),
    });
    return;
  }

  // In production, send to error tracking service
  // Options:
  // 1. Sentry
  // 2. Bugsnag
  // 3. Rollbar
  // 4. Custom database
  // 5. Log aggregation service (DataDog, LogRocket, etc.)

  // For now, log errors (in production, integrate with service)
  log.error('[Error Tracking] Production error', {
    message: error.message,
    severity: error.severity,
    pathname: error.context.page?.pathname,
    fingerprint: error.fingerprint,
  });

  // Example: Send to Sentry (if configured)
  /*
  if (process.env.SENTRY_DSN) {
    Sentry.captureException(new Error(error.message), {
      level: error.severity,
      tags: error.context.tags,
      extra: error.context.extra,
      user: error.context.user,
    });
  }
  */

  // Example: Store in database for custom tracking
  /*
  try {
    await db.query(
      `INSERT INTO error_events (message, severity, stack, pathname, user_id, timestamp, context)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        error.message,
        error.severity,
        error.stack,
        error.context.page?.pathname,
        error.context.user?.id,
        error.timestamp,
        JSON.stringify(error.context)
      ]
    );
  } catch (dbError) {
    log.error('[Error Tracking] Failed to store error', { error: dbError });
  }
  */
}

/**
 * Validate error event
 */
function isValidErrorEvent(data: any): data is ErrorEvent {
  return (
    data &&
    typeof data === 'object' &&
    typeof data.message === 'string' &&
    typeof data.severity === 'string' &&
    typeof data.timestamp === 'number' &&
    typeof data.context === 'object'
  );
}

/**
 * Check if error should be ignored
 */
function shouldIgnoreError(error: ErrorEvent): boolean {
  const ignoredMessages = [
    'ResizeObserver loop',
    'Script error',
    'Non-Error promise rejection',
  ];

  return ignoredMessages.some((msg) =>
    error.message.toLowerCase().includes(msg.toLowerCase())
  );
}

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
): Promise<void> {
  // Only accept POST requests
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const errorEvent = req.body;

    // Validate error event
    if (!isValidErrorEvent(errorEvent)) {
      return res.status(400).json({ error: 'Invalid error event data' });
    }

    // Check if should ignore
    if (shouldIgnoreError(errorEvent)) {
      return res.status(200).json({ received: true, ignored: true });
    }

    // Store error
    storeError(errorEvent);

    // Trigger alerts for critical errors
    if (errorEvent.severity === 'fatal' || errorEvent.severity === 'error') {
      // In production, you might want to:
      // - Send Slack notification
      // - Send email alert
      // - Create incident in PagerDuty
      // - Trigger monitoring alerts
    }

    // Return success
    res.status(200).json({ received: true });
  } catch (error) {
    log.error('[Error Tracking API] Error', { error });
    res.status(500).json({ error: 'Internal server error' });
  }
}

export default withAuth(withRole('manager')(handler));

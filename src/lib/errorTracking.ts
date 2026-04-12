/**
 * Error Tracking & Monitoring
 *
 * Lightweight error tracking that captures errors with context
 * Can integrate with Sentry or use custom endpoint
 */

import { log } from '@/lib/logger';

// Error severity levels
export type ErrorSeverity = 'fatal' | 'error' | 'warning' | 'info' | 'debug';

// Error context for debugging
export interface ErrorContext {
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
    connection?: { effectiveType?: string; downlink?: number; rtt?: number };
  };
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
}

// Error event structure for tracking (named to avoid collision with DOM ErrorEvent)
export interface TrackingErrorEvent {
  message: string;
  stack?: string;
  severity: ErrorSeverity;
  timestamp: number;
  context: ErrorContext;
  fingerprint?: string[];
}

/**
 * Configuration
 */
const config = {
  enabled: process.env.NODE_ENV === 'production',
  endpoint: '/api/analytics/errors',
  sampleRate: 1.0, // 100% of errors
  beforeSend: (event: TrackingErrorEvent) => event, // Transform before sending
};

/**
 * Initialize error tracking
 */
export function initErrorTracking(options?: {
  enabled?: boolean;
  endpoint?: string;
  sampleRate?: number;
}): void {
  if (typeof window === 'undefined') return;

  // Update config
  Object.assign(config, options);

  // Set up global error handlers
  window.addEventListener('error', handleGlobalError);
  window.addEventListener('unhandledrejection', handleUnhandledRejection);

  log.debug('errorTracking', {
    action: 'initialized',
    enabled: config.enabled,
    sampleRate: config.sampleRate,
  });
}

/**
 * Handle global errors
 */
function handleGlobalError(event: ErrorEvent): void {
  const error = event.error || event;

  captureException(error, {
    severity: 'error',
    tags: { type: 'uncaught' },
  });
}

/**
 * Handle unhandled promise rejections
 */
function handleUnhandledRejection(event: PromiseRejectionEvent): void {
  captureException(event.reason, {
    severity: 'error',
    tags: { type: 'unhandled-rejection' },
  });
}

/**
 * Capture an exception
 */
export function captureException(
  error: Error | string,
  options?: {
    severity?: ErrorSeverity;
    tags?: Record<string, string>;
    extra?: Record<string, unknown>;
    user?: ErrorContext['user'];
  }
): void {
  // Don't track in development unless explicitly enabled
  if (!config.enabled && process.env.NODE_ENV !== 'production') {
    log.error('errorTracking', {
      action: 'captureException',
      error: error instanceof Error ? error.message : error,
      options,
    });
    return;
  }

  // Sample errors based on rate
  if (Math.random() > config.sampleRate) {
    return;
  }

  const errorEvent = buildErrorEvent(error, options);

  // Apply beforeSend transform
  const transformedEvent = config.beforeSend(errorEvent);
  if (!transformedEvent) return; // Filtered out

  // Send to endpoint
  sendErrorEvent(transformedEvent);

  // Log in development
  if (process.env.NODE_ENV === 'development') {
    log.error('errorTracking', {
      action: 'captured',
      event: transformedEvent,
    });
  }
}

/**
 * Capture a message
 */
export function captureMessage(
  message: string,
  options?: {
    severity?: ErrorSeverity;
    tags?: Record<string, string>;
    extra?: Record<string, unknown>;
  }
): void {
  if (!config.enabled) return;

  const errorEvent: TrackingErrorEvent = {
    message,
    severity: options?.severity || 'info',
    timestamp: Date.now(),
    context: getErrorContext(),
    fingerprint: [message],
  };

  if (options?.tags) {
    errorEvent.context.tags = options.tags;
  }

  if (options?.extra) {
    errorEvent.context.extra = options.extra;
  }

  sendErrorEvent(errorEvent);
}

/**
 * Build error event from error
 */
function buildErrorEvent(
  error: Error | string,
  options?: {
    severity?: ErrorSeverity;
    tags?: Record<string, string>;
    extra?: Record<string, unknown>;
    user?: ErrorContext['user'];
  }
): TrackingErrorEvent {
  const isError = error instanceof Error;
  const message = isError ? error.message : String(error);
  const stack = isError ? error.stack : undefined;

  const context = getErrorContext();

  // Add user context if provided
  if (options?.user) {
    context.user = options.user;
  }

  // Add tags
  if (options?.tags) {
    context.tags = { ...context.tags, ...options.tags };
  }

  // Add extra data
  if (options?.extra) {
    context.extra = { ...context.extra, ...options.extra };
  }

  return {
    message,
    stack,
    severity: options?.severity || 'error',
    timestamp: Date.now(),
    context,
    fingerprint: [message, stack?.split('\n')[0] || ''].filter(Boolean),
  };
}

/**
 * Get error context
 */
function getErrorContext(): ErrorContext {
  if (typeof window === 'undefined') {
    return {};
  }

  return {
    page: {
      url: window.location.href,
      pathname: window.location.pathname,
      referrer: document.referrer,
    },
    environment: {
      userAgent: navigator.userAgent,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
      },
      connection: (navigator as Navigator & { connection?: { effectiveType?: string; downlink?: number; rtt?: number } }).connection,
    },
    tags: {},
    extra: {},
  };
}

/**
 * Send error event to endpoint
 */
async function sendErrorEvent(event: TrackingErrorEvent): Promise<void> {
  if (!config.enabled) return;

  try {
    await fetch(config.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
      keepalive: true,
    }).catch(() => {
      // intentional: fetch failure must not impact user experience
    });
  } catch (error) {
    // intentional: avoid infinite loop — logging here would call captureException recursively
  }
}

/**
 * Set user context
 */
export function setUser(user: ErrorContext['user'] | null): void {
  if (typeof window === 'undefined') return;

  (window as Window & { __errorTrackingUser?: ErrorContext['user'] | null }).__errorTrackingUser = user;
}

/**
 * Set custom context
 */
export function setContext(key: string, value: unknown): void {
  if (typeof window === 'undefined') return;

  type TrackingWindow = Window & { __errorTrackingContext?: Record<string, unknown> };
  const trackingWindow = window as TrackingWindow;

  if (!trackingWindow.__errorTrackingContext) {
    trackingWindow.__errorTrackingContext = {};
  }

  trackingWindow.__errorTrackingContext[key] = value;
}

/**
 * Add breadcrumb for debugging
 */
export interface Breadcrumb {
  message: string;
  category?: string;
  level?: ErrorSeverity;
  timestamp: number;
  data?: Record<string, unknown>;
}

const breadcrumbs: Breadcrumb[] = [];
const MAX_BREADCRUMBS = 50;

export function addBreadcrumb(breadcrumb: Omit<Breadcrumb, 'timestamp'>): void {
  breadcrumbs.push({
    ...breadcrumb,
    timestamp: Date.now(),
  });

  // Keep only last N breadcrumbs
  if (breadcrumbs.length > MAX_BREADCRUMBS) {
    breadcrumbs.shift();
  }
}

/**
 * Get breadcrumbs
 */
export function getBreadcrumbs(): Breadcrumb[] {
  return [...breadcrumbs];
}

/**
 * Clear breadcrumbs
 */
export function clearBreadcrumbs(): void {
  breadcrumbs.length = 0;
}

/**
 * Wrap async function with error tracking
 */
export function withErrorTracking<T extends (...args: unknown[]) => Promise<unknown>>(
  fn: T,
  options?: {
    name?: string;
    tags?: Record<string, string>;
  }
): T {
  return (async (...args: unknown[]) => {
    try {
      return await fn(...args);
    } catch (error) {
      captureException(error as Error, {
        severity: 'error',
        tags: {
          function: options?.name || fn.name,
          ...options?.tags,
        },
        extra: {
          arguments: args,
        },
      });
      throw error;
    }
  }) as T;
}

/**
 * React error boundary helper
 */
export function captureReactError(
  error: Error,
  errorInfo: { componentStack: string }
): void {
  captureException(error, {
    severity: 'error',
    tags: {
      type: 'react-error-boundary',
    },
    extra: {
      componentStack: errorInfo.componentStack,
    },
  });
}

/**
 * Track API errors
 */
export function captureAPIError(
  endpoint: string,
  error: Error,
  options?: {
    method?: string;
    status?: number;
    body?: unknown;
  }
): void {
  captureException(error, {
    severity: 'error',
    tags: {
      type: 'api-error',
      endpoint,
      method: options?.method || 'GET',
      status: String(options?.status || 0),
    },
    extra: {
      requestBody: options?.body,
    },
  });
}

/**
 * Check if error tracking is enabled
 */
export function isEnabled(): boolean {
  return config.enabled;
}

/**
 * Disable error tracking
 */
export function disable(): void {
  config.enabled = false;
}

/**
 * Enable error tracking
 */
export function enable(): void {
  config.enabled = true;
}

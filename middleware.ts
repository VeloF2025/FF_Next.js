import { NextRequest, NextResponse } from 'next/server';
import arcjet, { detectBot, fixedWindow, shield } from "@arcjet/next";

// TODO: Re-enable Clerk middleware when ready for production

// Edge-compatible structured logging
// Note: Edge Runtime doesn't support file I/O, so we use stdout/stderr
// This is the ONLY acceptable use of console methods in Edge Runtime
function edgeLog(level: 'debug' | 'info' | 'warn' | 'error', message: string, data?: any) {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    level: level.toUpperCase(),
    component: 'middleware',
    message,
    ...data
  };

  // Edge Runtime limitation: process.stdout/stderr may not exist
  // Fall back to console methods which are always available in Edge
  try {
    if (process.env.NODE_ENV === 'development') {
      const formattedData = data ? ` ${JSON.stringify(data)}` : '';
      if (typeof process?.stderr?.write === 'function') {
        process.stderr.write(`[${timestamp}] ${level.toUpperCase()}: ${message}${formattedData}\n`);
      } else {
        // eslint-disable-next-line no-console -- Edge Runtime fallback
        console.error(`[${timestamp}] ${level.toUpperCase()}: ${message}${formattedData}`);
      }
    } else {
      if (typeof process?.stdout?.write === 'function') {
        process.stdout.write(JSON.stringify(logEntry) + '\n');
      } else {
        // eslint-disable-next-line no-console -- Edge Runtime fallback
        console.log(JSON.stringify(logEntry));
      }
    }
  } catch {
    // Silent fallback - never crash middleware on logging
  }
}

function setSecurityHeaders(response: NextResponse) {
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'SAMEORIGIN');
  response.headers.set('X-XSS-Protection', '1; mode=block');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  // Permissions-Policy: allow same-origin use of camera and geolocation.
  // The attendance portal (/my/attendance/clock) needs both — selfies and
  // GPS location at clock in/out. Fleet portal also uses geolocation for
  // check-in coordinates. `self` is the same-origin allowlist; third-party
  // frames still get nothing. Microphone stays disabled — nothing in the
  // app needs it.
  response.headers.set(
    'Permissions-Policy',
    'camera=(self), microphone=(), geolocation=(self)'
  );
  response.headers.set('Content-Security-Policy', [
    "frame-ancestors 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://static.cloudflareinsights.com",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://*.fibreflow.app https://firebasestorage.googleapis.com",
    "connect-src 'self' https://*.fibreflow.app https://*.neon.tech wss://*.neon.tech https://cloudflareinsights.com https://errors.isaflow.co.za",
  ].join('; '));
  if (process.env.NODE_ENV === 'production') {
    response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
}

// Get API key from environment
const ARCJET_KEY = process.env.ARCJET_KEY;

// Rate limiting configurations per AUDIT-API.md H-002
// Task #227: Add rate limiting to all API endpoints

/**
 * Auth endpoints - Strict rate limiting: 10 req/min
 * Protects login, register, password reset, etc.
 */
const ajAuth = ARCJET_KEY ? arcjet({
  key: ARCJET_KEY,
  rules: [
    detectBot({
      mode: "LIVE",
      allow: [], // No bots on auth endpoints
    }),
    fixedWindow({
      mode: "LIVE",
      window: "1m",
      max: 10,
    }),
    shield({
      mode: "LIVE",
    }),
  ],
}) : null;

/**
 * Write operations - Moderate rate limiting: 30 req/min
 * POST, PUT, PATCH, DELETE operations
 */
const ajWrite = ARCJET_KEY ? arcjet({
  key: ARCJET_KEY,
  rules: [
    detectBot({
      mode: "LIVE",
      allow: ["CATEGORY:SEARCH_ENGINE"],
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
}) : null;

/**
 * General API endpoints - Standard rate limiting: 100 req/min
 * GET requests and other general operations
 */
const ajGeneral = ARCJET_KEY ? arcjet({
  key: ARCJET_KEY,
  rules: [
    detectBot({
      mode: "LIVE",
      allow: ["CATEGORY:SEARCH_ENGINE"],
    }),
    fixedWindow({
      mode: "LIVE",
      window: "1m",
      max: 100,
    }),
    shield({
      mode: "LIVE",
    }),
  ],
}) : null;

/**
 * Health check endpoints - Very generous rate limiting: 300 req/min
 * Monitoring systems need frequent access
 */
const ajHealth = ARCJET_KEY ? arcjet({
  key: ARCJET_KEY,
  rules: [
    detectBot({
      mode: "DRY_RUN", // Log but don't block monitoring bots
      allow: ["CATEGORY:SEARCH_ENGINE"],
    }),
    fixedWindow({
      mode: "LIVE",
      window: "1m",
      max: 300,
    }),
  ],
}) : null;

// TODO: Re-enable when adding Clerk auth back
// const isPublicRoute = createRouteMatcher([
//   '/sign-in(.*)',
//   '/sign-up(.*)',
//   '/api/health(.*)',
//   '/',
// ]);

/**
 * Determine which Arcjet protection to apply based on the endpoint
 */
function getArcjetProtection(pathname: string, method: string) {
  // Health endpoints - generous limits
  if (pathname.startsWith('/api/health') || pathname.startsWith('/api/monitoring')) {
    return ajHealth;
  }

  // Auth endpoints - strict limits (10/min)
  // Includes /api/auth/* (admin login, check-email) and the staff attendance
  // portal login / OTP routes under /api/my/login/. Both are credential-
  // verification surfaces where brute-force protection matters and 10/min
  // is comfortably above legitimate UI use (a human cannot fail login ten
  // times a minute). Matters most for the first-time PIN path, where a
  // staff row without a credentials row has no per-account lockout signal
  // to rely on — the IP-scoped Arcjet limit is the sole brake.
  if (
    pathname.startsWith('/api/auth/') ||
    pathname === '/api/my/login' ||
    pathname.startsWith('/api/my/login/')
  ) {
    return ajAuth;
  }

  // Write operations - moderate limits (30/min)
  if (method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE') {
    return ajWrite;
  }

  // General endpoints - standard limits (100/min)
  return ajGeneral;
}

// Decommissioned modules — routes blocked, code retained
const DECOMMISSIONED_MODULES = [
  '/accounting',                      // Decommissioned 2026-04-01
  '/api/accounting',                  // Decommissioned 2026-04-01
  '/api/sage',                        // Sage integration tied to accounting
  '/api/cron/sage-sync',              // Sage sync cron
  '/api/cron/recurring-journals',     // Accounting journals cron
  '/api/cron/recurring-invoices',     // Accounting invoices cron
];

export async function middleware(request: NextRequest) {
  const startTime = Date.now();
  const { pathname, searchParams } = request.nextUrl;

  // Block decommissioned modules
  for (const prefix of DECOMMISSIONED_MODULES) {
    if (pathname === prefix || pathname.startsWith(prefix + '/')) {
      if (pathname.startsWith('/api/')) {
        return NextResponse.json(
          { success: false, error: { code: 'MODULE_DECOMMISSIONED', message: 'The accounting module has been decommissioned.' } },
          { status: 410 }
        );
      }
      // Page routes — redirect to dashboard
      return NextResponse.redirect(new URL('/dashboard', request.url));
    }
  }

  // Skip static files and Next.js internals
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/static') ||
    pathname.match(/\.(ico|png|jpg|jpeg|svg|css|js|map)$/)
  ) {
    return NextResponse.next();
  }

  // Apply rate limiting to API requests
  if (pathname.startsWith('/api/')) {
    // Get appropriate Arcjet protection
    const aj = getArcjetProtection(pathname, request.method);

    // Apply Arcjet protection if configured
    if (aj && ARCJET_KEY) {
      const decision = await aj.protect(request);

      // Log decision
      edgeLog('debug', 'Arcjet decision', {
        id: decision.id,
        conclusion: decision.conclusion,
        reason: decision.reason.toString(),
        ip: decision.ip,
        path: pathname,
        method: request.method,
      });

      // Block if denied
      if (decision.isDenied()) {
        let errorMessage = 'Request blocked';
        let statusCode = 403;

        if (decision.reason.isRateLimit()) {
          errorMessage = 'Too many requests. Please try again later.';
          statusCode = 429;
          edgeLog('warn', 'Rate limit exceeded', {
            path: pathname,
            method: request.method,
            ip: decision.ip,
          });
        } else if (decision.reason.isBot()) {
          errorMessage = 'Automated requests are not allowed.';
          statusCode = 403;
          edgeLog('warn', 'Bot detected', {
            path: pathname,
            ip: decision.ip,
          });
        } else if (decision.reason.isShield()) {
          errorMessage = 'Request blocked for security reasons.';
          statusCode = 403;
          edgeLog('error', 'Shield block', {
            path: pathname,
            ip: decision.ip,
          });
        }

        return NextResponse.json(
          {
            success: false,
            error: {
              code: decision.reason.toString(),
              message: errorMessage,
            },
            meta: {
              timestamp: new Date().toISOString(),
            },
          },
          { status: statusCode }
        );
      }
    } else if (!ARCJET_KEY) {
      edgeLog('warn', 'Arcjet not configured', {
        message: 'ARCJET_KEY not found - rate limiting disabled',
      });
    }

    // Log API requests
    edgeLog('info', 'API Request', {
      method: request.method,
      path: pathname,
      query: Object.fromEntries(searchParams),
      ip: request.ip || request.headers.get('x-forwarded-for'),
      userAgent: request.headers.get('user-agent')
    });

    const response = NextResponse.next();
    response.headers.set('X-Response-Time', `${Date.now() - startTime}ms`);
    setSecurityHeaders(response);

    // Log slow requests
    const responseTime = Date.now() - startTime;
    if (responseTime > 1000) {
      edgeLog('warn', 'Slow API Request', {
        path: pathname,
        responseTime: `${responseTime}ms`
      });
    }

    return response;
  }

  // For pages, add response time and security headers
  const response = NextResponse.next();
  response.headers.set('X-Response-Time', `${Date.now() - startTime}ms`);
  setSecurityHeaders(response);

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except static files
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};

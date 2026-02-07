import { NextRequest, NextResponse } from 'next/server';

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
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  response.headers.set('Content-Security-Policy', "frame-ancestors 'self'; base-uri 'self'; form-action 'self';");
  if (process.env.NODE_ENV === 'production') {
    response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
}

// TODO: Re-enable when adding Clerk auth back
// const isPublicRoute = createRouteMatcher([
//   '/sign-in(.*)',
//   '/sign-up(.*)',
//   '/api/health(.*)',
//   '/',
// ]);

export async function middleware(request: NextRequest) {
  const startTime = Date.now();
  const { pathname, searchParams } = request.nextUrl;
  
  // Skip static files and Next.js internals
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/static') ||
    pathname.match(/\.(ico|png|jpg|jpeg|svg|css|js|map)$/)
  ) {
    return NextResponse.next();
  }

  // Log API requests
  if (pathname.startsWith('/api/')) {
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
import { NextRequest, NextResponse } from 'next/server';

// TODO: Re-enable Clerk middleware when ready for production

// Simple edge-compatible logging
function edgeLog(level: string, message: string, data?: any) {
  const timestamp = new Date().toISOString();
  const log = {
    timestamp,
    level,
    message,
    ...data
  };

  if (process.env.NODE_ENV === 'development') {
    console.log(`[${timestamp}] ${level.toUpperCase()}: ${message}`, data || '');
  } else {
    console.log(JSON.stringify(log));
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
    
    // Clone response to log status
    const response = NextResponse.next();
    
    // Log response time
    response.headers.set('X-Response-Time', `${Date.now() - startTime}ms`);
    
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

  // TODO: Re-enable when adding Clerk auth back
  // if (!isPublicRoute(request)) {
  //   auth().protect();
  // }

  // For pages, just add response time header
  const response = NextResponse.next();
  response.headers.set('X-Response-Time', `${Date.now() - startTime}ms`);

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
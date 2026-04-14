import { NextRequest, NextResponse } from 'next/server';
import pinoHttp from 'pino-http';
import { apiLogger } from './logger';

// Create pino-http middleware for Next.js
export const httpLogger = pinoHttp({
  logger: apiLogger,
  
  // Customize the request log
  customLogLevel: function (req, res, err) {
    if (res.statusCode >= 400 && res.statusCode < 500) {
      return 'warn';
    } else if (res.statusCode >= 500 || err) {
      return 'error';
    }
    return 'info';
  },
  
  // Customize success message
  customSuccessMessage: function (req, res) {
    return `${req.method} ${req.url} completed`;
  },
  
  // Customize error message
  customErrorMessage: function (req, res, err) {
    return `${req.method} ${req.url} failed: ${err.message}`;
  },
  
  // Customize request properties to log
  customProps: function (req, res) {
    return {
      responseTime: (res as unknown as { responseTime?: number }).responseTime,
      userAgent: req.headers['user-agent'],
      ip: req.headers['x-forwarded-for'] || req.connection?.remoteAddress
    };
  },
  
  // Paths to ignore
  autoLogging: {
    ignore: (req) => {
      // Ignore health check endpoints
      if (req.url?.includes('/health') || req.url?.includes('/_next')) {
        return true;
      }
      return false;
    }
  }
});

// Wrapper for Next.js API routes
export function withLogger(handler: Function) {
  return async (req: NextRequest, context?: any) => {
    const startTime = Date.now();
    
    try {
      // Log request start
      apiLogger.info({
        method: req.method,
        url: req.url,
        headers: {
          ...Object.fromEntries(req.headers.entries()),
          authorization: req.headers.get('authorization') ? '[REDACTED]' : undefined,
          cookie: req.headers.get('cookie') ? '[REDACTED]' : undefined
        }
      }, `${req.method} ${req.url} - Request started`);
      
      // Execute the handler
      const response = await handler(req, context);
      
      // Log response
      const responseTime = Date.now() - startTime;
      const status = response.status || 200;
      
      if (status >= 400) {
        apiLogger.warn({
          method: req.method,
          url: req.url,
          status,
          responseTime
        }, `${req.method} ${req.url} - ${status} - ${responseTime}ms`);
      } else {
        apiLogger.info({
          method: req.method,
          url: req.url,
          status,
          responseTime
        }, `${req.method} ${req.url} - ${status} - ${responseTime}ms`);
      }
      
      return response;
    } catch (error: any) {
      const responseTime = Date.now() - startTime;
      
      // Log error
      apiLogger.error({
        method: req.method,
        url: req.url,
        error: error.message,
        stack: error.stack,
        responseTime
      }, `${req.method} ${req.url} - Error: ${error.message}`);
      
      // Return error response
      return NextResponse.json(
        { error: 'Internal Server Error', message: error.message },
        { status: 500 }
      );
    }
  };
}

// Express/Node.js middleware for api-server.mjs
export function expressLogger() {
  return (req: any, res: any, next: any) => {
    const startTime = Date.now();
    
    // Log request
    apiLogger.info({
      method: req.method,
      url: req.url,
      path: req.path,
      query: req.query,
      params: req.params,
      headers: {
        ...req.headers,
        authorization: req.headers?.authorization ? '[REDACTED]' : undefined,
        cookie: req.headers?.cookie ? '[REDACTED]' : undefined
      }
    }, `${req.method} ${req.url} - Request received`);
    
    // Capture the original end function
    const originalEnd = res.end;
    
    // Override the end function to log response
    res.end = function(...args: any[]) {
      const responseTime = Date.now() - startTime;
      
      // Log response based on status code
      if (res.statusCode >= 500) {
        apiLogger.error({
          method: req.method,
          url: req.url,
          statusCode: res.statusCode,
          responseTime
        }, `${req.method} ${req.url} - ${res.statusCode} - ${responseTime}ms`);
      } else if (res.statusCode >= 400) {
        apiLogger.warn({
          method: req.method,
          url: req.url,
          statusCode: res.statusCode,
          responseTime
        }, `${req.method} ${req.url} - ${res.statusCode} - ${responseTime}ms`);
      } else {
        apiLogger.info({
          method: req.method,
          url: req.url,
          statusCode: res.statusCode,
          responseTime
        }, `${req.method} ${req.url} - ${res.statusCode} - ${responseTime}ms`);
      }
      
      // Call the original end function
      originalEnd.apply(res, args);
    };
    
    next();
  };
}
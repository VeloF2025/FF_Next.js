import { NextRequest, NextResponse } from 'next/server';
import {
  generateCorrelationId,
  generateRequestId,
  getCorrelationId,
  getRequestId,
  withCorrelation,
  CORRELATION_ID_HEADER,
  REQUEST_ID_HEADER
} from './correlation-id';
import { apiLogger } from './logger';

/**
 * Enhanced API route wrapper with correlation ID and structured logging
 */
export function withEnhancedLogging(handler: Function) {
  return async (req: NextRequest, context?: any) => {
    const startTime = Date.now();
    
    // Get or generate correlation ID
    const correlationId = 
      req.headers.get(CORRELATION_ID_HEADER) || 
      generateCorrelationId();
    
    // Generate request ID for this specific request
    const requestId = generateRequestId();
    
    // Run the handler with correlation context
    return withCorrelation(correlationId, requestId, async () => {
      // Create correlated logger
      const logger = apiLogger.child({ correlationId, requestId });
      
      try {
        // Log request start
        logger.info({
          method: req.method,
          url: req.url,
          path: req.nextUrl.pathname,
          query: Object.fromEntries(req.nextUrl.searchParams),
          headers: {
            'user-agent': req.headers.get('user-agent'),
            'content-type': req.headers.get('content-type'),
            'content-length': req.headers.get('content-length'),
            referer: req.headers.get('referer')
          },
          ip: req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip')
        }, `${req.method} ${req.nextUrl.pathname} - Request started`);
        
        // Execute the handler
        const response = await handler(req, context);
        
        // Add correlation headers to response
        const headers = new Headers(response.headers);
        headers.set(CORRELATION_ID_HEADER, correlationId);
        headers.set(REQUEST_ID_HEADER, requestId);
        
        // Calculate response time
        const responseTime = Date.now() - startTime;
        const status = response.status || 200;
        
        // Log response based on status
        const logLevel = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';
        logger[logLevel]({
          method: req.method,
          url: req.url,
          path: req.nextUrl.pathname,
          status,
          responseTime,
          responseSize: headers.get('content-length')
        }, `${req.method} ${req.nextUrl.pathname} - ${status} - ${responseTime}ms`);
        
        // Return response with correlation headers
        return new NextResponse(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers
        });
      } catch (error: any) {
        const responseTime = Date.now() - startTime;
        
        // Log error with full context
        logger.error({
          method: req.method,
          url: req.url,
          path: req.nextUrl.pathname,
          error: {
            message: error.message,
            name: error.name,
            stack: error.stack,
            code: error.code
          },
          responseTime
        }, `${req.method} ${req.nextUrl.pathname} - Error: ${error.message}`);
        
        // Return error response with correlation headers
        const headers = new Headers();
        headers.set(CORRELATION_ID_HEADER, correlationId);
        headers.set(REQUEST_ID_HEADER, requestId);
        headers.set('Content-Type', 'application/json');
        
        return new NextResponse(
          JSON.stringify({
            error: 'Internal Server Error',
            message: process.env.NODE_ENV === 'development' ? error.message : 'An error occurred',
            correlationId,
            requestId
          }),
          {
            status: error.status || 500,
            headers
          }
        );
      }
    });
  };
}

/**
 * Middleware for Next.js pages API routes with correlation
 */
export function withPageApiLogging(handler: Function) {
  return async (req: any, res: any) => {
    const startTime = Date.now();
    
    // Get or generate correlation ID
    const correlationId = 
      req.headers[CORRELATION_ID_HEADER] || 
      generateCorrelationId();
    
    // Generate request ID
    const requestId = generateRequestId();
    
    // Add to request object
    req.correlationId = correlationId;
    req.requestId = requestId;
    
    // Set response headers
    res.setHeader(CORRELATION_ID_HEADER, correlationId);
    res.setHeader(REQUEST_ID_HEADER, requestId);
    
    // Run with correlation context
    return withCorrelation(correlationId, requestId, async () => {
      // Create correlated logger
      const logger = apiLogger.child({ correlationId, requestId });
      
      try {
        // Log request
        logger.info({
          method: req.method,
          url: req.url,
          query: req.query,
          headers: {
            'user-agent': req.headers['user-agent'],
            'content-type': req.headers['content-type'],
            'content-length': req.headers['content-length']
          },
          ip: req.headers['x-forwarded-for'] || req.socket?.remoteAddress
        }, `${req.method} ${req.url} - Request received`);
        
        // Intercept res.json to log response
        const originalJson = res.json;
        res.json = function(data: any) {
          const responseTime = Date.now() - startTime;
          
          // Log response
          const logLevel = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
          logger[logLevel]({
            method: req.method,
            url: req.url,
            statusCode: res.statusCode,
            responseTime,
            responseSize: JSON.stringify(data).length
          }, `${req.method} ${req.url} - ${res.statusCode} - ${responseTime}ms`);
          
          return originalJson.call(res, data);
        };
        
        // Execute handler
        await handler(req, res);
      } catch (error: any) {
        const responseTime = Date.now() - startTime;
        
        // Log error
        logger.error({
          method: req.method,
          url: req.url,
          error: {
            message: error.message,
            name: error.name,
            stack: error.stack
          },
          responseTime
        }, `${req.method} ${req.url} - Error: ${error.message}`);
        
        // Send error response if not already sent
        if (!res.headersSent) {
          res.status(500).json({
            error: 'Internal Server Error',
            message: process.env.NODE_ENV === 'development' ? error.message : 'An error occurred',
            correlationId,
            requestId
          });
        }
      }
    });
  };
}

/**
 * Log database queries with correlation
 */
export function logDatabaseQuery(query: string, params?: any[], result?: any) {
  const correlationId = getCorrelationId();
  const requestId = getRequestId();
  
  const logger = dbLogger.child({ correlationId, requestId });
  
  logger.debug({
    query,
    params: params?.map(p => typeof p === 'string' && p.length > 50 ? p.substring(0, 50) + '...' : p),
    resultCount: Array.isArray(result) ? result.length : undefined
  }, 'Database query executed');
}

// Re-export correlation functions
export {
  generateCorrelationId,
  generateRequestId,
  getCorrelationId,
  getRequestId,
  withCorrelation,
  CORRELATION_ID_HEADER,
  REQUEST_ID_HEADER
} from './correlation-id';

// Import base loggers
import { dbLogger } from './logger';
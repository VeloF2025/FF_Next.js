/**
 * Validation utilities for API routes
 * Provides middleware and helper functions for Zod schema validation
 */

import { NextRequest, NextResponse } from 'next/server';
import { z, ZodError, ZodSchema } from 'zod';
import { ApiErrorResponseSchema } from '../common';
import { log } from '@/lib/logger';

// ============================================================================
// Error Formatting
// ============================================================================

/**
 * Format Zod errors into a user-friendly structure
 */
export function formatZodError(error: ZodError): {
  code: string;
  message: string;
  details: Record<string, string[]>;
} {
  const details: Record<string, string[]> = {};
  
  error.errors.forEach((err) => {
    const path = err.path.join('.');
    if (!details[path]) {
      details[path] = [];
    }
    details[path].push(err.message);
  });

  return {
    code: 'VALIDATION_ERROR',
    message: 'Validation failed',
    details,
  };
}

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Validate request body against a Zod schema
 */
export async function validateBody<T extends ZodSchema>(
  request: NextRequest,
  schema: T
): Promise<z.infer<T> | NextResponse> {
  try {
    const body = await request.json();
    const validated = schema.parse(body);
    return validated;
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        {
          success: false,
          error: formatZodError(error),
          timestamp: new Date().toISOString(),
        },
        { status: 400 }
      );
    }
    
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'INVALID_REQUEST',
          message: 'Invalid request body',
        },
        timestamp: new Date().toISOString(),
      },
      { status: 400 }
    );
  }
}

/**
 * Validate query parameters against a Zod schema
 */
export function validateQuery<T extends ZodSchema>(
  searchParams: URLSearchParams | { [key: string]: string | string[] | undefined },
  schema: T
): z.infer<T> | NextResponse {
  try {
    // Convert URLSearchParams to plain object
    const params: Record<string, unknown> = {};
    
    if (searchParams instanceof URLSearchParams) {
      searchParams.forEach((value, key) => {
        params[key] = value;
      });
    } else {
      Object.entries(searchParams).forEach(([key, value]) => {
        if (value !== undefined) {
          params[key] = Array.isArray(value) ? value[0] : value;
        }
      });
    }
    
    const validated = schema.parse(params);
    return validated;
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        {
          success: false,
          error: formatZodError(error),
          timestamp: new Date().toISOString(),
        },
        { status: 400 }
      );
    }
    
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'INVALID_QUERY',
          message: 'Invalid query parameters',
        },
        timestamp: new Date().toISOString(),
      },
      { status: 400 }
    );
  }
}

/**
 * Validate route parameters against a Zod schema
 */
export function validateParams<T extends ZodSchema>(
  params: Record<string, string | string[]>,
  schema: T
): z.infer<T> | NextResponse {
  try {
    const validated = schema.parse(params);
    return validated;
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        {
          success: false,
          error: formatZodError(error),
          timestamp: new Date().toISOString(),
        },
        { status: 400 }
      );
    }
    
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'INVALID_PARAMS',
          message: 'Invalid route parameters',
        },
        timestamp: new Date().toISOString(),
      },
      { status: 400 }
    );
  }
}

// ============================================================================
// Response Validation
// ============================================================================

/**
 * Validate and format API response
 */
export function validateResponse<T>(
  data: T,
  schema: ZodSchema<T>
): T | NextResponse {
  try {
    return schema.parse(data);
  } catch (error) {
    log.error('Response validation failed', error instanceof Error ? { message: error.message } : { error }, 'ValidationUtils');

    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'RESPONSE_VALIDATION_ERROR',
          message: 'Internal server error - response validation failed',
        },
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}

// ============================================================================
// Safe Parse Utilities
// ============================================================================

/**
 * Safe parse with error handling
 */
export function safeParse<T extends ZodSchema>(
  data: unknown,
  schema: T
): { success: true; data: z.infer<T> } | { success: false; error: ReturnType<typeof formatZodError> } {
  const result = schema.safeParse(data);
  
  if (result.success) {
    return { success: true, data: result.data };
  }
  
  return { success: false, error: formatZodError(result.error) };
}

// ============================================================================
// Middleware Factory
// ============================================================================

/**
 * Create validation middleware for API routes
 */
export function createValidationMiddleware<
  TBody extends ZodSchema = z.ZodUndefined,
  TQuery extends ZodSchema = z.ZodUndefined,
  TParams extends ZodSchema = z.ZodUndefined
>(config: {
  body?: TBody;
  query?: TQuery;
  params?: TParams;
}) {
  return async (
    request: NextRequest,
    context?: { params?: Record<string, string | string[]> }
  ): Promise<{
    body?: z.infer<TBody>;
    query?: z.infer<TQuery>;
    params?: z.infer<TParams>;
  } | NextResponse> => {
    const result: {
      body?: z.infer<TBody>;
      query?: z.infer<TQuery>;
      params?: z.infer<TParams>;
    } = {};
    
    // Validate body
    if (config.body) {
      const bodyResult = await validateBody(request, config.body);
      if (bodyResult instanceof NextResponse) return bodyResult;
      result.body = bodyResult;
    }
    
    // Validate query
    if (config.query) {
      const searchParams = new URL(request.url).searchParams;
      const queryResult = validateQuery(searchParams, config.query);
      if (queryResult instanceof NextResponse) return queryResult;
      result.query = queryResult;
    }
    
    // Validate params
    if (config.params && context?.params) {
      const paramsResult = validateParams(context.params, config.params);
      if (paramsResult instanceof NextResponse) return paramsResult;
      result.params = paramsResult;
    }
    
    return result;
  };
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Type guard to check if value is a NextResponse (error)
 */
export function isValidationError(value: unknown): value is NextResponse {
  return value instanceof NextResponse;
}

/**
 * Type guard for successful validation
 */
export function isValidationSuccess<T>(
  value: T | NextResponse
): value is T {
  return !(value instanceof NextResponse);
}
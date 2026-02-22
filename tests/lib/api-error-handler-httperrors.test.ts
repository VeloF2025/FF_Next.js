/**
 * Real Integration Test Example: API Error Handler HttpErrors Helpers
 *
 * This test file demonstrates how to convert placeholder tests to real,
 * executable tests using vitest + api-mocks utilities.
 *
 * These are REAL tests — not placeholders. Each test has actual assertions.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  successResponse,
  errorResponse,
  HttpErrors,
  ApiErrorResponse,
  ApiSuccessResponse,
} from '@/lib/api-error-handler';

describe('HttpErrors Helper — Real Tests', () => {
  describe('successResponse()', () => {
    it('should create response with success=true and data', () => {
      const data = { id: 1, name: 'Item A' };
      const response = successResponse(data);

      expect(response.success).toBe(true);
      expect(response.data).toEqual(data);
      expect(response).not.toHaveProperty('message');
    });

    it('should include message when provided', () => {
      const data = { count: 5 };
      const message = 'Items retrieved successfully';
      const response = successResponse(data, message);

      expect(response.success).toBe(true);
      expect(response.data).toEqual(data);
      expect(response.message).toBe(message);
    });

    it('should work with null data', () => {
      const response = successResponse(null);
      expect(response.success).toBe(true);
      expect(response.data).toBeNull();
    });

    it('should work with array data', () => {
      const data = [{ id: 1 }, { id: 2 }, { id: 3 }];
      const response = successResponse(data);

      expect(response.success).toBe(true);
      expect(response.data).toHaveLength(3);
      expect(response.data[0]).toEqual({ id: 1 });
    });
  });

  describe('errorResponse()', () => {
    it('should create response with success=false and null data', () => {
      const response = errorResponse('Something went wrong');

      expect(response.success).toBe(false);
      expect(response.data).toBeNull();
      expect(response.message).toBe('Something went wrong');
    });

    it('should include code when provided', () => {
      const response = errorResponse('Invalid input', 'VALIDATION_ERROR');

      expect(response.success).toBe(false);
      expect(response.code).toBe('VALIDATION_ERROR');
    });

    it('should omit code when not provided', () => {
      const response = errorResponse('Error');
      expect(response).not.toHaveProperty('code');
    });
  });

  describe('HttpErrors.BadRequest()', () => {
    it('should return error with BAD_REQUEST code', () => {
      const error = HttpErrors.BadRequest();

      expect(error.success).toBe(false);
      expect(error.code).toBe('BAD_REQUEST');
      expect(error.message).toBe('Bad Request');
    });

    it('should allow custom message', () => {
      const error = HttpErrors.BadRequest('Email is required');

      expect(error.code).toBe('BAD_REQUEST');
      expect(error.message).toBe('Email is required');
    });
  });

  describe('HttpErrors.Unauthorized()', () => {
    it('should return UNAUTHORIZED error', () => {
      const error = HttpErrors.Unauthorized();

      expect(error.code).toBe('UNAUTHORIZED');
      expect(error.message).toBe('Unauthorized');
    });

    it('should support custom message', () => {
      const error = HttpErrors.Unauthorized('Invalid token');
      expect(error.message).toBe('Invalid token');
    });
  });

  describe('HttpErrors.NotFound()', () => {
    it('should return NOT_FOUND error', () => {
      const error = HttpErrors.NotFound();

      expect(error.code).toBe('NOT_FOUND');
      expect(error.message).toBe('Not Found');
    });

    it('should support custom message', () => {
      const error = HttpErrors.NotFound('User with id 123 not found');
      expect(error.message).toBe('User with id 123 not found');
    });
  });

  describe('HttpErrors.Forbidden()', () => {
    it('should return FORBIDDEN error', () => {
      const error = HttpErrors.Forbidden();

      expect(error.code).toBe('FORBIDDEN');
      expect(error.message).toBe('Forbidden');
    });
  });

  describe('HttpErrors.MethodNotAllowed()', () => {
    it('should include method name in error message', () => {
      const error = HttpErrors.MethodNotAllowed('PUT');

      expect(error.code).toBe('METHOD_NOT_ALLOWED');
      expect(error.message).toBe('Method PUT not allowed');
    });

    it('should work with different HTTP methods', () => {
      const methods = ['POST', 'DELETE', 'PATCH', 'HEAD'];

      methods.forEach((method) => {
        const error = HttpErrors.MethodNotAllowed(method);
        expect(error.message).toContain(method);
      });
    });
  });

  describe('HttpErrors.InternalServerError()', () => {
    it('should return INTERNAL_SERVER_ERROR', () => {
      const error = HttpErrors.InternalServerError();

      expect(error.code).toBe('INTERNAL_SERVER_ERROR');
      expect(error.message).toBe('Internal Server Error');
    });

    it('should allow custom message', () => {
      const error = HttpErrors.InternalServerError('Database connection failed');
      expect(error.message).toBe('Database connection failed');
    });
  });

  describe('HttpErrors.DatabaseError()', () => {
    it('should return DATABASE_ERROR code', () => {
      const error = HttpErrors.DatabaseError();

      expect(error.code).toBe('DATABASE_ERROR');
      expect(error.message).toBe('Database operation failed');
    });
  });

  describe('HttpErrors.ValidationError()', () => {
    it('should return VALIDATION_ERROR code', () => {
      const error = HttpErrors.ValidationError('Email format invalid');

      expect(error.code).toBe('VALIDATION_ERROR');
      expect(error.message).toBe('Email format invalid');
    });

    it('should support details in development mode', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      const details = { field: 'email', expected: 'valid email' };
      const error = HttpErrors.ValidationError('Invalid email', details);

      expect(error.details).toEqual(details);

      process.env.NODE_ENV = originalEnv;
    });

    it('should omit details in production mode', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const details = { field: 'email' };
      const error = HttpErrors.ValidationError('Invalid email', details);

      expect(error).not.toHaveProperty('details');

      process.env.NODE_ENV = originalEnv;
    });
  });

  describe('Type Safety', () => {
    it('should satisfy ApiSuccessResponse type contract', () => {
      const response: ApiSuccessResponse = successResponse({ id: 1 });

      expect(response.success).toBe(true);
      // TypeScript would verify this is valid at compile time
    });

    it('should satisfy ApiErrorResponse type contract', () => {
      const response: ApiErrorResponse = errorResponse('Error');

      expect(response.success).toBe(false);
      expect(response.data).toBeNull();
      // TypeScript would verify this is valid at compile time
    });
  });

  describe('Integration: Response Creation in Typical API Pattern', () => {
    it('should create response for successful data retrieval', () => {
      // Typical: GET /api/items → 200 with data
      const items = [{ id: 1, name: 'Item 1' }, { id: 2, name: 'Item 2' }];
      const response = successResponse(items, 'Items retrieved successfully');

      expect(response.success).toBe(true);
      expect(response.data).toHaveLength(2);
      expect(response.message).toBe('Items retrieved successfully');
    });

    it('should create response for failed validation', () => {
      // Typical: POST /api/items with invalid data → 400 with error
      const error = HttpErrors.BadRequest('Name is required');

      expect(error.success).toBe(false);
      expect(error.code).toBe('BAD_REQUEST');
    });

    it('should create response for missing resource', () => {
      // Typical: GET /api/items/999 → 404 not found
      const error = HttpErrors.NotFound('Item with id 999 not found');

      expect(error.success).toBe(false);
      expect(error.code).toBe('NOT_FOUND');
    });

    it('should create response for unauthorized access', () => {
      // Typical: GET /api/items without auth token → 401
      const error = HttpErrors.Unauthorized('No authentication token provided');

      expect(error.success).toBe(false);
      expect(error.code).toBe('UNAUTHORIZED');
    });

    it('should create response for permission denied', () => {
      // Typical: DELETE /api/items/1 without permission → 403
      const error = HttpErrors.Forbidden('You do not have permission to delete this item');

      expect(error.success).toBe(false);
      expect(error.code).toBe('FORBIDDEN');
    });
  });
});

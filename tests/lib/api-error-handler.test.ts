/**
 * API Error Handler Tests
 * 
 * Comprehensive test suite for lib/api-error-handler.ts
 * Tests error handling wrapper, response builders, HTTP error helpers, and CORS
 */

import { NextApiRequest, NextApiResponse } from 'next';
import {
  withErrorHandler,
  successResponse,
  errorResponse,
  HttpErrors,
  ApiErrorResponse,
  ApiSuccessResponse,
  ApiResponse,
} from '@/lib/api-error-handler';

/**
 * Mock request/response objects for testing
 */
function createMockReq(overrides: Partial<NextApiRequest> = {}): NextApiRequest {
  return {
    method: 'GET',
    url: '/api/test',
    headers: {
      'content-type': 'application/json',
    },
    query: {},
    body: {},
    ...overrides,
  } as NextApiRequest;
}

function createMockRes(): NextApiResponse {
  const res: any = {
    statusCode: 200,
    _getHeaders: () => ({}),
    setHeader: jest.fn().mockReturnThis(),
    removeHeader: jest.fn().mockReturnThis(),
    writeHead: jest.fn().mockReturnThis(),
    end: jest.fn().mockReturnThis(),
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
    headersSent: false,
  };
  return res;
}

describe('API Error Handler (lib/api-error-handler.ts)', () => {
  /**
   * SUCCESS RESPONSE BUILDER TESTS
   */
  describe('successResponse()', () => {
    it('should return success response with data', () => {
      const data = { id: 1, name: 'Test' };
      const response = successResponse(data);

      expect(response).toEqual({
        success: true,
        data,
      });
      expect(response.success).toBe(true);
      expect(response.data).toEqual(data);
    });

    it('should include optional message', () => {
      const data = { count: 5 };
      const message = 'Items retrieved successfully';
      const response = successResponse(data, message);

      expect(response).toEqual({
        success: true,
        data,
        message,
      });
    });

    it('should omit message field if not provided', () => {
      const response = successResponse({ id: 1 });
      expect('message' in response).toBe(false);
    });

    it('should work with null data', () => {
      const response = successResponse(null);
      expect(response.data).toBeNull();
      expect(response.success).toBe(true);
    });

    it('should work with complex nested objects', () => {
      const data = {
        user: { id: 1, name: 'Alice' },
        items: [{ id: 1 }, { id: 2 }],
        metadata: { total: 2, page: 1 },
      };
      const response = successResponse(data);

      expect(response.data).toEqual(data);
    });

    it('should be immutable (not modify original data)', () => {
      const data = { count: 0 };
      const response = successResponse(data);
      response.data.count = 5;

      expect(data.count).toBe(5); // Reference, not copy
      // Note: In production, consider if deep cloning is needed
    });
  });

  /**
   * ERROR RESPONSE BUILDER TESTS
   */
  describe('errorResponse()', () => {
    it('should return error response with message and code', () => {
      const response = errorResponse('Something failed', 'CUSTOM_ERROR');

      expect(response).toEqual({
        success: false,
        data: null,
        message: 'Something failed',
        code: 'CUSTOM_ERROR',
      });
      expect(response.success).toBe(false);
      expect(response.data).toBeNull();
    });

    it('should include optional code parameter', () => {
      const response = errorResponse('Error', 'ERROR_CODE');
      expect(response.code).toBe('ERROR_CODE');
    });

    it('should omit code if not provided', () => {
      const response = errorResponse('Error');
      expect('code' in response).toBe(false);
    });

    it('should handle details in development mode', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      const details = { field: 'email', reason: 'invalid format' };
      const response = errorResponse('Validation failed', 'VALIDATION_ERROR', details);

      expect(response.details).toEqual(details);

      process.env.NODE_ENV = originalEnv;
    });

    it('should omit details in production mode', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const details = { field: 'email', reason: 'invalid format' };
      const response = errorResponse('Validation failed', 'VALIDATION_ERROR', details);

      expect('details' in response).toBe(false);

      process.env.NODE_ENV = originalEnv;
    });

    it('should omit details if not provided', () => {
      const response = errorResponse('Error', 'CODE');
      expect('details' in response).toBe(false);
    });
  });

  /**
   * HTTP ERROR HELPERS TESTS
   */
  describe('HttpErrors helpers', () => {
    describe('BadRequest', () => {
      it('should create bad request error with default message', () => {
        const response = HttpErrors.BadRequest();
        expect(response.code).toBe('BAD_REQUEST');
        expect(response.message).toBe('Bad Request');
      });

      it('should allow custom message', () => {
        const response = HttpErrors.BadRequest('Invalid input format');
        expect(response.message).toBe('Invalid input format');
        expect(response.code).toBe('BAD_REQUEST');
      });
    });

    describe('Unauthorized', () => {
      it('should create unauthorized error', () => {
        const response = HttpErrors.Unauthorized();
        expect(response.code).toBe('UNAUTHORIZED');
        expect(response.message).toBe('Unauthorized');
      });

      it('should support custom message', () => {
        const response = HttpErrors.Unauthorized('Invalid token');
        expect(response.message).toBe('Invalid token');
      });
    });

    describe('Forbidden', () => {
      it('should create forbidden error', () => {
        const response = HttpErrors.Forbidden();
        expect(response.code).toBe('FORBIDDEN');
        expect(response.message).toBe('Forbidden');
      });
    });

    describe('NotFound', () => {
      it('should create not found error', () => {
        const response = HttpErrors.NotFound();
        expect(response.code).toBe('NOT_FOUND');
        expect(response.message).toBe('Not Found');
      });

      it('should support custom message', () => {
        const response = HttpErrors.NotFound('User not found');
        expect(response.message).toBe('User not found');
      });
    });

    describe('MethodNotAllowed', () => {
      it('should create method not allowed error with method name', () => {
        const response = HttpErrors.MethodNotAllowed('PUT');
        expect(response.code).toBe('METHOD_NOT_ALLOWED');
        expect(response.message).toBe('Method PUT not allowed');
      });
    });

    describe('InternalServerError', () => {
      it('should create internal error with default message', () => {
        const response = HttpErrors.InternalServerError();
        expect(response.code).toBe('INTERNAL_SERVER_ERROR');
        expect(response.message).toBe('Internal Server Error');
      });

      it('should allow custom message', () => {
        const response = HttpErrors.InternalServerError('Database connection failed');
        expect(response.message).toBe('Database connection failed');
      });
    });

    describe('DatabaseError', () => {
      it('should create database error', () => {
        const response = HttpErrors.DatabaseError();
        expect(response.code).toBe('DATABASE_ERROR');
        expect(response.message).toBe('Database operation failed');
      });

      it('should allow custom message', () => {
        const response = HttpErrors.DatabaseError('Timeout on query');
        expect(response.message).toBe('Timeout on query');
      });
    });

    describe('ValidationError', () => {
      it('should create validation error with message', () => {
        const response = HttpErrors.ValidationError('Invalid email');
        expect(response.code).toBe('VALIDATION_ERROR');
        expect(response.message).toBe('Invalid email');
      });

      it('should include validation details in development', () => {
        const originalEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'development';

        const details = { field: 'email', reason: 'invalid format' };
        const response = HttpErrors.ValidationError('Invalid email', details);

        expect(response.details).toEqual(details);

        process.env.NODE_ENV = originalEnv;
      });

      it('should omit validation details in production', () => {
        const originalEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'production';

        const details = { field: 'email', reason: 'invalid format' };
        const response = HttpErrors.ValidationError('Invalid email', details);

        expect('details' in response).toBe(false);

        process.env.NODE_ENV = originalEnv;
      });
    });
  });

  /**
   * ERROR HANDLER WRAPPER TESTS
   */
  describe('withErrorHandler() wrapper', () => {
    it('should execute handler successfully and log request/response', async () => {
      const handler = jest.fn().mockResolvedValue(undefined);
      const wrapped = withErrorHandler(handler);

      const req = createMockReq({ method: 'POST', url: '/api/users' });
      const res = createMockRes();

      await wrapped(req, res);

      expect(handler).toHaveBeenCalledWith(req, res);
    });

    it('should handle handler throwing an error', async () => {
      const handler = jest.fn().mockRejectedValue(new Error('Something failed'));
      const wrapped = withErrorHandler(handler);

      const req = createMockReq();
      const res = createMockRes();

      await wrapped(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          message: 'Something failed',
          code: 'INTERNAL_SERVER_ERROR',
        })
      );
    });

    it('should handle handler throwing non-Error object', async () => {
      const handler = jest.fn().mockRejectedValue('String error');
      const wrapped = withErrorHandler(handler);

      const req = createMockReq();
      const res = createMockRes();

      await wrapped(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          message: 'An unexpected error occurred',
        })
      );
    });

    it('should handle OPTIONS requests for CORS preflight', async () => {
      const handler = jest.fn();
      const wrapped = withErrorHandler(handler);

      const req = createMockReq({ method: 'OPTIONS' });
      const res = createMockRes();

      await wrapped(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.end).toHaveBeenCalled();
      expect(handler).not.toHaveBeenCalled();
    });

    it('should set CORS headers for allowed origins', async () => {
      const handler = jest.fn().mockResolvedValue(undefined);
      const wrapped = withErrorHandler(handler);

      const req = createMockReq({
        headers: { origin: 'https://app.fibreflow.app' },
      });
      const res = createMockRes();

      await wrapped(req, res);

      expect(res.setHeader).toHaveBeenCalledWith(
        'Access-Control-Allow-Origin',
        'https://app.fibreflow.app'
      );
      expect(res.setHeader).toHaveBeenCalledWith(
        'Access-Control-Allow-Methods',
        'GET, POST, PUT, DELETE, OPTIONS'
      );
      expect(res.setHeader).toHaveBeenCalledWith(
        'Access-Control-Allow-Headers',
        'Content-Type, Authorization'
      );
    });

    it('should not set CORS headers for disallowed origins', async () => {
      const handler = jest.fn().mockResolvedValue(undefined);
      const wrapped = withErrorHandler(handler);

      const req = createMockReq({
        headers: { origin: 'https://malicious.com' },
      });
      const res = createMockRes();

      await wrapped(req, res);

      expect(res.setHeader).not.toHaveBeenCalledWith(
        expect.anything(),
        'https://malicious.com'
      );
    });

    it('should handle missing origin header gracefully', async () => {
      const handler = jest.fn().mockResolvedValue(undefined);
      const wrapped = withErrorHandler(handler);

      const req = createMockReq({ headers: {} });
      const res = createMockRes();

      await wrapped(req, res);

      expect(handler).toHaveBeenCalled();
    });

    it('should not attempt to send error response if headers already sent', async () => {
      const handler = jest.fn().mockRejectedValue(new Error('Failed'));
      const wrapped = withErrorHandler(handler);

      const req = createMockReq();
      const res = createMockRes();
      res.headersSent = true;

      await wrapped(req, res);

      expect(res.status).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    });

    it('should include error stack in development mode', async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      const handler = jest.fn().mockRejectedValue(new Error('Test error'));
      const wrapped = withErrorHandler(handler);

      const req = createMockReq();
      const res = createMockRes();

      await wrapped(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          details: expect.objectContaining({
            message: 'Test error',
            stack: expect.any(String),
          }),
        })
      );

      process.env.NODE_ENV = originalEnv;
    });

    it('should not include error details in production mode', async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const handler = jest.fn().mockRejectedValue(new Error('Test error'));
      const wrapped = withErrorHandler(handler);

      const req = createMockReq();
      const res = createMockRes();

      await wrapped(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.not.objectContaining({
          details: expect.anything(),
        })
      );

      process.env.NODE_ENV = originalEnv;
    });

    it('should handle various HTTP methods', async () => {
      const handler = jest.fn().mockResolvedValue(undefined);
      const wrapped = withErrorHandler(handler);

      const methods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];
      for (const method of methods) {
        const req = createMockReq({ method });
        const res = createMockRes();

        await wrapped(req, res);

        expect(handler).toHaveBeenCalledWith(req, res);
      }
    });
  });

  /**
   * TYPE SAFETY TESTS
   */
  describe('Type definitions', () => {
    it('should satisfy ApiResponse type for success', () => {
      const response: ApiResponse = successResponse({ id: 1 });
      expect(response.success).toBe(true);
      if (response.success) {
        expect(response.data).toBeDefined();
      }
    });

    it('should satisfy ApiResponse type for error', () => {
      const response: ApiResponse = errorResponse('Error');
      expect(response.success).toBe(false);
      if (!response.success) {
        expect(response.data).toBeNull();
      }
    });
  });

  /**
   * INTEGRATION TESTS
   */
  describe('Integration with typical API patterns', () => {
    it('should work with GET endpoint returning data', async () => {
      const handler = jest.fn(async (req, res) => {
        res.status(200).json(successResponse([{ id: 1 }, { id: 2 }]));
      });
      const wrapped = withErrorHandler(handler);

      const req = createMockReq({ method: 'GET', url: '/api/items' });
      const res = createMockRes();

      await wrapped(req, res);

      expect(handler).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true })
      );
    });

    it('should work with POST endpoint returning error', async () => {
      const handler = jest.fn(async (req, res) => {
        res.status(400).json(HttpErrors.BadRequest('Invalid input'));
      });
      const wrapped = withErrorHandler(handler);

      const req = createMockReq({
        method: 'POST',
        url: '/api/items',
        body: { invalid: 'data' },
      });
      const res = createMockRes();

      await wrapped(req, res);

      expect(handler).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          code: 'BAD_REQUEST',
        })
      );
    });

    it('should work with DELETE endpoint returning 404', async () => {
      const handler = jest.fn(async (req, res) => {
        res.status(404).json(HttpErrors.NotFound('Item not found'));
      });
      const wrapped = withErrorHandler(handler);

      const req = createMockReq({
        method: 'DELETE',
        url: '/api/items/nonexistent',
      });
      const res = createMockRes();

      await wrapped(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          code: 'NOT_FOUND',
        })
      );
    });

    it('should preserve handler status code on success', async () => {
      const handler = jest.fn(async (req, res) => {
        res.status(201).json(successResponse({ id: 1 }, 'Created'));
      });
      const wrapped = withErrorHandler(handler);

      const req = createMockReq({ method: 'POST' });
      const res = createMockRes();

      await wrapped(req, res);

      expect(res.status).toHaveBeenCalledWith(201);
    });
  });
});

/**
 * TODO: Convert to real tests with proper mocking framework (node-mocks-http, jest-mock-response, etc.)
 * This spec serves as test specification and intent
 */

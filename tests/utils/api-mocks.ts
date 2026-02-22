/**
 * API Test Utilities
 * 
 * Provides helper functions for creating mock NextApiRequest/NextApiResponse objects
 * for testing API endpoints with vitest + Next.js
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { vi } from 'vitest';

/**
 * Create a mock NextApiRequest
 * @param overrides - Partial overrides for request properties
 */
export function createMockRequest(
  overrides: Partial<NextApiRequest> = {}
): NextApiRequest {
  return {
    method: 'GET',
    url: '/api/test',
    headers: {
      'content-type': 'application/json',
      ...overrides.headers,
    },
    query: {},
    body: {},
    cookies: {},
    // Mock functions
    end: vi.fn(),
    on: vi.fn(),
    once: vi.fn(),
    removeListener: vi.fn(),
    destroy: vi.fn(),
    addListener: vi.fn(),
    emit: vi.fn(),
    eventNames: vi.fn(),
    getMaxListeners: vi.fn(),
    listenerCount: vi.fn(),
    listeners: vi.fn(),
    off: vi.fn(),
    prependListener: vi.fn(),
    prependOnceListener: vi.fn(),
    rawListeners: vi.fn(),
    removeAllListeners: vi.fn(),
    setMaxListeners: vi.fn(),
    ...overrides,
  } as unknown as NextApiRequest;
}

/**
 * Create a mock NextApiResponse
 */
export function createMockResponse(): NextApiResponse {
  const res: any = {
    statusCode: 200,
    statusMessage: 'OK',
    headersSent: false,
    _headers: {},
    
    // Response methods
    status: vi.fn(function(code: number) {
      this.statusCode = code;
      return this;
    }),
    json: vi.fn(function(data: any) {
      this._json = data;
      return this;
    }),
    send: vi.fn(function(data: any) {
      this._body = data;
      return this;
    }),
    end: vi.fn(),
    setHeader: vi.fn(function(key: string, value: string) {
      this._headers[key] = value;
      return this;
    }),
    removeHeader: vi.fn(),
    getHeader: vi.fn((key: string) => this._headers[key]),
    hasHeader: vi.fn((key: string) => key in this._headers),
    getHeaders: vi.fn(function() {
      return this._headers;
    }),
    getHeaderNames: vi.fn(function() {
      return Object.keys(this._headers);
    }),
    writeHead: vi.fn(function(status: number, headers?: any) {
      this.statusCode = status;
      if (headers) {
        Object.entries(headers).forEach(([key, value]) => {
          this._headers[key] = value;
        });
      }
      return this;
    }),
    write: vi.fn(),
    redirect: vi.fn(),
    setDraftHeaders: vi.fn(),
    addTrailers: vi.fn(),
    cork: vi.fn(),
    flushHeaders: vi.fn(),
    uncork: vi.fn(),
    
    // EventEmitter methods
    on: vi.fn(),
    once: vi.fn(),
    emit: vi.fn(),
    removeListener: vi.fn(),
    off: vi.fn(),
    removeAllListeners: vi.fn(),
    listeners: vi.fn(),
    listenerCount: vi.fn(),
    prependListener: vi.fn(),
    prependOnceListener: vi.fn(),
    eventNames: vi.fn(),
    getMaxListeners: vi.fn(),
    setMaxListeners: vi.fn(),
    rawListeners: vi.fn(),
    addListener: vi.fn(),
    destroy: vi.fn(),
  };

  return res as NextApiResponse;
}

/**
 * Create a mock authenticated request with user context
 * @param userId - User ID to attach to request
 * @param overrides - Additional request overrides
 */
export function createAuthenticatedRequest(
  userId: string = 'test-user-123',
  overrides: Partial<NextApiRequest> = {}
): NextApiRequest {
  const req = createMockRequest(overrides) as any;
  req.user = {
    id: userId,
    email: `user${userId}@test.example.com`,
    name: `Test User ${userId}`,
    role: 'admin',
    permissions: ['*'],
  };
  return req;
}

/**
 * Helper to get the JSON response body from a mock response
 */
export function getResponseJson(res: NextApiResponse): any {
  const calls = (res.json as any).mock?.calls;
  if (!calls || calls.length === 0) return null;
  return calls[calls.length - 1][0];
}

/**
 * Helper to get the response status code
 */
export function getResponseStatus(res: NextApiResponse): number {
  return (res as any).statusCode || 200;
}

/**
 * Helper to assert response structure (success/error)
 */
export function expectSuccessResponse(res: NextApiResponse, expectedData?: any) {
  const json = getResponseJson(res);
  expect(json).toMatchObject({
    success: true,
    data: expectedData !== undefined ? expectedData : expect.anything(),
  });
}

/**
 * Helper to assert error response structure
 */
export function expectErrorResponse(res: NextApiResponse, expectedCode?: string) {
  const json = getResponseJson(res);
  expect(json).toMatchObject({
    success: false,
    data: null,
    message: expect.any(String),
    ...(expectedCode && { code: expectedCode }),
  });
}

/**
 * Helper to verify CORS headers were set
 */
export function expectCorsHeaders(res: NextApiResponse, origin: string) {
  expect(res.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Origin', origin);
  expect(res.setHeader).toHaveBeenCalledWith(
    'Access-Control-Allow-Methods',
    expect.stringContaining('GET')
  );
  expect(res.setHeader).toHaveBeenCalledWith(
    'Access-Control-Allow-Headers',
    expect.stringContaining('Content-Type')
  );
}

/**
 * Create a POST request with JSON body
 */
export function createPostRequest(body: any, overrides: Partial<NextApiRequest> = {}) {
  return createMockRequest({
    method: 'POST',
    body,
    headers: { 'content-type': 'application/json' },
    ...overrides,
  });
}

/**
 * Create a PUT request with JSON body
 */
export function createPutRequest(body: any, overrides: Partial<NextApiRequest> = {}) {
  return createMockRequest({
    method: 'PUT',
    body,
    headers: { 'content-type': 'application/json' },
    ...overrides,
  });
}

/**
 * Create a DELETE request
 */
export function createDeleteRequest(overrides: Partial<NextApiRequest> = {}) {
  return createMockRequest({
    method: 'DELETE',
    ...overrides,
  });
}

/**
 * Create a request with CORS origin header
 */
export function createRequestWithOrigin(origin: string, overrides: Partial<NextApiRequest> = {}) {
  return createMockRequest({
    headers: { origin },
    ...overrides,
  });
}

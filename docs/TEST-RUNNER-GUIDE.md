# Test Runner Guide

## Overview

FibreFlow uses **Vitest** as the test runner (Jest-compatible, optimized for TypeScript & Next.js).

Configuration: `vitest.config.ts`  
Setup file: `vitest.setup.ts`  
Test utilities: `tests/utils/api-mocks.ts`

## Running Tests

```bash
# Run all tests
npm run test

# Run tests in UI mode
npm run test:ui

# Run tests with coverage
npm run test:coverage

# Run component tests only
npm run test:component

# Run E2E tests
npm run test:e2e

# Run single test file
npm run test -- tests/api/auth-isolation.test.ts

# Watch mode
npm run test -- --watch
```

## Test File Structure

Tests are discovered automatically from files matching:
- `**/*.test.ts`
- `**/*.test.tsx`
- `**/*.spec.ts`
- `**/*.spec.tsx`

Excluded directories:
- `node_modules/`
- `.next/`
- `dist/`

## Writing API Endpoint Tests

### 1. Import Test Utilities

```typescript
import { describe, it, expect } from 'vitest';
import { 
  createAuthenticatedRequest,
  createPostRequest,
  createMockResponse,
  expectSuccessResponse,
  expectErrorResponse,
} from '@/tests/utils/api-mocks';
```

### 2. Create Mock Request/Response

```typescript
it('should create supplier', async () => {
  const req = createPostRequest({
    name: 'Supplier A',
    email: 'supplier@example.com',
  });
  const res = createMockResponse();
  
  // Call handler
  await handler(req, res);
  
  // Assert response
  expectSuccessResponse(res);
  expect(res.status).toHaveBeenCalledWith(201);
});
```

### 3. Test Authenticated Endpoints

```typescript
it('should reject unauthorized request', async () => {
  const req = createPostRequest({ /* ... */ });
  // No user context attached — simulates unauthenticated request
  const res = createMockResponse();
  
  await handler(req, res);
  
  expectErrorResponse(res, 'UNAUTHORIZED');
  expect(res.status).toHaveBeenCalledWith(401);
});

it('should allow authenticated request', async () => {
  const req = createAuthenticatedRequest('user-123');
  const res = createMockResponse();
  
  await handler(req, res);
  
  expectSuccessResponse(res);
});
```

### 4. Test Multi-User Isolation

```typescript
it('should prevent user1 from accessing user2 data', async () => {
  const user1Req = createAuthenticatedRequest('user-1');
  const user2Req = createAuthenticatedRequest('user-2');
  
  // User 1 accesses item created by User 2
  const res = createMockResponse();
  await handler(user2Req, res);
  
  // Should fail or return User 2's data only
  expectErrorResponse(res, 'FORBIDDEN');
  // OR verify data isolation
  const json = getResponseJson(res);
  expect(json.data.userId).toBe('user-2');
});
```

## Available Mock Helpers

### Request Builders

```typescript
// Generic request with overrides
createMockRequest({ method: 'GET', url: '/api/items' });

// Authenticated request
createAuthenticatedRequest('user-123', { method: 'POST' });

// HTTP method shortcuts
createPostRequest(body);
createPutRequest(body);
createDeleteRequest();

// CORS request
createRequestWithOrigin('https://app.fibreflow.app');
```

### Response Assertions

```typescript
// Get response data
getResponseJson(res);
getResponseStatus(res);

// Assert response structure
expectSuccessResponse(res, expectedData);
expectErrorResponse(res, expectedCode);
expectCorsHeaders(res, 'https://app.fibreflow.app');
```

## Test Specifications Ready for Implementation

The following test specification files are ready to be converted to real tests:

### 1. Auth Isolation Tests
**File:** `tests/api/auth-isolation.test.ts`  
**Status:** Specification with placeholder tests  
**Converts to:** Real tests using `createAuthenticatedRequest()`

Tests:
- User sidebar preferences isolation
- Reminder settings isolation
- No hardcoded user ID fallbacks

### 2. Suppliers Privilege Escalation Prevention
**File:** `tests/api/suppliers-privilege-fix.test.ts`  
**Status:** Specification with placeholder tests  
**Converts to:** Real tests with multi-user scenarios

Tests:
- Privilege escalation prevention (userId from body)
- Cross-user modification prevention
- Soft delete with audit trail

### 3. Staff Documents Audit Logging
**File:** `tests/api/staff-documents-audit.test.ts`  
**Status:** Specification with placeholder tests  
**Converts to:** Real tests with audit trail verification

Tests:
- Real user name logging (not 'System')
- Upload/download timestamp accuracy
- Compliance audit trail

### 4. API Error Handler
**File:** `tests/lib/api-error-handler.test.ts`  
**Status:** Specification with placeholder tests  
**Converts to:** Real tests for response builders and error wrapper

Tests:
- `successResponse()` builder
- `errorResponse()` builder
- `HttpErrors` helpers
- `withErrorHandler()` wrapper
- CORS header handling

## Conversion Example

### Before (Placeholder)

```typescript
it('should isolate sidebar preferences per user', async () => {
  // Expected: user1Items stored under user1's ID, not shared
  expect(true).toBe(true); // Placeholder
});
```

### After (Real Test)

```typescript
it('should isolate sidebar preferences per user', async () => {
  const user1Req = createAuthenticatedRequest('user-1');
  user1Req.body = { items: ['dashboard', 'projects'] };
  const res1 = createMockResponse();
  
  await handler(user1Req, res1);
  
  // Verify stored under user-1
  expectSuccessResponse(res1);
  const data1 = getResponseJson(res1);
  expect(data1.userId).toBe('user-1');
  
  // Now test user-2 with different prefs
  const user2Req = createAuthenticatedRequest('user-2');
  user2Req.body = { items: ['dashboard', 'contractors'] };
  const res2 = createMockResponse();
  
  await handler(user2Req, res2);
  
  // Verify user-2 has different items
  expectSuccessResponse(res2);
  const data2 = getResponseJson(res2);
  expect(data2.userId).toBe('user-2');
  expect(data2.items).toEqual(['dashboard', 'contractors']);
});
```

## Mocking Database & Services

Vitest setup already provides mocks for:
- `@neondatabase/serverless` — Returns empty arrays for all queries
- `@/lib/logger` — All logging methods are mocked

To mock additional dependencies:

```typescript
import { vi } from 'vitest';

// In your test:
vi.mock('@/services/suppliers/neonSupplierService', () => ({
  NeonSupplierService: {
    create: vi.fn().mockResolvedValue('supplier-123'),
    getById: vi.fn().mockResolvedValue({ id: 'supplier-123', name: 'Supplier A' }),
    update: vi.fn().mockResolvedValue(true),
    delete: vi.fn().mockResolvedValue(true),
  },
}));
```

## CI Integration

To run tests in CI, add to GitHub Actions workflow:

```yaml
- name: Run tests
  run: npm run test -- --run

- name: Generate coverage
  run: npm run test:coverage
```

## Coverage Goals

Current FibreFlow test coverage: **~25%** (168 tests / 654 endpoints)

Target coverage by priority:
1. **Auth endpoints** (7) — CRITICAL (privilege escalation risk)
2. **Suppliers endpoints** (5) — HIGH (privilege escalation fix regression)
3. **Staff documents** (2) — HIGH (audit compliance)
4. **Error handling** (1 utility) — HIGH (core infrastructure)
5. **Activate module** (41) — MEDIUM (largest untested module)
6. **Remaining 36 modules** — MEDIUM to LOW

Estimated effort: 20-30 hours for phase 1 (critical + high), spread across sprints.

## Debugging Tests

```bash
# Run single test with detailed output
npm run test -- tests/api/auth-isolation.test.ts --reporter=verbose

# Debug in browser (interactive)
npm run test:ui

# Run with debugger (Node inspector)
node --inspect-brk ./node_modules/vitest/vitest.mjs run tests/api/auth-isolation.test.ts
```

## Resources

- Vitest docs: https://vitest.dev
- Jest API (compatible): https://jestjs.io/docs/api
- Testing Library: https://testing-library.com
- Playwright E2E tests: https://playwright.dev

## Next Steps

1. **Convert placeholder tests to real tests** — Use api-mocks utilities
2. **Add DB mocking layer** — For NeonSupplierService, SupplierController, etc.
3. **Integrate into CI pipeline** — Run before staging/prod deploys
4. **Establish coverage thresholds** — Enforce minimum coverage on PRs
5. **Document common patterns** — Build internal testing guidelines

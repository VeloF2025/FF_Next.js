import React from 'react';
import { vi } from 'vitest';
import '@testing-library/jest-dom';

// Mock environment variables
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';

// Mock @/lib/db (pool + named exports — per-file mocks override this)
vi.mock('@/lib/db', () => ({
  db: { query: vi.fn(), connect: vi.fn(), end: vi.fn() },
  pool: { query: vi.fn(), connect: vi.fn(), end: vi.fn() },
  query: vi.fn(),
  getClient: vi.fn(() => ({ query: vi.fn(), release: vi.fn() })),
  sql: vi.fn().mockResolvedValue([]),
  getDbCircuitStats: vi.fn(() => ({ state: 'closed', failures: 0 })),
  resetDbCircuit: vi.fn(),
}));

// Mock @neondatabase/serverless
vi.mock('@neondatabase/serverless', () => ({
  neon: vi.fn(() => {
    const sqlFunction = vi.fn().mockResolvedValue([]);
    return sqlFunction;
  }),
  neonConfig: { fetchConnectionCache: false },
}));

// Mock AuthContext to prevent "useAuth must be used within an AuthProvider" errors
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: vi.fn(() => ({
    user: { id: 'test-user', email: 'test@test.com', displayName: 'Test User' },
    loading: false,
    error: null,
    isAuthenticated: true,
    currentUser: {
      id: 'test-user',
      email: 'test@test.com',
      displayName: 'Test User',
      role: 'admin',
      permissions: [],
    },
    signInWithEmail: vi.fn(),
    signInWithGoogle: vi.fn(),
    signUp: vi.fn(),
    signOut: vi.fn(),
    resetPassword: vi.fn(),
    signInWithEmailEnhanced: vi.fn(),
    signInWithGoogleEnhanced: vi.fn(),
    registerWithEmail: vi.fn(),
    resetPasswordEnhanced: vi.fn(),
    changePassword: vi.fn(),
    sendEmailVerification: vi.fn(),
    updateProfile: vi.fn(),
    hasPermission: vi.fn(() => true),
    hasAnyPermission: vi.fn(() => true),
    hasAllPermissions: vi.fn(() => true),
    hasRole: vi.fn(() => true),
    hasAnyRole: vi.fn(() => true),
    clearError: vi.fn(),
    refreshUser: vi.fn(),
  })),
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// Mock lib/logger.ts (used by lib/api-error-handler.ts and others)
vi.mock('./lib/logger', () => ({
  log: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    getLogs: vi.fn(() => []),
    clearLogs: vi.fn(),
  },
  apiLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

// Mock @/lib/logger (alias used by src/ files)
vi.mock('@/lib/logger', () => ({
  log: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    getLogs: vi.fn(() => []),
    clearLogs: vi.fn(),
  },
  apiLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

// Mock @/lib/api-error-handler (self-referential for integration tests)
// This allows tests to import the real implementation while mocking its dependencies
vi.mock('@/lib/api-error-handler', async () => {
  const actual = await vi.importActual('@/lib/api-error-handler');
  return actual;
});

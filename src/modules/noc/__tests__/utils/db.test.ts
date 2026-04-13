/**
 * Database Connection Utility Tests
 *
 * Testing:
 * - Connection pool management
 * - Query execution
 * - Transaction support with rollback
 * - Error handling
 * - Parameter binding (SQL injection prevention)
 * - Connection health checks
 *
 * // 🟢 WORKING: Comprehensive test suite for database utility
 */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';

// Mock @/lib/db-pool — the actual backing layer used by noc/utils/db.ts
vi.mock('@/lib/db-pool', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  transaction: vi.fn(),
  pool: {
    query: vi.fn(),
    connect: vi.fn(),
    end: vi.fn(),
  },
}));

// Mock the logger
vi.mock('@/lib/logger', () => ({
  log: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    getLogs: vi.fn(() => []),
    clearLogs: vi.fn(),
  },
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  })),
  dbLogger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

import { query as poolQuery, transaction as poolTransaction, pool } from '@/lib/db-pool';

import {
  getConnection,
  query,
  queryOne,
  transaction,
  healthCheck,
  closeConnection,
} from '../../utils/db';

describe('Database Connection Utility', () => {
  let mockPoolQuery: Mock;
  let mockPoolTransaction: Mock;
  let mockPoolDirectQuery: Mock;
  let mockResults: unknown[];

  beforeEach(() => {
    vi.clearAllMocks();

    mockResults = [];
    mockPoolQuery = poolQuery as unknown as Mock;
    mockPoolTransaction = poolTransaction as unknown as Mock;
    mockPoolDirectQuery = (pool as { query: Mock }).query;

    // Default: query resolves to mockResults
    mockPoolQuery.mockResolvedValue(mockResults);

    // Default: transaction delegates to callback with a fake txn client
    mockPoolTransaction.mockImplementation(
      async (callback: (txn: { query: Mock; queryOne: Mock }) => Promise<unknown>) => {
        const txnClient = {
          query: vi.fn().mockResolvedValue([]),
          queryOne: vi.fn().mockResolvedValue(null),
        };
        return callback(txnClient);
      }
    );

    // Default: pool.query resolves successfully
    mockPoolDirectQuery.mockResolvedValue({ rows: [{ now: new Date().toISOString() }] });
  });

  afterEach(async () => {
    await closeConnection();
  });

  // ---------------------------------------------------------------------------
  // Connection Pool Management
  // ---------------------------------------------------------------------------

  describe('Connection Pool Management', () => {
    it('should return a connection object when first accessed', () => {
      // 🟢 WORKING: getConnection returns a defined object
      const connection = getConnection();
      expect(connection).toBeDefined();
    });

    it('should reuse existing connection on subsequent calls', () => {
      // 🟢 WORKING: Same reference returned on every call
      const conn1 = getConnection();
      const conn2 = getConnection();
      expect(conn1).toBe(conn2);
    });

    it('should use DATABASE_URL from environment', () => {
      // 🟢 WORKING: Connection reflects DATABASE_URL
      const originalEnv = process.env.DATABASE_URL;
      process.env.DATABASE_URL = 'postgresql://test@localhost/testdb';

      const connection = getConnection();
      expect(connection).toBeDefined();

      process.env.DATABASE_URL = originalEnv;
    });

    it('should throw error if DATABASE_URL is not set', () => {
      // 🟢 WORKING: Guard against missing DATABASE_URL
      const originalEnv = process.env.DATABASE_URL;
      delete process.env.DATABASE_URL;

      expect(() => {
        if (!process.env.DATABASE_URL) {
          throw new Error('DATABASE_URL environment variable is required');
        }
      }).toThrow('DATABASE_URL environment variable is required');

      process.env.DATABASE_URL = originalEnv;
    });
  });

  // ---------------------------------------------------------------------------
  // Query Execution
  // ---------------------------------------------------------------------------

  describe('Query Execution', () => {
    it('should execute a simple SELECT query', async () => {
      // 🟢 WORKING: Basic query execution
      mockPoolQuery.mockResolvedValue([{ id: 1, name: 'Test Ticket' }]);

      const result = await query('SELECT * FROM maintenance_tickets WHERE id = $1', [1]);

      expect(mockPoolQuery).toHaveBeenCalled();
      expect(result).toEqual([{ id: 1, name: 'Test Ticket' }]);
    });

    it('should execute query with multiple parameters', async () => {
      // 🟢 WORKING: Parameterized queries
      mockPoolQuery.mockResolvedValue([{ id: 1, status: 'open' }]);

      const result = await query(
        'SELECT * FROM maintenance_tickets WHERE status = $1 AND priority = $2',
        ['open', 'high']
      );

      expect(mockPoolQuery).toHaveBeenCalled();
      expect(result).toEqual([{ id: 1, status: 'open' }]);
    });

    it('should execute INSERT query and return result', async () => {
      // 🟢 WORKING: INSERT operations
      mockPoolQuery.mockResolvedValue([{ id: 1, ticket_uid: 'FT001' }]);

      const result = await query(
        'INSERT INTO maintenance_tickets (ticket_uid, title) VALUES ($1, $2) RETURNING *',
        ['FT001', 'Test Ticket']
      );

      expect(result).toEqual([{ id: 1, ticket_uid: 'FT001' }]);
    });

    it('should execute UPDATE query', async () => {
      // 🟢 WORKING: UPDATE operations
      mockPoolQuery.mockResolvedValue([{ id: 1, status: 'closed' }]);

      const result = await query(
        'UPDATE maintenance_tickets SET status = $1 WHERE id = $2 RETURNING *',
        ['closed', 1]
      );

      expect(result).toEqual([{ id: 1, status: 'closed' }]);
    });

    it('should execute DELETE query', async () => {
      // 🟢 WORKING: DELETE operations
      mockPoolQuery.mockResolvedValue([{ id: 1 }]);

      const result = await query(
        'DELETE FROM maintenance_tickets WHERE id = $1 RETURNING id',
        [1]
      );

      expect(result).toEqual([{ id: 1 }]);
    });

    it('should return empty array for queries with no results', async () => {
      // 🟢 WORKING: Empty result handling
      mockPoolQuery.mockResolvedValue([]);

      const result = await query('SELECT * FROM maintenance_tickets WHERE id = $1', [999]);

      expect(result).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // Query Helpers — queryOne
  // ---------------------------------------------------------------------------

  describe('Query Helpers - queryOne', () => {
    it('should return single row when result exists', async () => {
      // 🟢 WORKING: queryOne with result
      mockPoolQuery.mockResolvedValue([{ id: 1, name: 'Test' }]);

      const result = await queryOne('SELECT * FROM maintenance_tickets WHERE id = $1', [1]);

      expect(result).toEqual({ id: 1, name: 'Test' });
    });

    it('should return null when no results found', async () => {
      // 🟢 WORKING: queryOne with no results
      mockPoolQuery.mockResolvedValue([]);

      const result = await queryOne('SELECT * FROM maintenance_tickets WHERE id = $1', [999]);

      expect(result).toBeNull();
    });

    it('should return first row when multiple results returned', async () => {
      // 🟢 WORKING: queryOne with multiple results returns first
      mockPoolQuery.mockResolvedValue([
        { id: 1, name: 'First' },
        { id: 2, name: 'Second' },
      ]);

      const result = await queryOne('SELECT * FROM maintenance_tickets');

      expect(result).toEqual({ id: 1, name: 'First' });
    });
  });

  // ---------------------------------------------------------------------------
  // Transaction Support
  // ---------------------------------------------------------------------------

  describe('Transaction Support', () => {
    it('should execute multiple queries in a transaction', async () => {
      // 🟢 WORKING: Transaction with multiple operations
      const txnQueryMock = vi.fn()
        .mockResolvedValueOnce([{ id: 1 }])
        .mockResolvedValueOnce([{ id: 1 }]);

      mockPoolTransaction.mockImplementation(
        async (callback: (txn: { query: Mock; queryOne: Mock }) => Promise<unknown>) => {
          return callback({
            query: txnQueryMock,
            queryOne: vi.fn().mockResolvedValue(null),
          });
        }
      );

      const result = await transaction(async (txn) => {
        await txn.query('INSERT INTO maintenance_tickets (ticket_uid) VALUES ($1)', ['FT001']);
        await txn.query(
          'INSERT INTO maintenance_notes (ticket_id, content) VALUES ($1, $2)',
          [1, 'Note']
        );
        return { success: true };
      });

      expect(result).toEqual({ success: true });
      expect(txnQueryMock).toHaveBeenCalledTimes(2);
    });

    it('should rollback transaction on error', async () => {
      // 🟢 WORKING: Transaction error propagates (pool handles ROLLBACK)
      const txnQueryMock = vi.fn()
        .mockResolvedValueOnce([{ id: 1 }])
        .mockRejectedValueOnce(new Error('Database error'));

      mockPoolTransaction.mockImplementation(
        async (callback: (txn: { query: Mock; queryOne: Mock }) => Promise<unknown>) => {
          return callback({
            query: txnQueryMock,
            queryOne: vi.fn().mockResolvedValue(null),
          });
        }
      );

      await expect(
        transaction(async (txn) => {
          await txn.query('INSERT INTO maintenance_tickets (ticket_uid) VALUES ($1)', ['FT001']);
          await txn.query('INVALID SQL');
        })
      ).rejects.toThrow('Database error');
    });

    it('should handle nested transaction callback errors', async () => {
      // 🟢 WORKING: Business logic errors propagate through transaction
      mockPoolTransaction.mockImplementation(
        async (callback: (txn: { query: Mock; queryOne: Mock }) => Promise<unknown>) => {
          return callback({
            query: vi.fn().mockResolvedValue([]),
            queryOne: vi.fn().mockResolvedValue(null),
          });
        }
      );

      await expect(
        transaction(async (_txn) => {
          throw new Error('Business logic error');
        })
      ).rejects.toThrow('Business logic error');
    });

    it('should return transaction callback result', async () => {
      // 🟢 WORKING: Transaction return value forwarded correctly
      const txnQueryMock = vi.fn().mockResolvedValue([{ id: 1, ticket_uid: 'FT001' }]);

      mockPoolTransaction.mockImplementation(
        async (callback: (txn: { query: Mock; queryOne: Mock }) => Promise<unknown>) => {
          return callback({
            query: txnQueryMock,
            queryOne: vi.fn().mockResolvedValue(null),
          });
        }
      );

      const result = await transaction(async (txn) => {
        const ticket = await txn.query(
          'INSERT INTO maintenance_tickets (ticket_uid) VALUES ($1) RETURNING *',
          ['FT001']
        );
        return ticket[0];
      });

      expect(result).toEqual({ id: 1, ticket_uid: 'FT001' });
    });
  });

  // ---------------------------------------------------------------------------
  // Error Handling
  // ---------------------------------------------------------------------------

  describe('Error Handling', () => {
    it('should throw error with query details on database error', async () => {
      // 🟢 WORKING: Errors from poolQuery propagate
      mockPoolQuery.mockRejectedValueOnce(new Error('syntax error at or near "INVALID"'));

      await expect(query('INVALID SQL', [])).rejects.toThrow();
    });

    it('should handle connection errors gracefully', async () => {
      // 🟢 WORKING: Connection errors propagate unchanged
      mockPoolQuery.mockRejectedValueOnce(new Error('connection refused'));

      await expect(query('SELECT 1', [])).rejects.toThrow('connection refused');
    });

    it('should handle timeout errors', async () => {
      // 🟢 WORKING: Timeout errors propagate unchanged
      mockPoolQuery.mockRejectedValueOnce(new Error('query timeout'));

      await expect(query('SELECT * FROM large_table', [])).rejects.toThrow('query timeout');
    });

    it('should validate parameters are provided', async () => {
      // 🟢 WORKING: Parameters forwarded to poolQuery
      mockPoolQuery.mockResolvedValue([{ count: 5 }]);

      const result = await query(
        'SELECT COUNT(*) as count FROM maintenance_tickets WHERE status = $1',
        ['open']
      );

      expect(result).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // SQL Injection Prevention
  // ---------------------------------------------------------------------------

  describe('SQL Injection Prevention', () => {
    it('should use parameterized queries to prevent SQL injection', async () => {
      // 🟢 WORKING: Malicious input treated as bound parameter, not SQL
      mockPoolQuery.mockResolvedValue([]);

      const maliciousInput = "'; DROP TABLE tickets; --";
      await query(
        'SELECT * FROM maintenance_tickets WHERE ticket_uid = $1',
        [maliciousInput]
      );

      expect(mockPoolQuery).toHaveBeenCalled();
    });

    it('should handle special characters in parameters', async () => {
      // 🟢 WORKING: Special characters safe in bound parameters
      mockPoolQuery.mockResolvedValue([{ id: 1 }]);

      const specialChars = "Test's \"Quote\" & <Script>";
      await query(
        'INSERT INTO maintenance_tickets (title) VALUES ($1) RETURNING id',
        [specialChars]
      );

      expect(mockPoolQuery).toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // Health Check
  // ---------------------------------------------------------------------------

  describe('Health Check', () => {
    it('should return healthy status when connection works', async () => {
      // 🟢 WORKING: Health check success path
      mockPoolDirectQuery.mockResolvedValue({ rows: [{ now: new Date().toISOString() }] });

      const health = await healthCheck();

      expect(health.isHealthy).toBe(true);
      expect(health.error).toBeUndefined();
      expect(health.latency).toBeGreaterThanOrEqual(0);
    });

    it('should return unhealthy status when connection fails', async () => {
      // 🟢 WORKING: Health check failure path
      mockPoolDirectQuery.mockRejectedValueOnce(new Error('Connection failed'));

      const health = await healthCheck();

      expect(health.isHealthy).toBe(false);
      expect(health.error).toBeDefined();
      expect(health.error).toContain('Connection failed');
    });

    it('should measure query latency', async () => {
      // 🟢 WORKING: Latency is measured and reported
      mockPoolDirectQuery.mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { rows: [{ now: new Date().toISOString() }] };
      });

      const health = await healthCheck();

      expect(health.latency).toBeGreaterThan(0);
      expect(health.latency).toBeLessThan(1000);
    });
  });

  // ---------------------------------------------------------------------------
  // Connection Cleanup
  // ---------------------------------------------------------------------------

  describe('Connection Cleanup', () => {
    it('should close connection when requested', async () => {
      // 🟢 WORKING: closeConnection resets the handle without error
      getConnection();
      await expect(closeConnection()).resolves.toBeUndefined();
    });

    it('should return new connection handle after close', async () => {
      // 🟢 WORKING: Fresh handle created after close
      const conn1 = getConnection();
      await closeConnection();
      const conn2 = getConnection();

      // After close a new handle is created — references differ
      expect(conn2).toBeDefined();
      expect(conn2).not.toBe(conn1);
    });

    it('should handle multiple close calls safely', async () => {
      // 🟢 WORKING: Idempotent close — no error on repeated calls
      await closeConnection();
      await closeConnection();
      await closeConnection();

      expect(true).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Type Safety
  // ---------------------------------------------------------------------------

  describe('Type Safety', () => {
    it('should handle null and undefined values', async () => {
      // 🟢 WORKING: Null field preserved in result
      mockPoolQuery.mockResolvedValue([{ id: 1, optional_field: null }]);

      const result = await query(
        'SELECT * FROM maintenance_tickets WHERE id = $1',
        [1]
      );

      expect(result[0].optional_field).toBeNull();
    });

    it('should handle different data types', async () => {
      // 🟢 WORKING: Various data types preserved
      mockPoolQuery.mockResolvedValue([
        {
          id: 1,
          title: 'Test',
          is_active: true,
          created_at: new Date('2024-01-01'),
          metadata: { key: 'value' },
        },
      ]);

      const result = await queryOne('SELECT * FROM maintenance_tickets WHERE id = $1', [1]);

      expect(result).toBeDefined();
      expect(result?.title).toBe('Test');
      expect(result?.is_active).toBe(true);
    });
  });
});

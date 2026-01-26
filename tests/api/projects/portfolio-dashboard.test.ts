/**
 * Tests for Portfolio Dashboard API (PRD-058)
 * TDD: Write tests first, then implement
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

// Mock dependencies before importing handler
vi.mock('@/lib/logger', () => ({
  log: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('@neondatabase/serverless', () => ({
  neon: vi.fn(() => vi.fn().mockResolvedValue([])),
}));

vi.mock('@/lib/db', () => ({
  sql: vi.fn().mockResolvedValue([]),
  safeQuery: vi.fn().mockResolvedValue(null),
  safeArrayQuery: vi.fn().mockResolvedValue([]),
}));

// Import after mocks
import handler from '@/pages/api/projects/portfolio-dashboard';
import { apiResponse } from '@/lib/apiResponse';

// Mock apiResponse
vi.mock('@/lib/apiResponse', () => ({
  apiResponse: {
    success: vi.fn(),
    methodNotAllowed: vi.fn(),
    internalError: vi.fn(),
  },
}));

describe('Portfolio Dashboard API - GET /api/projects/portfolio-dashboard', () => {
  let req: Partial<NextApiRequest>;
  let res: Partial<NextApiResponse>;

  beforeEach(() => {
    vi.clearAllMocks();

    req = {
      method: 'GET',
      query: {},
    };

    res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      setHeader: vi.fn().mockReturnThis(),
    };
  });

  describe('PD-001: Success Response Structure', () => {
    it('should return portfolio metrics with correct structure', async () => {
      const { safeArrayQuery, safeQuery } = await import('@/lib/db');

      // Mock counts query
      (safeQuery as any).mockResolvedValueOnce({
        total_projects: 24,
        pipeline_count: 4,
        planned_count: 3,
        active_count: 12,
        completed_count: 5,
        on_hold_count: 0,
      });

      // Mock budget query
      (safeQuery as any).mockResolvedValueOnce({
        total_budget: 6200000,
        total_committed: 4100000,
        total_actual: 4200000,
      });

      // Mock network progress query
      (safeQuery as any).mockResolvedValueOnce({
        total_drops: 4700,
        completed_drops: 2450,
      });

      // Mock compliance query
      (safeQuery as any).mockResolvedValueOnce({
        avg_hs_score: 92,
        open_incidents: 0,
        pending_audits: 2,
      });

      // Mock maintenance query
      (safeQuery as any).mockResolvedValueOnce({
        open_tickets: 18,
        critical_tickets: 4,
      });

      // Mock expiring docs query
      (safeQuery as any).mockResolvedValueOnce({
        count_30_days: 2,
        count_60_days: 3,
        count_90_days: 5,
      });

      // Mock recent projects query
      (safeArrayQuery as any).mockResolvedValueOnce([
        {
          id: 'proj-1',
          project_name: 'Lawley Phase 2',
          client_name: 'VumaCo',
          status: 'active',
          progress: 67,
          manager_name: 'John Doe',
        },
      ]);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(apiResponse.success).toHaveBeenCalled();

      // Verify the structure of the response
      const callArgs = (apiResponse.success as any).mock.calls[0];
      const responseData = callArgs[1];

      expect(responseData).toHaveProperty('counts');
      expect(responseData).toHaveProperty('budget');
      expect(responseData).toHaveProperty('network');
      expect(responseData).toHaveProperty('compliance');
      expect(responseData).toHaveProperty('maintenance');
      expect(responseData).toHaveProperty('expiringDocs');
      expect(responseData).toHaveProperty('recentProjects');
    });
  });

  describe('PD-002: Project Counts', () => {
    it('should return correct project status counts', async () => {
      const { safeQuery, safeArrayQuery } = await import('@/lib/db');

      (safeQuery as any)
        .mockResolvedValueOnce({
          total_projects: 24,
          pipeline_count: 4,
          planned_count: 3,
          active_count: 12,
          completed_count: 5,
          on_hold_count: 0,
        })
        .mockResolvedValue({});

      (safeArrayQuery as any).mockResolvedValue([]);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(apiResponse.success).toHaveBeenCalled();
      const responseData = (apiResponse.success as any).mock.calls[0][1];

      expect(responseData.counts).toEqual({
        total: 24,
        pipeline: 4,
        planned: 3,
        active: 12,
        completed: 5,
        onHold: 0,
        atRisk: expect.any(Number),
      });
    });

    it('should handle zero counts gracefully', async () => {
      const { safeQuery, safeArrayQuery } = await import('@/lib/db');

      (safeQuery as any)
        .mockResolvedValueOnce({
          total_projects: 0,
          pipeline_count: 0,
          planned_count: 0,
          active_count: 0,
          completed_count: 0,
          on_hold_count: 0,
        })
        .mockResolvedValue({});

      (safeArrayQuery as any).mockResolvedValue([]);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(apiResponse.success).toHaveBeenCalled();
      const responseData = (apiResponse.success as any).mock.calls[0][1];

      expect(responseData.counts.total).toBe(0);
    });
  });

  describe('PD-003: Budget Metrics', () => {
    it('should calculate budget health correctly - healthy', async () => {
      const { safeQuery, safeArrayQuery } = await import('@/lib/db');

      (safeQuery as any)
        .mockResolvedValueOnce({ total_projects: 10 })
        .mockResolvedValueOnce({
          total_budget: 1000000,
          total_committed: 400000,
          total_actual: 400000,
        })
        .mockResolvedValue({});

      (safeArrayQuery as any).mockResolvedValue([]);

      await handler(req as NextApiRequest, res as NextApiResponse);

      const responseData = (apiResponse.success as any).mock.calls[0][1];

      expect(responseData.budget.health).toBe('healthy');
      expect(responseData.budget.utilizationPercent).toBeLessThanOrEqual(80);
    });

    it('should calculate budget health correctly - warning (80-100%)', async () => {
      const { safeQuery, safeArrayQuery } = await import('@/lib/db');

      (safeQuery as any)
        .mockResolvedValueOnce({ total_projects: 10 })
        .mockResolvedValueOnce({
          total_budget: 1000000,
          total_committed: 850000,
          total_actual: 850000,
        })
        .mockResolvedValue({});

      (safeArrayQuery as any).mockResolvedValue([]);

      await handler(req as NextApiRequest, res as NextApiResponse);

      const responseData = (apiResponse.success as any).mock.calls[0][1];

      expect(responseData.budget.health).toBe('warning');
    });

    it('should calculate budget health correctly - critical (>100%)', async () => {
      const { safeQuery, safeArrayQuery } = await import('@/lib/db');

      (safeQuery as any)
        .mockResolvedValueOnce({ total_projects: 10 })
        .mockResolvedValueOnce({
          total_budget: 1000000,
          total_committed: 1100000,
          total_actual: 1100000,
        })
        .mockResolvedValue({});

      (safeArrayQuery as any).mockResolvedValue([]);

      await handler(req as NextApiRequest, res as NextApiResponse);

      const responseData = (apiResponse.success as any).mock.calls[0][1];

      expect(responseData.budget.health).toBe('critical');
    });

    it('should handle zero budget gracefully', async () => {
      const { safeQuery, safeArrayQuery } = await import('@/lib/db');

      (safeQuery as any)
        .mockResolvedValueOnce({ total_projects: 10 })
        .mockResolvedValueOnce({
          total_budget: 0,
          total_committed: 0,
          total_actual: 0,
        })
        .mockResolvedValue({});

      (safeArrayQuery as any).mockResolvedValue([]);

      await handler(req as NextApiRequest, res as NextApiResponse);

      const responseData = (apiResponse.success as any).mock.calls[0][1];

      expect(responseData.budget.totalBudget).toBe(0);
      expect(responseData.budget.health).toBe('healthy');
    });
  });

  describe('PD-004: Network Progress', () => {
    it('should calculate network progress percentage', async () => {
      const { safeQuery, safeArrayQuery } = await import('@/lib/db');

      (safeQuery as any)
        .mockResolvedValueOnce({ total_projects: 10 })
        .mockResolvedValueOnce({ total_budget: 1000000 })
        .mockResolvedValueOnce({
          total_drops: 4700,
          completed_drops: 2450,
        })
        .mockResolvedValue({});

      (safeArrayQuery as any).mockResolvedValue([]);

      await handler(req as NextApiRequest, res as NextApiResponse);

      const responseData = (apiResponse.success as any).mock.calls[0][1];

      expect(responseData.network.totalDrops).toBe(4700);
      expect(responseData.network.completedDrops).toBe(2450);
      expect(responseData.network.progressPercent).toBeCloseTo(52.13, 1);
    });

    it('should handle zero drops gracefully', async () => {
      const { safeQuery, safeArrayQuery } = await import('@/lib/db');

      (safeQuery as any)
        .mockResolvedValueOnce({ total_projects: 0 })
        .mockResolvedValueOnce({ total_budget: 0 })
        .mockResolvedValueOnce({
          total_drops: 0,
          completed_drops: 0,
        })
        .mockResolvedValue({});

      (safeArrayQuery as any).mockResolvedValue([]);

      await handler(req as NextApiRequest, res as NextApiResponse);

      const responseData = (apiResponse.success as any).mock.calls[0][1];

      expect(responseData.network.progressPercent).toBe(0);
    });
  });

  describe('PD-005: Expiring Documents', () => {
    it('should return expiring document counts by timeframe', async () => {
      const { safeQuery, safeArrayQuery } = await import('@/lib/db');

      (safeQuery as any)
        .mockResolvedValueOnce({ total_projects: 10 })
        .mockResolvedValueOnce({ total_budget: 1000000 })
        .mockResolvedValueOnce({ total_drops: 100, completed_drops: 50 })
        .mockResolvedValueOnce({ avg_hs_score: 90 })
        .mockResolvedValueOnce({ open_tickets: 5 })
        .mockResolvedValueOnce({
          count_30_days: 2,
          count_60_days: 5,
          count_90_days: 8,
        });

      (safeArrayQuery as any).mockResolvedValue([]);

      await handler(req as NextApiRequest, res as NextApiResponse);

      const responseData = (apiResponse.success as any).mock.calls[0][1];

      expect(responseData.expiringDocs).toEqual({
        count30Days: 2,
        count60Days: 5,
        count90Days: 8,
      });
    });
  });

  describe('PD-006: Recent Projects', () => {
    it('should return limited list of recent projects', async () => {
      const { safeQuery, safeArrayQuery } = await import('@/lib/db');

      (safeQuery as any).mockResolvedValue({});

      const mockProjects = [
        {
          id: 'proj-1',
          project_name: 'Lawley Phase 2',
          client_name: 'VumaCo',
          status: 'active',
          progress: 67,
          manager_name: 'John Doe',
        },
        {
          id: 'proj-2',
          project_name: 'Midrand North',
          client_name: 'OpenServe',
          status: 'planning',
          progress: 15,
          manager_name: 'Sarah M',
        },
      ];

      (safeArrayQuery as any).mockResolvedValueOnce(mockProjects);

      await handler(req as NextApiRequest, res as NextApiResponse);

      const responseData = (apiResponse.success as any).mock.calls[0][1];

      expect(responseData.recentProjects).toHaveLength(2);
      expect(responseData.recentProjects[0]).toHaveProperty('id');
      expect(responseData.recentProjects[0]).toHaveProperty('project_name');
      expect(responseData.recentProjects[0]).toHaveProperty('status');
    });

    it('should return max 10 recent projects', async () => {
      const { safeQuery, safeArrayQuery } = await import('@/lib/db');

      (safeQuery as any).mockResolvedValue({});

      // Create 15 mock projects
      const mockProjects = Array.from({ length: 15 }, (_, i) => ({
        id: `proj-${i}`,
        project_name: `Project ${i}`,
        client_name: 'Client',
        status: 'active',
        progress: 50,
        manager_name: 'Manager',
      }));

      (safeArrayQuery as any).mockResolvedValueOnce(mockProjects.slice(0, 10));

      await handler(req as NextApiRequest, res as NextApiResponse);

      const responseData = (apiResponse.success as any).mock.calls[0][1];

      expect(responseData.recentProjects.length).toBeLessThanOrEqual(10);
    });
  });

  describe('PD-007: Error Handling', () => {
    it('should handle database errors gracefully', async () => {
      const { safeQuery } = await import('@/lib/db');

      (safeQuery as any).mockRejectedValueOnce(new Error('Database connection failed'));

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(apiResponse.internalError).toHaveBeenCalledWith(
        res,
        expect.any(Error)
      );
    });
  });

  describe('PD-008: HTTP Methods', () => {
    it('should only allow GET method', async () => {
      req.method = 'POST';

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(apiResponse.methodNotAllowed).toHaveBeenCalledWith(
        res,
        ['GET']
      );
    });

    it('should reject PUT method', async () => {
      req.method = 'PUT';

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(apiResponse.methodNotAllowed).toHaveBeenCalledWith(
        res,
        ['GET']
      );
    });

    it('should reject DELETE method', async () => {
      req.method = 'DELETE';

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(apiResponse.methodNotAllowed).toHaveBeenCalledWith(
        res,
        ['GET']
      );
    });
  });
});

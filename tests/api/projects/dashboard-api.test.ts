/**
 * Project Dashboard API Integration Tests
 * Sprint 1: Project Hub Foundation
 *
 * TDD Phase: RED - Tests written before implementation
 * These tests will FAIL until API endpoints are implemented
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMocks } from 'node-mocks-http';
import type { NextApiRequest, NextApiResponse } from 'next';

// Mock auth
vi.mock('@/lib/auth', () => ({
  withAuth: (handler: Function) => handler,
  getAuth: () => ({ userId: 'test-user', role: 'admin' }),
}));

vi.mock('@/lib/auth-mock', () => ({
  getAuth: () => ({ userId: 'test-user', role: 'admin' }),
}));

// Import handlers (will fail until implemented)
import dashboardHandler from '@/pages/api/projects/[projectId]/dashboard';
import teamHandler from '@/pages/api/projects/[projectId]/team';
import timelineHandler from '@/pages/api/projects/[projectId]/timeline';
import procurementSummaryHandler from '@/pages/api/projects/[projectId]/procurement-summary';
import maintenanceSummaryHandler from '@/pages/api/projects/[projectId]/maintenance-summary';
import hsSummaryHandler from '@/pages/api/projects/[projectId]/hs-summary';

describe('Project Dashboard API', () => {
  describe('GET /api/projects/[projectId]/dashboard', () => {
    it('API-001: should return aggregated metrics from all modules', async () => {
      const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
        method: 'GET',
        query: { projectId: 'test-project-001' },
      });

      await dashboardHandler(req, res);

      expect(res._getStatusCode()).toBe(200);
      const data = JSON.parse(res._getData());
      expect(data.success).toBe(true);
      expect(data.data).toHaveProperty('budget');
      expect(data.data).toHaveProperty('team');
      expect(data.data).toHaveProperty('hs');
      expect(data.data).toHaveProperty('maintenance');
      expect(data.data).toHaveProperty('procurement');
    });

    it('API-002: should return 404 for non-existent project', async () => {
      const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
        method: 'GET',
        query: { projectId: 'non-existent-id' },
      });

      await dashboardHandler(req, res);

      expect(res._getStatusCode()).toBe(404);
    });

    it('API-003: should return 401 without authentication', async () => {
      vi.mocked(require('@/lib/auth-mock').getAuth).mockReturnValueOnce({ userId: null });

      const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
        method: 'GET',
        query: { projectId: 'test-project-001' },
      });

      await dashboardHandler(req, res);

      expect(res._getStatusCode()).toBe(401);
    });

    it('API-004: should only allow GET method', async () => {
      const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
        method: 'POST',
        query: { projectId: 'test-project-001' },
      });

      await dashboardHandler(req, res);

      expect(res._getStatusCode()).toBe(405);
    });
  });

  describe('GET /api/projects/[projectId]/team', () => {
    it('API-010: should return unified staff and contractor list', async () => {
      const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
        method: 'GET',
        query: { projectId: 'test-project-001' },
      });

      await teamHandler(req, res);

      expect(res._getStatusCode()).toBe(200);
      const data = JSON.parse(res._getData());
      expect(Array.isArray(data.data)).toBe(true);
      expect(data.data.some((m: any) => m.person_type === 'staff')).toBe(true);
      expect(data.data.some((m: any) => m.person_type === 'contractor')).toBe(true);
    });

    it('API-011: should identify primary manager', async () => {
      const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
        method: 'GET',
        query: { projectId: 'test-project-001' },
      });

      await teamHandler(req, res);

      const data = JSON.parse(res._getData());
      const primary = data.data.find((m: any) => m.is_primary === true);
      expect(primary).toBeDefined();
    });

    it('API-012: should only return active members by default', async () => {
      const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
        method: 'GET',
        query: { projectId: 'test-project-001' },
      });

      await teamHandler(req, res);

      const data = JSON.parse(res._getData());
      expect(data.data.every((m: any) => m.is_active === true)).toBe(true);
    });

    it('API-013: should include inactive when requested', async () => {
      const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
        method: 'GET',
        query: { projectId: 'test-project-001', includeInactive: 'true' },
      });

      await teamHandler(req, res);

      const data = JSON.parse(res._getData());
      expect(data.data.some((m: any) => m.is_active === false)).toBe(true);
    });
  });

  describe('GET /api/projects/[projectId]/timeline', () => {
    it('API-020: should return cross-module activity feed', async () => {
      const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
        method: 'GET',
        query: { projectId: 'test-project-001' },
      });

      await timelineHandler(req, res);

      expect(res._getStatusCode()).toBe(200);
      const data = JSON.parse(res._getData());
      expect(Array.isArray(data.data)).toBe(true);
      expect(data.data[0]).toHaveProperty('module');
      expect(data.data[0]).toHaveProperty('description');
      expect(data.data[0]).toHaveProperty('timestamp');
    });

    it('API-021: should respect limit parameter', async () => {
      const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
        method: 'GET',
        query: { projectId: 'test-project-001', limit: '5' },
      });

      await timelineHandler(req, res);

      const data = JSON.parse(res._getData());
      expect(data.data.length).toBeLessThanOrEqual(5);
    });

    it('API-022: should default to 20 items', async () => {
      const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
        method: 'GET',
        query: { projectId: 'test-project-001' },
      });

      await timelineHandler(req, res);

      const data = JSON.parse(res._getData());
      expect(data.data.length).toBeLessThanOrEqual(20);
    });
  });

  describe('GET /api/projects/[projectId]/procurement-summary', () => {
    it('API-030: should return BOQ, RFQ, PO, GRN counts', async () => {
      const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
        method: 'GET',
        query: { projectId: 'test-project-001' },
      });

      await procurementSummaryHandler(req, res);

      expect(res._getStatusCode()).toBe(200);
      const data = JSON.parse(res._getData());
      expect(data.data).toHaveProperty('boqs');
      expect(data.data).toHaveProperty('rfqs');
      expect(data.data).toHaveProperty('pos');
      expect(data.data).toHaveProperty('grns');
    });

    it('API-031: should include total values', async () => {
      const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
        method: 'GET',
        query: { projectId: 'test-project-001' },
      });

      await procurementSummaryHandler(req, res);

      const data = JSON.parse(res._getData());
      expect(data.data).toHaveProperty('totalPoValue');
      expect(data.data).toHaveProperty('totalGrnValue');
    });

    it('API-032: should show pending items', async () => {
      const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
        method: 'GET',
        query: { projectId: 'test-project-001' },
      });

      await procurementSummaryHandler(req, res);

      const data = JSON.parse(res._getData());
      expect(data.data).toHaveProperty('pendingPOs');
      expect(data.data).toHaveProperty('pendingRFQs');
    });
  });

  describe('GET /api/projects/[projectId]/maintenance-summary', () => {
    it('API-040: should return ticket counts by status', async () => {
      const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
        method: 'GET',
        query: { projectId: 'test-project-001' },
      });

      await maintenanceSummaryHandler(req, res);

      expect(res._getStatusCode()).toBe(200);
      const data = JSON.parse(res._getData());
      expect(data.data).toHaveProperty('open');
      expect(data.data).toHaveProperty('inProgress');
      expect(data.data).toHaveProperty('resolved');
      expect(data.data).toHaveProperty('closed');
    });

    it('API-041: should include resolution metrics', async () => {
      const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
        method: 'GET',
        query: { projectId: 'test-project-001' },
      });

      await maintenanceSummaryHandler(req, res);

      const data = JSON.parse(res._getData());
      expect(data.data).toHaveProperty('avgResolutionHours');
    });
  });

  describe('GET /api/projects/[projectId]/hs-summary', () => {
    it('API-050: should return latest audit score', async () => {
      const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
        method: 'GET',
        query: { projectId: 'test-project-001' },
      });

      await hsSummaryHandler(req, res);

      expect(res._getStatusCode()).toBe(200);
      const data = JSON.parse(res._getData());
      expect(data.data).toHaveProperty('latestScore');
    });

    it('API-051: should return compliance status', async () => {
      const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
        method: 'GET',
        query: { projectId: 'test-project-001' },
      });

      await hsSummaryHandler(req, res);

      const data = JSON.parse(res._getData());
      expect(data.data).toHaveProperty('complianceStatus');
    });

    it('API-052: should return null score when no audits exist', async () => {
      const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
        method: 'GET',
        query: { projectId: 'project-no-audits' },
      });

      await hsSummaryHandler(req, res);

      const data = JSON.parse(res._getData());
      expect(data.data.latestScore).toBeNull();
      expect(data.data.complianceStatus).toBe('unknown');
    });
  });
});

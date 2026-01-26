/**
 * Project Dashboard Service Unit Tests
 * Sprint 1: Project Hub Foundation
 *
 * TDD Phase: RED - Tests written before implementation
 * These tests will FAIL until services are implemented
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  aggregateMetrics,
  getActivityTimeline,
  getProcurementSummary,
  getMaintenanceSummary,
  getHSSummary,
} from '@/modules/projects/services/projectNeonService/services/ProjectDashboardService';

// Mock the database
vi.mock('@neondatabase/serverless', () => ({
  neon: vi.fn(() => vi.fn()),
}));

describe('ProjectDashboardService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('aggregateMetrics', () => {
    it('PD-001: should return all module metrics for project', async () => {
      const projectId = 'test-project-001';

      const result = await aggregateMetrics(projectId);

      expect(result).toHaveProperty('budget');
      expect(result).toHaveProperty('team');
      expect(result).toHaveProperty('hs');
      expect(result).toHaveProperty('maintenance');
      expect(result).toHaveProperty('procurement');
    });

    it('PD-002: should include budget metrics', async () => {
      const projectId = 'test-project-001';

      const result = await aggregateMetrics(projectId);

      expect(result.budget).toHaveProperty('total');
      expect(result.budget).toHaveProperty('committed');
      expect(result.budget).toHaveProperty('actual');
      expect(result.budget).toHaveProperty('health');
    });

    it('PD-003: should include team counts', async () => {
      const projectId = 'test-project-001';

      const result = await aggregateMetrics(projectId);

      expect(result.team).toHaveProperty('staffCount');
      expect(result.team).toHaveProperty('contractorCount');
      expect(typeof result.team.staffCount).toBe('number');
      expect(typeof result.team.contractorCount).toBe('number');
    });

    it('PD-004: should return default values when no data exists', async () => {
      const projectId = 'project-empty';

      const result = await aggregateMetrics(projectId);

      expect(result.budget.total).toBe(0);
      expect(result.budget.committed).toBe(0);
      expect(result.budget.actual).toBe(0);
      expect(result.budget.health).toBe('unknown');
      expect(result.team.staffCount).toBe(0);
      expect(result.team.contractorCount).toBe(0);
      expect(result.hs.latestScore).toBeNull();
      expect(result.hs.complianceStatus).toBe('unknown');
      expect(result.maintenance.openTickets).toBe(0);
      expect(result.procurement.pendingPOs).toBe(0);
    });

    it('PD-005: should calculate budget health correctly - healthy', async () => {
      // Setup: budget=100000, actual=50000 (50% utilization)
      const projectId = 'project-healthy-budget';

      const result = await aggregateMetrics(projectId);

      expect(result.budget.health).toBe('healthy');
    });

    it('PD-006: should calculate budget health correctly - warning', async () => {
      // Setup: budget=100000, actual=85000 (85% utilization)
      const projectId = 'project-warning-budget';

      const result = await aggregateMetrics(projectId);

      expect(result.budget.health).toBe('warning');
    });

    it('PD-007: should calculate budget health correctly - critical', async () => {
      // Setup: budget=100000, actual=110000 (110% utilization)
      const projectId = 'project-critical-budget';

      const result = await aggregateMetrics(projectId);

      expect(result.budget.health).toBe('critical');
    });
  });

  describe('getActivityTimeline', () => {
    it('PD-010: should combine activities from all modules', async () => {
      const projectId = 'test-project-001';

      const result = await getActivityTimeline(projectId);

      expect(result.length).toBeGreaterThan(0);
      const modules = new Set(result.map(a => a.module));
      expect(modules.size).toBeGreaterThan(1); // At least 2 different modules
    });

    it('PD-011: should sort by date descending', async () => {
      const projectId = 'test-project-001';

      const result = await getActivityTimeline(projectId);

      for (let i = 1; i < result.length; i++) {
        const prev = new Date(result[i - 1].timestamp);
        const curr = new Date(result[i].timestamp);
        expect(prev.getTime()).toBeGreaterThanOrEqual(curr.getTime());
      }
    });

    it('PD-012: should limit results to specified count', async () => {
      const projectId = 'test-project-001';
      const limit = 5;

      const result = await getActivityTimeline(projectId, { limit });

      expect(result.length).toBeLessThanOrEqual(limit);
    });

    it('PD-013: should include module source for each activity', async () => {
      const projectId = 'test-project-001';

      const result = await getActivityTimeline(projectId);

      expect(result.every(a => ['procurement', 'maintenance', 'hs', 'budget'].includes(a.module))).toBe(true);
    });

    it('PD-014: should include activity description', async () => {
      const projectId = 'test-project-001';

      const result = await getActivityTimeline(projectId);

      expect(result.every(a => typeof a.description === 'string' && a.description.length > 0)).toBe(true);
    });

    it('PD-015: should return empty array for project with no activity', async () => {
      const projectId = 'project-empty';

      const result = await getActivityTimeline(projectId);

      expect(result).toEqual([]);
    });
  });

  describe('getProcurementSummary', () => {
    it('PD-020: should return BOQ, RFQ, PO, GRN counts', async () => {
      const projectId = 'test-project-001';

      const result = await getProcurementSummary(projectId);

      expect(result).toHaveProperty('boqs');
      expect(result).toHaveProperty('rfqs');
      expect(result).toHaveProperty('pos');
      expect(result).toHaveProperty('grns');
    });

    it('PD-021: should include total values', async () => {
      const projectId = 'test-project-001';

      const result = await getProcurementSummary(projectId);

      expect(result).toHaveProperty('totalPoValue');
      expect(result).toHaveProperty('totalGrnValue');
      expect(typeof result.totalPoValue).toBe('number');
    });

    it('PD-022: should show pending items', async () => {
      const projectId = 'test-project-001';

      const result = await getProcurementSummary(projectId);

      expect(result).toHaveProperty('pendingPOs');
      expect(result).toHaveProperty('pendingRFQs');
    });

    it('PD-023: should return zeros for project with no procurement', async () => {
      const projectId = 'project-empty';

      const result = await getProcurementSummary(projectId);

      expect(result.boqs).toBe(0);
      expect(result.rfqs).toBe(0);
      expect(result.pos).toBe(0);
      expect(result.grns).toBe(0);
      expect(result.totalPoValue).toBe(0);
    });
  });

  describe('getMaintenanceSummary', () => {
    it('PD-030: should return ticket counts by status', async () => {
      const projectId = 'test-project-001';

      const result = await getMaintenanceSummary(projectId);

      expect(result).toHaveProperty('open');
      expect(result).toHaveProperty('inProgress');
      expect(result).toHaveProperty('resolved');
      expect(result).toHaveProperty('closed');
    });

    it('PD-031: should include resolution metrics', async () => {
      const projectId = 'test-project-001';

      const result = await getMaintenanceSummary(projectId);

      expect(result).toHaveProperty('avgResolutionHours');
    });

    it('PD-032: should return zeros for project with no tickets', async () => {
      const projectId = 'project-empty';

      const result = await getMaintenanceSummary(projectId);

      expect(result.open).toBe(0);
      expect(result.resolved).toBe(0);
      expect(result.avgResolutionHours).toBeNull();
    });
  });

  describe('getHSSummary', () => {
    it('PD-040: should return latest audit score', async () => {
      const projectId = 'test-project-001';

      const result = await getHSSummary(projectId);

      expect(result).toHaveProperty('latestScore');
      expect(typeof result.latestScore).toBe('number');
    });

    it('PD-041: should return compliance status', async () => {
      const projectId = 'test-project-001';

      const result = await getHSSummary(projectId);

      expect(result).toHaveProperty('complianceStatus');
      expect(['compliant', 'non-compliant', 'unknown']).toContain(result.complianceStatus);
    });

    it('PD-042: should return null score when no audits exist', async () => {
      const projectId = 'project-no-audits';

      const result = await getHSSummary(projectId);

      expect(result.latestScore).toBeNull();
      expect(result.complianceStatus).toBe('unknown');
    });

    it('PD-043: should include audit date', async () => {
      const projectId = 'test-project-001';

      const result = await getHSSummary(projectId);

      expect(result).toHaveProperty('lastAuditDate');
    });
  });
});

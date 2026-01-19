/**
 * Dashboard API Endpoint Tests (TDD)
 *
 * Tests FIRST - Implementation SECOND
 *
 * Testing dashboard API endpoints:
 * - GET /api/ticketing/dashboard/summary - Dashboard summary statistics
 * - GET /api/ticketing/dashboard/sla - SLA compliance metrics
 * - GET /api/ticketing/dashboard/workload - Workload by assignee
 *
 * 🟢 WORKING: Comprehensive test suite for dashboard API endpoints
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GET as getSummary } from '@/app/api/ticketing/dashboard/summary/route';
import { GET as getSLA } from '@/app/api/ticketing/dashboard/sla/route';
import { GET as getWorkload } from '@/app/api/ticketing/dashboard/workload/route';
import { NextRequest } from 'next/server';

// Mock the dashboard service
vi.mock('../../services/dashboardService', () => ({
  getDashboardSummary: vi.fn(),
  getSLACompliance: vi.fn(),
  getWorkloadByAssignee: vi.fn()
}));

// Mock the logger
vi.mock('@/lib/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn()
  }))
}));

import {
  getDashboardSummary,
  getSLACompliance,
  getWorkloadByAssignee
} from '../../services/dashboardService';

describe('Dashboard API Endpoints - TDD', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ==================== GET /api/ticketing/dashboard/summary ====================

  describe('GET /api/ticketing/dashboard/summary', () => {
    it('should return complete dashboard summary statistics', async () => {
      // 🟢 WORKING: Test summary endpoint returns all key metrics
      // Arrange
      const mockSummary = {
        total_tickets: 150,
        by_status: {
          open: 25,
          assigned: 30,
          in_progress: 40,
          pending_qa: 20,
          closed: 35
        },
        sla_compliance: {
          total: 150,
          met: 135,
          breached: 15,
          compliance_rate: 90
        },
        overdue_tickets: 12,
        avg_resolution_hours: 48.5
      };

      vi.mocked(getDashboardSummary).mockResolvedValue(mockSummary);

      const req = new NextRequest('http://localhost:3000/api/ticketing/dashboard/summary');

      // Act
      const response = await getSummary(req);
      const data = await response.json();

      // Assert
      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data).toEqual(mockSummary);
      expect(data.data.total_tickets).toBe(150);
      expect(data.data.sla_compliance.compliance_rate).toBe(90);
      expect(data.data.overdue_tickets).toBe(12);
      expect(data.meta.timestamp).toBeDefined();

      // Verify service was called with no filters
      expect(getDashboardSummary).toHaveBeenCalledWith({});
    });

    it('should pass project filter to dashboard service', async () => {
      // Arrange
      const mockSummary = {
        total_tickets: 50,
        by_status: { open: 10, closed: 40 },
        sla_compliance: { total: 50, met: 45, breached: 5, compliance_rate: 90 },
        overdue_tickets: 3,
        avg_resolution_hours: 36.0
      };

      vi.mocked(getDashboardSummary).mockResolvedValue(mockSummary);

      const req = new NextRequest(
        'http://localhost:3000/api/ticketing/dashboard/summary?project_id=proj-123'
      );

      // Act
      await getSummary(req);

      // Assert: Service should receive project filter
      expect(getDashboardSummary).toHaveBeenCalledWith({
        project_id: 'proj-123'
      });
    });

    it('should pass date range filters to dashboard service', async () => {
      // Arrange
      const mockSummary = {
        total_tickets: 30,
        by_status: { open: 5, closed: 25 },
        sla_compliance: { total: 30, met: 28, breached: 2, compliance_rate: 93.33 },
        overdue_tickets: 1,
        avg_resolution_hours: 24.0
      };

      vi.mocked(getDashboardSummary).mockResolvedValue(mockSummary);

      const startDate = '2024-01-01T00:00:00Z';
      const endDate = '2024-01-31T23:59:59Z';
      const req = new NextRequest(
        `http://localhost:3000/api/ticketing/dashboard/summary?start_date=${startDate}&end_date=${endDate}`
      );

      // Act
      await getSummary(req);

      // Assert: Service should receive date filters
      expect(getDashboardSummary).toHaveBeenCalledWith({
        start_date: new Date(startDate),
        end_date: new Date(endDate)
      });
    });

    it('should handle service errors gracefully', async () => {
      // Arrange: Service throws error
      vi.mocked(getDashboardSummary).mockRejectedValue(new Error('Database connection failed'));

      const req = new NextRequest('http://localhost:3000/api/ticketing/dashboard/summary');

      // Act
      const response = await getSummary(req);
      const data = await response.json();

      // Assert: Should return 500 error
      expect(response.status).toBe(500);
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('DATABASE_ERROR');
      expect(data.error.message).toBe('Failed to fetch dashboard summary');
      expect(data.meta.timestamp).toBeDefined();
    });

    it('should handle empty dashboard gracefully', async () => {
      // Arrange: No tickets in system
      const mockSummary = {
        total_tickets: 0,
        by_status: {},
        sla_compliance: { total: 0, met: 0, breached: 0, compliance_rate: 0 },
        overdue_tickets: 0,
        avg_resolution_hours: null
      };

      vi.mocked(getDashboardSummary).mockResolvedValue(mockSummary);

      const req = new NextRequest('http://localhost:3000/api/ticketing/dashboard/summary');

      // Act
      const response = await getSummary(req);
      const data = await response.json();

      // Assert: Should return zeros without errors
      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.total_tickets).toBe(0);
      expect(data.data.avg_resolution_hours).toBeNull();
    });
  });

  // ==================== GET /api/ticketing/dashboard/sla ====================

  describe('GET /api/ticketing/dashboard/sla', () => {
    it('should return SLA compliance statistics', async () => {
      // 🟢 WORKING: Test SLA endpoint returns compliance metrics
      // Arrange
      const mockSLA = {
        total_tickets: 100,
        sla_met: 85,
        sla_breached: 15,
        compliance_rate: 85,
        compliance_percentage: '85.00%'
      };

      vi.mocked(getSLACompliance).mockResolvedValue(mockSLA);

      const req = new NextRequest('http://localhost:3000/api/ticketing/dashboard/sla');

      // Act
      const response = await getSLA(req);
      const data = await response.json();

      // Assert
      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data).toEqual(mockSLA);
      expect(data.data.total_tickets).toBe(100);
      expect(data.data.compliance_rate).toBe(85);
      expect(data.data.compliance_percentage).toBe('85.00%');
      expect(data.meta.timestamp).toBeDefined();

      // Verify service was called
      expect(getSLACompliance).toHaveBeenCalledWith({});
    });

    it('should handle 100% SLA compliance correctly', async () => {
      // Arrange: Perfect SLA compliance
      const mockSLA = {
        total_tickets: 50,
        sla_met: 50,
        sla_breached: 0,
        compliance_rate: 100,
        compliance_percentage: '100.00%'
      };

      vi.mocked(getSLACompliance).mockResolvedValue(mockSLA);

      const req = new NextRequest('http://localhost:3000/api/ticketing/dashboard/sla');

      // Act
      const response = await getSLA(req);
      const data = await response.json();

      // Assert
      expect(data.data.compliance_rate).toBe(100);
      expect(data.data.sla_breached).toBe(0);
      expect(data.data.compliance_percentage).toBe('100.00%');
    });

    it('should filter by date range when provided', async () => {
      // Arrange
      const mockSLA = {
        total_tickets: 30,
        sla_met: 27,
        sla_breached: 3,
        compliance_rate: 90,
        compliance_percentage: '90.00%'
      };

      vi.mocked(getSLACompliance).mockResolvedValue(mockSLA);

      const startDate = '2024-01-01T00:00:00Z';
      const endDate = '2024-01-31T23:59:59Z';
      const req = new NextRequest(
        `http://localhost:3000/api/ticketing/dashboard/sla?start_date=${startDate}&end_date=${endDate}`
      );

      // Act
      await getSLA(req);

      // Assert: Service should receive date filters
      expect(getSLACompliance).toHaveBeenCalledWith({
        start_date: new Date(startDate),
        end_date: new Date(endDate)
      });
    });

    it('should handle service errors gracefully', async () => {
      // Arrange: Service throws error
      vi.mocked(getSLACompliance).mockRejectedValue(new Error('Query timeout'));

      const req = new NextRequest('http://localhost:3000/api/ticketing/dashboard/sla');

      // Act
      const response = await getSLA(req);
      const data = await response.json();

      // Assert: Should return 500 error
      expect(response.status).toBe(500);
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('DATABASE_ERROR');
      expect(data.error.message).toBe('Failed to fetch SLA compliance');
    });

    it('should handle no tickets gracefully', async () => {
      // Arrange: No tickets to check SLA
      const mockSLA = {
        total_tickets: 0,
        sla_met: 0,
        sla_breached: 0,
        compliance_rate: 0,
        compliance_percentage: '0.00%'
      };

      vi.mocked(getSLACompliance).mockResolvedValue(mockSLA);

      const req = new NextRequest('http://localhost:3000/api/ticketing/dashboard/sla');

      // Act
      const response = await getSLA(req);
      const data = await response.json();

      // Assert: Should handle zero division gracefully
      expect(response.status).toBe(200);
      expect(data.data.compliance_rate).toBe(0);
    });
  });

  // ==================== GET /api/ticketing/dashboard/workload ====================

  describe('GET /api/ticketing/dashboard/workload', () => {
    it('should return workload distribution by assignee', async () => {
      // 🟢 WORKING: Test workload endpoint returns assignee data
      // Arrange
      const mockWorkload = [
        {
          assigned_to: 'user-123',
          assignee_name: 'John Doe',
          ticket_count: 15,
          overdue_count: 2
        },
        {
          assigned_to: 'user-456',
          assignee_name: 'Jane Smith',
          ticket_count: 12,
          overdue_count: 1
        },
        {
          assigned_to: null,
          assignee_name: 'Unassigned',
          ticket_count: 8,
          overdue_count: 3
        }
      ];

      vi.mocked(getWorkloadByAssignee).mockResolvedValue(mockWorkload);

      const req = new NextRequest('http://localhost:3000/api/ticketing/dashboard/workload');

      // Act
      const response = await getWorkload(req);
      const data = await response.json();

      // Assert
      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data).toEqual(mockWorkload);
      expect(data.data).toHaveLength(3);
      expect(data.data[0].ticket_count).toBe(15);
      expect(data.data[0].overdue_count).toBe(2);
      expect(data.meta.timestamp).toBeDefined();

      // Verify service was called
      expect(getWorkloadByAssignee).toHaveBeenCalledWith({});
    });

    it('should filter by active tickets only when requested', async () => {
      // Arrange
      const mockWorkload = [
        {
          assigned_to: 'user-123',
          assignee_name: 'John Doe',
          ticket_count: 10,
          overdue_count: 1
        }
      ];

      vi.mocked(getWorkloadByAssignee).mockResolvedValue(mockWorkload);

      const req = new NextRequest(
        'http://localhost:3000/api/ticketing/dashboard/workload?active_only=true'
      );

      // Act
      await getWorkload(req);

      // Assert: Service should receive active_only filter
      expect(getWorkloadByAssignee).toHaveBeenCalledWith({
        active_only: true
      });
    });

    it('should handle empty workload gracefully', async () => {
      // Arrange: No tickets assigned to anyone
      const mockWorkload: any[] = [];

      vi.mocked(getWorkloadByAssignee).mockResolvedValue(mockWorkload);

      const req = new NextRequest('http://localhost:3000/api/ticketing/dashboard/workload');

      // Act
      const response = await getWorkload(req);
      const data = await response.json();

      // Assert: Should return empty array without errors
      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data).toEqual([]);
      expect(data.data).toHaveLength(0);
    });

    it('should handle service errors gracefully', async () => {
      // Arrange: Service throws error
      vi.mocked(getWorkloadByAssignee).mockRejectedValue(new Error('Connection lost'));

      const req = new NextRequest('http://localhost:3000/api/ticketing/dashboard/workload');

      // Act
      const response = await getWorkload(req);
      const data = await response.json();

      // Assert: Should return 500 error
      expect(response.status).toBe(500);
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('DATABASE_ERROR');
      expect(data.error.message).toBe('Failed to fetch workload data');
    });

    it('should return workload sorted by ticket count', async () => {
      // Arrange: Workload data in descending order
      const mockWorkload = [
        { assigned_to: 'user-1', assignee_name: 'User 1', ticket_count: 20, overdue_count: 0 },
        { assigned_to: 'user-2', assignee_name: 'User 2', ticket_count: 15, overdue_count: 1 },
        { assigned_to: 'user-3', assignee_name: 'User 3', ticket_count: 5, overdue_count: 0 }
      ];

      vi.mocked(getWorkloadByAssignee).mockResolvedValue(mockWorkload);

      const req = new NextRequest('http://localhost:3000/api/ticketing/dashboard/workload');

      // Act
      const response = await getWorkload(req);
      const data = await response.json();

      // Assert: Should maintain sorted order
      expect(data.data[0].ticket_count).toBeGreaterThanOrEqual(data.data[1].ticket_count);
      expect(data.data[1].ticket_count).toBeGreaterThanOrEqual(data.data[2].ticket_count);
    });

    it('should include unassigned tickets in workload', async () => {
      // Arrange: Include unassigned tickets
      const mockWorkload = [
        {
          assigned_to: null,
          assignee_name: 'Unassigned',
          ticket_count: 10,
          overdue_count: 5
        }
      ];

      vi.mocked(getWorkloadByAssignee).mockResolvedValue(mockWorkload);

      const req = new NextRequest('http://localhost:3000/api/ticketing/dashboard/workload');

      // Act
      const response = await getWorkload(req);
      const data = await response.json();

      // Assert: Should include unassigned category
      expect(data.data[0].assigned_to).toBeNull();
      expect(data.data[0].assignee_name).toBe('Unassigned');
      expect(data.data[0].ticket_count).toBe(10);
    });
  });

  // ==================== Query Parameter Parsing ====================

  describe('Query Parameter Handling', () => {
    it('should parse multiple filters correctly in summary endpoint', async () => {
      // Arrange
      vi.mocked(getDashboardSummary).mockResolvedValue({
        total_tickets: 25,
        by_status: { open: 10, closed: 15 },
        sla_compliance: { total: 25, met: 20, breached: 5, compliance_rate: 80 },
        overdue_tickets: 2,
        avg_resolution_hours: 30.0
      });

      const req = new NextRequest(
        'http://localhost:3000/api/ticketing/dashboard/summary?project_id=proj-456&start_date=2024-01-01T00:00:00Z&end_date=2024-01-31T23:59:59Z'
      );

      // Act
      await getSummary(req);

      // Assert: Should parse all filters
      expect(getDashboardSummary).toHaveBeenCalledWith({
        project_id: 'proj-456',
        start_date: new Date('2024-01-01T00:00:00Z'),
        end_date: new Date('2024-01-31T23:59:59Z')
      });
    });

    it('should handle invalid date formats gracefully', async () => {
      // Arrange
      vi.mocked(getDashboardSummary).mockResolvedValue({
        total_tickets: 10,
        by_status: {},
        sla_compliance: { total: 10, met: 8, breached: 2, compliance_rate: 80 },
        overdue_tickets: 1,
        avg_resolution_hours: 25.0
      });

      const req = new NextRequest(
        'http://localhost:3000/api/ticketing/dashboard/summary?start_date=invalid&end_date=invalid'
      );

      // Act
      const response = await getSummary(req);
      const data = await response.json();

      // Assert: Should handle invalid dates (create Invalid Date objects)
      // Service should handle Invalid Date gracefully or endpoint should validate
      expect(response.status).toBe(200); // Or could be 400 if validation added
    });
  });
});

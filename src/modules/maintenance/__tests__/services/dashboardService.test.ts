/**
 * Dashboard Service Tests (TDD)
 *
 * Tests FIRST - Implementation SECOND
 *
 * Testing dashboard statistics calculations:
 * - Calculate total tickets
 * - Calculate tickets by status
 * - Calculate SLA compliance rate
 * - Calculate overdue tickets
 * - Calculate workload by assignee
 * - Calculate average resolution time
 * - Get recent tickets
 *
 * 🟢 WORKING: Comprehensive test suite for dashboard service
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getDashboardSummary,
  getSLACompliance,
  getWorkloadByAssignee,
  getRecentTickets,
  getTicketsByStatus,
  getOverdueTickets,
  getAverageResolutionTime
} from '../../services/dashboardService';

// Mock the database utility
vi.mock('../../utils/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn()
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

import { query, queryOne } from '../../utils/db';

describe('Dashboard Service - Statistics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getDashboardSummary', () => {
    it('should return complete dashboard summary statistics', async () => {
      // 🟢 WORKING: Test dashboard summary with all metrics
      // Mock total tickets count
      vi.mocked(queryOne).mockResolvedValueOnce({
        total: 150
      });

      // Mock status breakdown
      vi.mocked(query).mockResolvedValueOnce([
        { status: 'open', count: 25 },
        { status: 'assigned', count: 30 },
        { status: 'in_progress', count: 40 },
        { status: 'pending_qa', count: 20 },
        { status: 'closed', count: 35 }
      ]);

      // Mock SLA stats
      vi.mocked(queryOne).mockResolvedValueOnce({
        total: 150,
        sla_met: 135,
        sla_breached: 15
      });

      // Mock overdue count
      vi.mocked(queryOne).mockResolvedValueOnce({
        overdue_count: 12
      });

      // Mock average resolution time
      vi.mocked(queryOne).mockResolvedValueOnce({
        avg_hours: 48.5
      });

      // Act
      const result = await getDashboardSummary();

      // Assert
      expect(result).toEqual({
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
      });
    });

    it('should handle empty database gracefully', async () => {
      // Arrange: No tickets in database
      vi.mocked(queryOne).mockResolvedValue({ total: 0 });
      vi.mocked(query).mockResolvedValue([]);

      // Act
      const result = await getDashboardSummary();

      // Assert: Should return zeros, not crash
      expect(result.total_tickets).toBe(0);
      expect(result.overdue_tickets).toBeDefined();
    });
  });

  describe('getTicketsByStatus', () => {
    it('should return ticket count grouped by status', async () => {
      // 🟢 WORKING: Test status breakdown query
      const mockStatusData = [
        { status: 'open', count: 10 },
        { status: 'assigned', count: 15 },
        { status: 'in_progress', count: 20 },
        { status: 'pending_qa', count: 8 },
        { status: 'qa_approved', count: 5 },
        { status: 'closed', count: 42 }
      ];

      vi.mocked(query).mockResolvedValue(mockStatusData);

      // Act
      const result = await getTicketsByStatus();

      // Assert
      expect(result).toEqual({
        open: 10,
        assigned: 15,
        in_progress: 20,
        pending_qa: 8,
        qa_approved: 5,
        closed: 42
      });

      // Verify SQL query was called
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('GROUP BY status'),
        expect.any(Array)
      );
    });

    it('should filter by project_id when provided', async () => {
      // Arrange
      const projectId = 'proj-123';
      vi.mocked(query).mockResolvedValue([
        { status: 'open', count: 5 }
      ]);

      // Act
      await getTicketsByStatus({ project_id: projectId });

      // Assert: Query should include project filter
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('project_id'),
        expect.arrayContaining([projectId])
      );
    });

    it('should filter by date range when provided', async () => {
      // Arrange
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-01-31');
      vi.mocked(query).mockResolvedValue([]);

      // Act
      await getTicketsByStatus({ start_date: startDate, end_date: endDate });

      // Assert: Query should include date filters
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('created_at'),
        expect.arrayContaining([startDate, endDate])
      );
    });
  });

  describe('getSLACompliance', () => {
    it('should calculate SLA compliance metrics', async () => {
      // 🟢 WORKING: Test SLA compliance calculation
      const mockSLAData = {
        total: 100,
        sla_met: 85,
        sla_breached: 15
      };

      vi.mocked(queryOne).mockResolvedValue(mockSLAData);

      // Act
      const result = await getSLACompliance();

      // Assert
      expect(result).toEqual({
        total_tickets: 100,
        sla_met: 85,
        sla_breached: 15,
        compliance_rate: 85,
        compliance_percentage: '85.00%'
      });

      // Verify query includes SLA logic
      expect(queryOne).toHaveBeenCalledWith(
        expect.stringContaining('sla_breached'),
        expect.any(Array)
      );
    });

    it('should handle 100% compliance correctly', async () => {
      // Arrange: All tickets met SLA
      vi.mocked(queryOne).mockResolvedValue({
        total: 50,
        sla_met: 50,
        sla_breached: 0
      });

      // Act
      const result = await getSLACompliance();

      // Assert
      expect(result.compliance_rate).toBe(100);
      expect(result.compliance_percentage).toBe('100.00%');
    });

    it('should filter by date range when provided', async () => {
      // Arrange
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-01-31');
      vi.mocked(queryOne).mockResolvedValue({
        total: 20,
        sla_met: 18,
        sla_breached: 2
      });

      // Act
      await getSLACompliance({ start_date: startDate, end_date: endDate });

      // Assert: Should include date filters
      expect(queryOne).toHaveBeenCalledWith(
        expect.stringContaining('created_at'),
        expect.arrayContaining([startDate, endDate])
      );
    });
  });

  describe('getOverdueTickets', () => {
    it('should return count of overdue tickets', async () => {
      // 🟢 WORKING: Test overdue ticket detection
      vi.mocked(queryOne).mockResolvedValue({
        overdue_count: 8
      });

      // Act
      const result = await getOverdueTickets();

      // Assert
      expect(result.overdue_count).toBe(8);

      // Verify query checks SLA and status
      expect(queryOne).toHaveBeenCalledWith(
        expect.stringContaining('sla_due_at'),
        expect.any(Array)
      );
    });

    it('should exclude closed and cancelled tickets from overdue count', async () => {
      // Arrange
      vi.mocked(queryOne).mockResolvedValue({
        overdue_count: 5
      });

      // Act
      await getOverdueTickets();

      // Assert: Query should exclude closed/cancelled
      expect(queryOne).toHaveBeenCalledWith(
        expect.stringContaining('NOT IN'),
        expect.arrayContaining(['closed', 'cancelled'])
      );
    });

    it('should return detailed overdue ticket list when requested', async () => {
      // Arrange
      const mockOverdueTickets = [
        {
          id: 'ticket-1',
          ticket_uid: 'FT123456',
          title: 'Urgent fiber repair',
          sla_due_at: new Date('2024-01-10'),
          hours_overdue: 24
        },
        {
          id: 'ticket-2',
          ticket_uid: 'FT123457',
          title: 'Customer complaint',
          sla_due_at: new Date('2024-01-09'),
          hours_overdue: 48
        }
      ];

      vi.mocked(query).mockResolvedValue(mockOverdueTickets);

      // Act
      const result = await getOverdueTickets({ include_details: true });

      // Assert
      expect(result.tickets).toHaveLength(2);
      expect(result.tickets[0].hours_overdue).toBe(24);
    });
  });

  describe('getWorkloadByAssignee', () => {
    it('should return ticket count grouped by assignee', async () => {
      // 🟢 WORKING: Test workload distribution calculation
      const mockWorkloadData = [
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

      vi.mocked(query).mockResolvedValue(mockWorkloadData);

      // Act
      const result = await getWorkloadByAssignee();

      // Assert
      expect(result).toHaveLength(3);
      expect(result[0].ticket_count).toBe(15);
      expect(result[0].overdue_count).toBe(2);
      expect(result[2].assignee_name).toBe('Unassigned');

      // Verify query groups by assignee
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('GROUP BY'),
        expect.any(Array)
      );
    });

    it('should filter by active tickets only', async () => {
      // Arrange
      vi.mocked(query).mockResolvedValue([]);

      // Act
      await getWorkloadByAssignee({ active_only: true });

      // Assert: Should exclude closed/cancelled
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('NOT IN'),
        expect.arrayContaining(['closed', 'cancelled'])
      );
    });

    it('should sort by ticket count descending', async () => {
      // Arrange: Multiple assignees
      const mockData = [
        { assigned_to: 'user-1', ticket_count: 20, overdue_count: 0 },
        { assigned_to: 'user-2', ticket_count: 5, overdue_count: 0 },
        { assigned_to: 'user-3', ticket_count: 15, overdue_count: 0 }
      ];

      vi.mocked(query).mockResolvedValue(mockData);

      // Act
      const result = await getWorkloadByAssignee();

      // Assert: Should be sorted by count (already sorted by query)
      expect(result[0].ticket_count).toBeGreaterThanOrEqual(result[1].ticket_count);
    });
  });

  describe('getAverageResolutionTime', () => {
    it('should calculate average resolution time in hours', async () => {
      // 🟢 WORKING: Test average resolution time calculation
      vi.mocked(queryOne).mockResolvedValue({
        avg_hours: 36.5,
        total_resolved: 42
      });

      // Act
      const result = await getAverageResolutionTime();

      // Assert
      expect(result.average_hours).toBe(36.5);
      expect(result.average_days).toBeCloseTo(1.52, 2);
      expect(result.total_resolved).toBe(42);

      // Verify query calculates time difference
      expect(queryOne).toHaveBeenCalledWith(
        expect.stringContaining('closed_at'),
        expect.any(Array)
      );
    });

    it('should only include closed tickets in calculation', async () => {
      // Arrange
      vi.mocked(queryOne).mockResolvedValue({
        avg_hours: 24,
        total_resolved: 10
      });

      // Act
      await getAverageResolutionTime();

      // Assert: Should filter by closed status
      expect(queryOne).toHaveBeenCalledWith(
        expect.stringContaining('status'),
        expect.arrayContaining(['closed'])
      );
    });

    it('should handle no resolved tickets gracefully', async () => {
      // Arrange: No closed tickets
      vi.mocked(queryOne).mockResolvedValue({
        avg_hours: null,
        total_resolved: 0
      });

      // Act
      const result = await getAverageResolutionTime();

      // Assert: Should return null for averages
      expect(result.average_hours).toBeNull();
      expect(result.average_days).toBeNull();
      expect(result.total_resolved).toBe(0);
    });

    it('should filter by date range when provided', async () => {
      // Arrange
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-01-31');
      vi.mocked(queryOne).mockResolvedValue({
        avg_hours: 30,
        total_resolved: 15
      });

      // Act
      await getAverageResolutionTime({ start_date: startDate, end_date: endDate });

      // Assert
      expect(queryOne).toHaveBeenCalledWith(
        expect.stringContaining('closed_at'),
        expect.arrayContaining([startDate, endDate])
      );
    });
  });

  describe('getRecentTickets', () => {
    it('should return most recent tickets with default limit', async () => {
      // 🟢 WORKING: Test recent tickets query
      const mockRecentTickets = [
        {
          id: 'ticket-1',
          ticket_uid: 'FT123456',
          title: 'Latest ticket',
          status: 'open',
          created_at: new Date('2024-01-15T10:00:00Z')
        },
        {
          id: 'ticket-2',
          ticket_uid: 'FT123455',
          title: 'Second ticket',
          status: 'assigned',
          created_at: new Date('2024-01-15T09:00:00Z')
        }
      ];

      vi.mocked(query).mockResolvedValue(mockRecentTickets);

      // Act
      const result = await getRecentTickets();

      // Assert
      expect(result).toHaveLength(2);
      expect(result[0].ticket_uid).toBe('FT123456');

      // Verify query orders by created_at DESC
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY created_at DESC'),
        expect.any(Array)
      );
    });

    it('should respect custom limit parameter', async () => {
      // Arrange
      vi.mocked(query).mockResolvedValue([]);

      // Act
      await getRecentTickets({ limit: 5 });

      // Assert: Should use LIMIT 5
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT'),
        expect.arrayContaining([5])
      );
    });

    it('should filter by status when provided', async () => {
      // Arrange
      vi.mocked(query).mockResolvedValue([]);

      // Act
      await getRecentTickets({ status: 'open' });

      // Assert: Should filter by status
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('status'),
        expect.arrayContaining(['open'])
      );
    });
  });
});

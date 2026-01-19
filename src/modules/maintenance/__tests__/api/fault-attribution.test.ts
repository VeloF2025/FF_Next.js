/**
 * Fault Attribution API Integration Tests
 *
 * 🟢 WORKING: Tests written FIRST following TDD methodology
 *
 * Tests fault cause classification and trend analysis endpoints:
 * - PUT /api/ticketing/tickets/[id]/fault-cause - Set fault cause for ticket
 * - GET /api/ticketing/analytics/fault-trends - Get fault trends by cause/location
 *
 * Test Strategy:
 * - Mock service layer to isolate API route logic
 * - Test validation, error handling, and response formats
 * - Verify proper HTTP status codes
 * - Verify response structure matches API standards
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { Ticket } from '../../types/ticket';
import { FaultCause } from '../../types/ticket';

// Helper to create mock ticket
function createMockTicket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: '123e4567-e89b-12d3-a456-426614174000',
    ticket_uid: 'FT123456',
    source: 'manual',
    external_id: null,
    title: 'Test Ticket',
    description: 'Test description',
    ticket_type: 'maintenance',
    priority: 'normal',
    status: 'open',
    dr_number: 'DR123',
    project_id: 'proj-123',
    zone_id: 'zone-456',
    pole_number: 'P123',
    pon_number: 'PON456',
    address: '123 Test St',
    gps_coordinates: null,
    ont_serial: 'ONT123',
    ont_rx_level: -15.5,
    ont_model: 'HG8245H',
    assigned_to: null,
    assigned_contractor_id: null,
    assigned_team: null,
    guarantee_status: null,
    guarantee_expires_at: null,
    is_billable: false,
    billing_classification: null,
    qa_ready: false,
    qa_readiness_check_at: null,
    qa_readiness_failed_reasons: null,
    fault_cause: null,
    fault_cause_details: null,
    rectification_count: 0,
    sla_due_at: null,
    sla_first_response_at: null,
    sla_breached: false,
    created_at: new Date('2024-01-01T00:00:00Z'),
    created_by: null,
    updated_at: new Date('2024-01-01T00:00:00Z'),
    closed_at: null,
    closed_by: null,
    ...overrides,
  };
}

// Mock the ticket service
vi.mock('../../services/ticketService', () => ({
  getTicketById: vi.fn(),
  updateTicket: vi.fn(),
}));

// Mock database connection for trend analysis
vi.mock('../../utils/db', () => ({
  query: vi.fn(),
}));

// Mock logger
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe('Fault Attribution API Endpoints', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ==================== PUT /api/ticketing/tickets/[id]/fault-cause ====================

  describe('PUT /api/ticketing/tickets/[id]/fault-cause - Set fault cause', () => {
    it('should set fault cause for a ticket', async () => {
      const { updateTicket, getTicketById } = await import('../../services/ticketService');
      const mockTicket = createMockTicket({
        id: '123e4567-e89b-12d3-a456-426614174000',
        fault_cause: FaultCause.WORKMANSHIP,
        fault_cause_details: 'Poor fiber splicing',
      });

      vi.mocked(getTicketById).mockResolvedValue(mockTicket);
      vi.mocked(updateTicket).mockResolvedValue(mockTicket);

      const { PUT } = await import('../../../../app/api/ticketing/tickets/[id]/fault-cause/route');

      const mockRequest = new Request('http://localhost/api/ticketing/tickets/123e4567-e89b-12d3-a456-426614174000/fault-cause', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fault_cause: FaultCause.WORKMANSHIP,
          fault_cause_details: 'Poor fiber splicing',
        }),
      });

      const response = await PUT(
        mockRequest as any,
        { params: { id: '123e4567-e89b-12d3-a456-426614174000' } }
      );
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.fault_cause).toBe(FaultCause.WORKMANSHIP);
      expect(data.data.fault_cause_details).toBe('Poor fiber splicing');
      expect(updateTicket).toHaveBeenCalledWith(
        '123e4567-e89b-12d3-a456-426614174000',
        expect.objectContaining({
          fault_cause: FaultCause.WORKMANSHIP,
          fault_cause_details: 'Poor fiber splicing',
        })
      );
    });

    it('should validate fault cause enum values', async () => {
      const { PUT } = await import('../../../../app/api/ticketing/tickets/[id]/fault-cause/route');

      const mockRequest = new Request('http://localhost/api/ticketing/tickets/123e4567-e89b-12d3-a456-426614174000/fault-cause', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fault_cause: 'invalid_cause',
        }),
      });

      const response = await PUT(
        mockRequest as any,
        { params: { id: '123e4567-e89b-12d3-a456-426614174000' } }
      );
      const data = await response.json();

      expect(response.status).toBe(422);
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('VALIDATION_ERROR');
      expect(data.error.message).toContain('Invalid fault_cause');
    });

    it('should validate UUID format', async () => {
      const { PUT } = await import('../../../../app/api/ticketing/tickets/[id]/fault-cause/route');

      const mockRequest = new Request('http://localhost/api/ticketing/tickets/invalid-uuid/fault-cause', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fault_cause: FaultCause.WORKMANSHIP,
        }),
      });

      const response = await PUT(
        mockRequest as any,
        { params: { id: 'invalid-uuid' } }
      );
      const data = await response.json();

      expect(response.status).toBe(422);
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('VALIDATION_ERROR');
      expect(data.error.message).toContain('Invalid ticket ID format');
    });

    it('should return 404 when ticket not found', async () => {
      const { updateTicket } = await import('../../services/ticketService');
      vi.mocked(updateTicket).mockResolvedValue(null);

      const { PUT } = await import('../../../../app/api/ticketing/tickets/[id]/fault-cause/route');

      const mockRequest = new Request('http://localhost/api/ticketing/tickets/123e4567-e89b-12d3-a456-426614174000/fault-cause', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fault_cause: FaultCause.WORKMANSHIP,
        }),
      });

      const response = await PUT(
        mockRequest as any,
        { params: { id: '123e4567-e89b-12d3-a456-426614174000' } }
      );
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('NOT_FOUND');
    });

    it('should handle database errors', async () => {
      const { updateTicket } = await import('../../services/ticketService');
      vi.mocked(updateTicket).mockRejectedValue(new Error('Database connection failed'));

      const { PUT } = await import('../../../../app/api/ticketing/tickets/[id]/fault-cause/route');

      const mockRequest = new Request('http://localhost/api/ticketing/tickets/123e4567-e89b-12d3-a456-426614174000/fault-cause', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fault_cause: FaultCause.WORKMANSHIP,
        }),
      });

      const response = await PUT(
        mockRequest as any,
        { params: { id: '123e4567-e89b-12d3-a456-426614174000' } }
      );
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('DATABASE_ERROR');
    });

    it('should allow setting fault cause with optional details', async () => {
      const { updateTicket, getTicketById } = await import('../../services/ticketService');
      const mockTicket = createMockTicket({
        fault_cause: FaultCause.MATERIAL_FAILURE,
        fault_cause_details: null,
      });

      vi.mocked(getTicketById).mockResolvedValue(mockTicket);
      vi.mocked(updateTicket).mockResolvedValue(mockTicket);

      const { PUT } = await import('../../../../app/api/ticketing/tickets/[id]/fault-cause/route');

      const mockRequest = new Request('http://localhost/api/ticketing/tickets/123e4567-e89b-12d3-a456-426614174000/fault-cause', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fault_cause: FaultCause.MATERIAL_FAILURE,
        }),
      });

      const response = await PUT(
        mockRequest as any,
        { params: { id: '123e4567-e89b-12d3-a456-426614174000' } }
      );
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.fault_cause).toBe(FaultCause.MATERIAL_FAILURE);
    });
  });

  // ==================== GET /api/ticketing/analytics/fault-trends ====================

  describe('GET /api/ticketing/analytics/fault-trends - Get fault trends', () => {
    it('should get trends by fault cause', async () => {
      const { query } = await import('../../utils/db');
      const mockTrends = {
        rows: [
          {
            fault_cause: FaultCause.WORKMANSHIP,
            count: '15',
            percentage: '30.00',
          },
          {
            fault_cause: FaultCause.MATERIAL_FAILURE,
            count: '10',
            percentage: '20.00',
          },
          {
            fault_cause: FaultCause.CLIENT_DAMAGE,
            count: '8',
            percentage: '16.00',
          },
        ],
      };

      vi.mocked(query).mockResolvedValue(mockTrends);

      const { GET } = await import('../../../../app/api/ticketing/analytics/fault-trends/route');

      const mockRequest = new Request('http://localhost/api/ticketing/analytics/fault-trends?group_by=fault_cause');
      const response = await GET(mockRequest as any);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data).toHaveLength(3);
      expect(data.data[0]).toHaveProperty('fault_cause');
      expect(data.data[0]).toHaveProperty('count');
      expect(data.data[0]).toHaveProperty('percentage');
      expect(parseInt(data.data[0].count)).toBe(15);
    });

    it('should get trends by location (pole_number)', async () => {
      const { query } = await import('../../utils/db');
      const mockTrends = {
        rows: [
          {
            pole_number: 'P123',
            count: '5',
            percentage: '25.00',
          },
          {
            pole_number: 'P456',
            count: '3',
            percentage: '15.00',
          },
        ],
      };

      vi.mocked(query).mockResolvedValue(mockTrends);

      const { GET } = await import('../../../../app/api/ticketing/analytics/fault-trends/route');

      const mockRequest = new Request('http://localhost/api/ticketing/analytics/fault-trends?group_by=pole_number');
      const response = await GET(mockRequest as any);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data).toHaveLength(2);
      expect(data.data[0]).toHaveProperty('pole_number');
      expect(data.data[0].pole_number).toBe('P123');
    });

    it('should get trends by location (pon_number)', async () => {
      const { query } = await import('../../utils/db');
      const mockTrends = {
        rows: [
          {
            pon_number: 'PON123',
            count: '8',
            percentage: '40.00',
          },
          {
            pon_number: 'PON456',
            count: '6',
            percentage: '30.00',
          },
        ],
      };

      vi.mocked(query).mockResolvedValue(mockTrends);

      const { GET } = await import('../../../../app/api/ticketing/analytics/fault-trends/route');

      const mockRequest = new Request('http://localhost/api/ticketing/analytics/fault-trends?group_by=pon_number');
      const response = await GET(mockRequest as any);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data).toHaveLength(2);
      expect(data.data[0]).toHaveProperty('pon_number');
    });

    it('should get trends by zone', async () => {
      const { query } = await import('../../utils/db');
      const mockTrends = {
        rows: [
          {
            zone_id: 'zone-123',
            count: '12',
            percentage: '35.00',
          },
          {
            zone_id: 'zone-456',
            count: '9',
            percentage: '25.00',
          },
        ],
      };

      vi.mocked(query).mockResolvedValue(mockTrends);

      const { GET } = await import('../../../../app/api/ticketing/analytics/fault-trends/route');

      const mockRequest = new Request('http://localhost/api/ticketing/analytics/fault-trends?group_by=zone_id');
      const response = await GET(mockRequest as any);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data).toHaveLength(2);
      expect(data.data[0]).toHaveProperty('zone_id');
    });

    it('should filter trends by project_id', async () => {
      const { query } = await import('../../utils/db');
      const mockTrends = {
        rows: [
          {
            fault_cause: FaultCause.WORKMANSHIP,
            count: '8',
            percentage: '40.00',
          },
        ],
      };

      vi.mocked(query).mockResolvedValue(mockTrends);

      const { GET } = await import('../../../../app/api/ticketing/analytics/fault-trends/route');

      const mockRequest = new Request('http://localhost/api/ticketing/analytics/fault-trends?group_by=fault_cause&project_id=proj-123');
      const response = await GET(mockRequest as any);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE'),
        expect.arrayContaining(['proj-123'])
      );
    });

    it('should filter trends by date range', async () => {
      const { query } = await import('../../utils/db');
      const mockTrends = {
        rows: [
          {
            fault_cause: FaultCause.WORKMANSHIP,
            count: '5',
            percentage: '50.00',
          },
        ],
      };

      vi.mocked(query).mockResolvedValue(mockTrends);

      const { GET } = await import('../../../../app/api/ticketing/analytics/fault-trends/route');

      const mockRequest = new Request('http://localhost/api/ticketing/analytics/fault-trends?group_by=fault_cause&start_date=2024-01-01&end_date=2024-12-31');
      const response = await GET(mockRequest as any);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('created_at >='),
        expect.anything()
      );
    });

    it('should validate group_by parameter', async () => {
      const { GET } = await import('../../../../app/api/ticketing/analytics/fault-trends/route');

      const mockRequest = new Request('http://localhost/api/ticketing/analytics/fault-trends?group_by=invalid_field');
      const response = await GET(mockRequest as any);
      const data = await response.json();

      expect(response.status).toBe(422);
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('VALIDATION_ERROR');
      expect(data.error.message).toContain('Invalid group_by parameter');
    });

    it('should return empty array when no trends found', async () => {
      const { query } = await import('../../utils/db');
      vi.mocked(query).mockResolvedValue({ rows: [] });

      const { GET } = await import('../../../../app/api/ticketing/analytics/fault-trends/route');

      const mockRequest = new Request('http://localhost/api/ticketing/analytics/fault-trends?group_by=fault_cause');
      const response = await GET(mockRequest as any);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data).toEqual([]);
    });

    it('should handle database errors gracefully', async () => {
      const { query } = await import('../../utils/db');
      vi.mocked(query).mockRejectedValue(new Error('Database connection failed'));

      const { GET } = await import('../../../../app/api/ticketing/analytics/fault-trends/route');

      const mockRequest = new Request('http://localhost/api/ticketing/analytics/fault-trends?group_by=fault_cause');
      const response = await GET(mockRequest as any);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('DATABASE_ERROR');
    });

    it('should include metadata in response', async () => {
      const { query } = await import('../../utils/db');
      const mockTrends = {
        rows: [
          {
            fault_cause: FaultCause.WORKMANSHIP,
            count: '10',
            percentage: '50.00',
          },
        ],
      };

      vi.mocked(query).mockResolvedValue(mockTrends);

      const { GET } = await import('../../../../app/api/ticketing/analytics/fault-trends/route');

      const mockRequest = new Request('http://localhost/api/ticketing/analytics/fault-trends?group_by=fault_cause');
      const response = await GET(mockRequest as any);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.meta).toBeDefined();
      expect(data.meta).toHaveProperty('timestamp');
      expect(data.meta).toHaveProperty('group_by', 'fault_cause');
      expect(data.meta).toHaveProperty('total_count');
    });
  });
});

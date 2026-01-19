/**
 * Ticket CRUD API Integration Tests
 *
 * 🟢 WORKING: Tests written FIRST following TDD methodology
 *
 * Tests all ticket CRUD endpoints:
 * - GET /api/ticketing/tickets - List tickets with filters
 * - POST /api/ticketing/tickets - Create ticket
 * - GET /api/ticketing/tickets/[id] - Get ticket detail
 * - PUT /api/ticketing/tickets/[id] - Update ticket
 * - DELETE /api/ticketing/tickets/[id] - Soft delete ticket
 *
 * Test Strategy:
 * - Mock service layer to isolate API route logic
 * - Test validation, error handling, and response formats
 * - Verify proper HTTP status codes
 * - Verify response structure matches API standards
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type {
  Ticket,
  CreateTicketPayload,
  UpdateTicketPayload,
} from '../../types/ticket';

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
    dr_number: null,
    project_id: null,
    zone_id: null,
    pole_number: null,
    pon_number: null,
    address: null,
    gps_coordinates: null,
    ont_serial: null,
    ont_rx_level: null,
    ont_model: null,
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
  listTickets: vi.fn(),
  createTicket: vi.fn(),
  getTicketById: vi.fn(),
  updateTicket: vi.fn(),
  deleteTicket: vi.fn(),
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

describe('Ticket CRUD API Endpoints', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ==================== GET /api/ticketing/tickets ====================

  describe('GET /api/ticketing/tickets - List tickets', () => {
    it('should list all tickets without filters', async () => {
      const { listTickets } = await import('../../services/ticketService');
      const mockTickets: Ticket[] = [
        createMockTicket({ id: '1', ticket_uid: 'FT111111' }),
        createMockTicket({ id: '2', ticket_uid: 'FT222222' }),
      ];

      const mockResponse = {
        tickets: mockTickets,
        pagination: {
          page: 1,
          pageSize: 50,
          total: 2,
          totalPages: 1,
        },
      };

      vi.mocked(listTickets).mockResolvedValue(mockResponse);

      const { GET } = await import('../../../../app/api/ticketing/tickets/route');

      const mockRequest = new Request('http://localhost/api/ticketing/tickets');
      const response = await GET(mockRequest as any);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data).toHaveLength(2);
      expect(data.pagination).toBeDefined();
      expect(data.pagination.total).toBe(2);
      expect(listTickets).toHaveBeenCalledWith({});
    });

    it('should list tickets with status filter', async () => {
      const { listTickets } = await import('../../services/ticketService');
      const mockTickets: Ticket[] = [
        createMockTicket({ status: 'open' }),
      ];

      const mockResponse = {
        tickets: mockTickets,
        pagination: {
          page: 1,
          pageSize: 50,
          total: 1,
          totalPages: 1,
        },
      };

      vi.mocked(listTickets).mockResolvedValue(mockResponse);

      const { GET } = await import('../../../../app/api/ticketing/tickets/route');

      const mockRequest = new Request('http://localhost/api/ticketing/tickets?status=open');
      const response = await GET(mockRequest as any);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(listTickets).toHaveBeenCalledWith({
        status: 'open',
      });
    });

    it('should list tickets with type filter', async () => {
      const { listTickets } = await import('../../services/ticketService');
      const mockResponse = {
        tickets: [],
        pagination: {
          page: 1,
          pageSize: 50,
          total: 0,
          totalPages: 0,
        },
      };

      vi.mocked(listTickets).mockResolvedValue(mockResponse);

      const { GET } = await import('../../../../app/api/ticketing/tickets/route');

      const mockRequest = new Request('http://localhost/api/ticketing/tickets?ticket_type=maintenance');
      const response = await GET(mockRequest as any);

      expect(response.status).toBe(200);
      expect(listTickets).toHaveBeenCalledWith({
        ticket_type: 'maintenance',
      });
    });

    it('should list tickets with pagination', async () => {
      const { listTickets } = await import('../../services/ticketService');
      const mockResponse = {
        tickets: [],
        pagination: {
          page: 2,
          pageSize: 10,
          total: 25,
          totalPages: 3,
        },
      };

      vi.mocked(listTickets).mockResolvedValue(mockResponse);

      const { GET } = await import('../../../../app/api/ticketing/tickets/route');

      const mockRequest = new Request('http://localhost/api/ticketing/tickets?page=2&pageSize=10');
      const response = await GET(mockRequest as any);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.pagination.page).toBe(2);
      expect(data.pagination.pageSize).toBe(10);
      expect(listTickets).toHaveBeenCalledWith({
        page: 2,
        pageSize: 10,
      });
    });

    it('should list tickets with multiple filters', async () => {
      const { listTickets } = await import('../../services/ticketService');
      const mockResponse = {
        tickets: [],
        pagination: {
          page: 1,
          pageSize: 50,
          total: 0,
          totalPages: 0,
        },
      };

      vi.mocked(listTickets).mockResolvedValue(mockResponse);

      const { GET } = await import('../../../../app/api/ticketing/tickets/route');

      const mockRequest = new Request('http://localhost/api/ticketing/tickets?status=open&priority=high&assigned_to=user123');
      const response = await GET(mockRequest as any);

      expect(response.status).toBe(200);
      expect(listTickets).toHaveBeenCalledWith({
        status: 'open',
        priority: 'high',
        assigned_to: 'user123',
      });
    });

    it('should handle database errors gracefully', async () => {
      const { listTickets } = await import('../../services/ticketService');
      vi.mocked(listTickets).mockRejectedValue(
        new Error('Database connection failed')
      );

      const { GET } = await import('../../../../app/api/ticketing/tickets/route');

      const mockRequest = new Request('http://localhost/api/ticketing/tickets');
      const response = await GET(mockRequest as any);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
      expect(data.error.code).toBe('DATABASE_ERROR');
    });
  });

  // ==================== POST /api/ticketing/tickets ====================

  describe('POST /api/ticketing/tickets - Create ticket', () => {
    it('should create ticket with valid data', async () => {
      const { createTicket } = await import('../../services/ticketService');
      const createPayload: CreateTicketPayload = {
        source: 'manual',
        title: 'New Ticket',
        description: 'Test description',
        ticket_type: 'maintenance',
        priority: 'normal',
      };

      const mockTicket = createMockTicket({
        title: 'New Ticket',
        description: 'Test description',
      });

      vi.mocked(createTicket).mockResolvedValue(mockTicket);

      const { POST } = await import('../../../../app/api/ticketing/tickets/route');

      const mockRequest = new Request('http://localhost/api/ticketing/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createPayload),
      });

      const response = await POST(mockRequest as any);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.data).toBeDefined();
      expect(data.data.ticket_uid).toBeDefined();
      expect(data.message).toContain('created');
      expect(createTicket).toHaveBeenCalledWith(createPayload);
    });

    it('should create ticket with minimal required fields', async () => {
      const { createTicket } = await import('../../services/ticketService');
      const createPayload: CreateTicketPayload = {
        source: 'qcontact',
        title: 'Minimal Ticket',
        ticket_type: 'new_installation',
      };

      const mockTicket = createMockTicket({
        source: 'qcontact',
        title: 'Minimal Ticket',
        ticket_type: 'new_installation',
      });

      vi.mocked(createTicket).mockResolvedValue(mockTicket);

      const { POST } = await import('../../../../app/api/ticketing/tickets/route');

      const mockRequest = new Request('http://localhost/api/ticketing/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createPayload),
      });

      const response = await POST(mockRequest as any);

      expect(response.status).toBe(201);
      expect(createTicket).toHaveBeenCalledWith(createPayload);
    });

    it('should reject ticket without required fields', async () => {
      const { createTicket } = await import('../../services/ticketService');
      const invalidPayload = {
        description: 'No title or source',
      };

      const { POST } = await import('../../../../app/api/ticketing/tickets/route');

      const mockRequest = new Request('http://localhost/api/ticketing/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(invalidPayload),
      });

      const response = await POST(mockRequest as any);
      const data = await response.json();

      expect(response.status).toBe(422);
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
      expect(data.error.code).toBe('VALIDATION_ERROR');
      expect(createTicket).not.toHaveBeenCalled();
    });

    it('should reject ticket with invalid source enum', async () => {
      const { createTicket } = await import('../../services/ticketService');
      const invalidPayload = {
        source: 'invalid_source',
        title: 'Test',
        ticket_type: 'maintenance',
      };

      const { POST } = await import('../../../../app/api/ticketing/tickets/route');

      const mockRequest = new Request('http://localhost/api/ticketing/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(invalidPayload),
      });

      const response = await POST(mockRequest as any);
      const data = await response.json();

      expect(response.status).toBe(422);
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('VALIDATION_ERROR');
      expect(createTicket).not.toHaveBeenCalled();
    });

    it('should handle database errors during creation', async () => {
      const { createTicket } = await import('../../services/ticketService');
      const createPayload: CreateTicketPayload = {
        source: 'manual',
        title: 'Test',
        ticket_type: 'maintenance',
      };

      vi.mocked(createTicket).mockRejectedValue(
        new Error('Database error')
      );

      const { POST } = await import('../../../../app/api/ticketing/tickets/route');

      const mockRequest = new Request('http://localhost/api/ticketing/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createPayload),
      });

      const response = await POST(mockRequest as any);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('DATABASE_ERROR');
    });
  });

  // ==================== GET /api/ticketing/tickets/[id] ====================

  describe('GET /api/ticketing/tickets/[id] - Get ticket detail', () => {
    it('should get ticket by valid ID', async () => {
      const { getTicketById } = await import('../../services/ticketService');
      const ticketId = '123e4567-e89b-12d3-a456-426614174000';
      const mockTicket = createMockTicket({ id: ticketId });

      vi.mocked(getTicketById).mockResolvedValue(mockTicket);

      const { GET } = await import('../../../../app/api/ticketing/tickets/[id]/route');

      const mockRequest = new Request(`http://localhost/api/ticketing/tickets/${ticketId}`);
      const response = await GET(mockRequest as any, { params: { id: ticketId } });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data).toBeDefined();
      expect(data.data.id).toBe(ticketId);
      expect(getTicketById).toHaveBeenCalledWith(ticketId);
    });

    it('should return 404 when ticket not found', async () => {
      const { getTicketById } = await import('../../services/ticketService');
      const ticketId = '123e4567-e89b-12d3-a456-426614174999';

      vi.mocked(getTicketById).mockResolvedValue(null);

      const { GET } = await import('../../../../app/api/ticketing/tickets/[id]/route');

      const mockRequest = new Request(`http://localhost/api/ticketing/tickets/${ticketId}`);
      const response = await GET(mockRequest as any, { params: { id: ticketId } });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
      expect(data.error.code).toBe('NOT_FOUND');
      expect(data.error.message).toContain('not found');
    });

    it('should reject invalid UUID format', async () => {
      const { getTicketById } = await import('../../services/ticketService');
      const invalidId = 'not-a-uuid';

      const { GET } = await import('../../../../app/api/ticketing/tickets/[id]/route');

      const mockRequest = new Request(`http://localhost/api/ticketing/tickets/${invalidId}`);
      const response = await GET(mockRequest as any, { params: { id: invalidId } });
      const data = await response.json();

      expect(response.status).toBe(422);
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('VALIDATION_ERROR');
      expect(getTicketById).not.toHaveBeenCalled();
    });

    it('should handle database errors', async () => {
      const { getTicketById } = await import('../../services/ticketService');
      const ticketId = '123e4567-e89b-12d3-a456-426614174000';

      vi.mocked(getTicketById).mockRejectedValue(
        new Error('Database error')
      );

      const { GET } = await import('../../../../app/api/ticketing/tickets/[id]/route');

      const mockRequest = new Request(`http://localhost/api/ticketing/tickets/${ticketId}`);
      const response = await GET(mockRequest as any, { params: { id: ticketId } });
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('DATABASE_ERROR');
    });
  });

  // ==================== PUT /api/ticketing/tickets/[id] ====================

  describe('PUT /api/ticketing/tickets/[id] - Update ticket', () => {
    it('should update ticket with partial data', async () => {
      const { updateTicket } = await import('../../services/ticketService');
      const ticketId = '123e4567-e89b-12d3-a456-426614174000';
      const updatePayload: UpdateTicketPayload = {
        status: 'in_progress',
        priority: 'high',
      };

      const updatedTicket = createMockTicket({
        id: ticketId,
        status: 'in_progress',
        priority: 'high',
      });

      vi.mocked(updateTicket).mockResolvedValue(updatedTicket);

      const { PUT } = await import('../../../../app/api/ticketing/tickets/[id]/route');

      const mockRequest = new Request(`http://localhost/api/ticketing/tickets/${ticketId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatePayload),
      });

      const response = await PUT(mockRequest as any, { params: { id: ticketId } });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.status).toBe('in_progress');
      expect(data.data.priority).toBe('high');
      expect(updateTicket).toHaveBeenCalledWith(ticketId, updatePayload);
    });

    it('should update single field', async () => {
      const { updateTicket } = await import('../../services/ticketService');
      const ticketId = '123e4567-e89b-12d3-a456-426614174000';
      const updatePayload: UpdateTicketPayload = {
        assigned_to: 'user123',
      };

      const updatedTicket = createMockTicket({
        id: ticketId,
        assigned_to: 'user123',
      });

      vi.mocked(updateTicket).mockResolvedValue(updatedTicket);

      const { PUT } = await import('../../../../app/api/ticketing/tickets/[id]/route');

      const mockRequest = new Request(`http://localhost/api/ticketing/tickets/${ticketId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatePayload),
      });

      const response = await PUT(mockRequest as any, { params: { id: ticketId } });

      expect(response.status).toBe(200);
      expect(updateTicket).toHaveBeenCalledWith(ticketId, updatePayload);
    });

    it('should reject update with invalid UUID', async () => {
      const { updateTicket } = await import('../../services/ticketService');
      const invalidId = 'invalid-uuid';
      const updatePayload: UpdateTicketPayload = {
        status: 'in_progress',
      };

      const { PUT } = await import('../../../../app/api/ticketing/tickets/[id]/route');

      const mockRequest = new Request(`http://localhost/api/ticketing/tickets/${invalidId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatePayload),
      });

      const response = await PUT(mockRequest as any, { params: { id: invalidId } });
      const data = await response.json();

      expect(response.status).toBe(422);
      expect(data.error.code).toBe('VALIDATION_ERROR');
      expect(updateTicket).not.toHaveBeenCalled();
    });

    it('should reject update with empty payload', async () => {
      const { updateTicket } = await import('../../services/ticketService');
      const ticketId = '123e4567-e89b-12d3-a456-426614174000';

      const { PUT } = await import('../../../../app/api/ticketing/tickets/[id]/route');

      const mockRequest = new Request(`http://localhost/api/ticketing/tickets/${ticketId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      const response = await PUT(mockRequest as any, { params: { id: ticketId } });
      const data = await response.json();

      expect(response.status).toBe(422);
      expect(data.error.code).toBe('VALIDATION_ERROR');
      expect(data.error.message).toContain('at least one field');
      expect(updateTicket).not.toHaveBeenCalled();
    });

    it('should return 404 when ticket not found', async () => {
      const { updateTicket } = await import('../../services/ticketService');
      const ticketId = '123e4567-e89b-12d3-a456-426614174000';
      const updatePayload: UpdateTicketPayload = {
        status: 'in_progress',
      };

      vi.mocked(updateTicket).mockResolvedValue(null);

      const { PUT } = await import('../../../../app/api/ticketing/tickets/[id]/route');

      const mockRequest = new Request(`http://localhost/api/ticketing/tickets/${ticketId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatePayload),
      });

      const response = await PUT(mockRequest as any, { params: { id: ticketId } });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error.code).toBe('NOT_FOUND');
    });

    it('should handle database errors during update', async () => {
      const { updateTicket } = await import('../../services/ticketService');
      const ticketId = '123e4567-e89b-12d3-a456-426614174000';
      const updatePayload: UpdateTicketPayload = {
        status: 'in_progress',
      };

      vi.mocked(updateTicket).mockRejectedValue(
        new Error('Database error')
      );

      const { PUT } = await import('../../../../app/api/ticketing/tickets/[id]/route');

      const mockRequest = new Request(`http://localhost/api/ticketing/tickets/${ticketId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatePayload),
      });

      const response = await PUT(mockRequest as any, { params: { id: ticketId } });
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error.code).toBe('DATABASE_ERROR');
    });
  });

  // ==================== DELETE /api/ticketing/tickets/[id] ====================

  describe('DELETE /api/ticketing/tickets/[id] - Soft delete ticket', () => {
    it('should soft delete ticket by ID', async () => {
      const { deleteTicket } = await import('../../services/ticketService');
      const ticketId = '123e4567-e89b-12d3-a456-426614174000';
      const deletedTicket = createMockTicket({
        id: ticketId,
        status: 'cancelled',
      });

      vi.mocked(deleteTicket).mockResolvedValue(deletedTicket);

      const { DELETE } = await import('../../../../app/api/ticketing/tickets/[id]/route');

      const mockRequest = new Request(`http://localhost/api/ticketing/tickets/${ticketId}`, {
        method: 'DELETE',
      });

      const response = await DELETE(mockRequest as any, { params: { id: ticketId } });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.status).toBe('cancelled');
      expect(data.message).toContain('deleted');
      expect(deleteTicket).toHaveBeenCalledWith(ticketId);
    });

    it('should reject delete with invalid UUID', async () => {
      const { deleteTicket } = await import('../../services/ticketService');
      const invalidId = 'not-a-uuid';

      const { DELETE } = await import('../../../../app/api/ticketing/tickets/[id]/route');

      const mockRequest = new Request(`http://localhost/api/ticketing/tickets/${invalidId}`, {
        method: 'DELETE',
      });

      const response = await DELETE(mockRequest as any, { params: { id: invalidId } });
      const data = await response.json();

      expect(response.status).toBe(422);
      expect(data.error.code).toBe('VALIDATION_ERROR');
      expect(deleteTicket).not.toHaveBeenCalled();
    });

    it('should return 404 when ticket not found', async () => {
      const { deleteTicket } = await import('../../services/ticketService');
      const ticketId = '123e4567-e89b-12d3-a456-426614174000';

      vi.mocked(deleteTicket).mockResolvedValue(null);

      const { DELETE } = await import('../../../../app/api/ticketing/tickets/[id]/route');

      const mockRequest = new Request(`http://localhost/api/ticketing/tickets/${ticketId}`, {
        method: 'DELETE',
      });

      const response = await DELETE(mockRequest as any, { params: { id: ticketId } });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error.code).toBe('NOT_FOUND');
    });

    it('should handle database errors during deletion', async () => {
      const { deleteTicket } = await import('../../services/ticketService');
      const ticketId = '123e4567-e89b-12d3-a456-426614174000';

      vi.mocked(deleteTicket).mockRejectedValue(
        new Error('Database error')
      );

      const { DELETE } = await import('../../../../app/api/ticketing/tickets/[id]/route');

      const mockRequest = new Request(`http://localhost/api/ticketing/tickets/${ticketId}`, {
        method: 'DELETE',
      });

      const response = await DELETE(mockRequest as any, { params: { id: ticketId } });
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error.code).toBe('DATABASE_ERROR');
    });
  });
});

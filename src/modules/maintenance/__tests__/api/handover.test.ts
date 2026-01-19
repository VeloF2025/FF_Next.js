/**
 * Handover API Endpoints Integration Tests
 * ⚪ UNTESTED: Tests written FIRST following TDD methodology
 *
 * Tests the handover API endpoints:
 * - POST /api/ticketing/tickets/[id]/handover
 * - GET /api/ticketing/tickets/[id]/handover-history
 *
 * TDD methodology:
 * - Tests written FIRST (this file) ✓
 * - Implementation written SECOND (pending)
 * - Verify tests pass (pending)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import * as handoverService from '../../services/handoverService';
import type {
  HandoverSnapshot,
  HandoverType,
  OwnerType,
  HandoverGateValidation,
  TicketHandoverHistory,
} from '../../types/handover';

// Mock the handover service
vi.mock('../../services/handoverService');

// Mock logger
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  }),
}));

// Mock data
const mockTicketId = '123e4567-e89b-12d3-a456-426614174000';
const mockHandoverId = '987fcdeb-51a2-43d7-b123-456789abcdef';
const mockHandoverBy = '111e2222-e89b-12d3-a456-426614174000';
const mockFromOwnerId = '222e3333-e89b-12d3-a456-426614174000';
const mockToOwnerId = '333e4444-e89b-12d3-a456-426614174000';

const mockHandoverSnapshot: HandoverSnapshot = {
  id: mockHandoverId,
  ticket_id: mockTicketId,
  handover_type: 'build_to_qa' as HandoverType,
  snapshot_data: {
    ticket_uid: 'FT406824',
    title: 'Fiber repair at Site A',
    description: 'Fix broken fiber connection',
    status: 'qa_review',
    priority: 'high',
    ticket_type: 'maintenance',
    dr_number: 'DR-12345',
    project_id: '555e6666-e89b-12d3-a456-426614174000',
    zone_id: '666e7777-e89b-12d3-a456-426614174000',
    pole_number: 'P-123',
    pon_number: 'PON-456',
    address: '123 Main St',
    ont_serial: 'ONT-789',
    ont_rx_level: -18.5,
    ont_model: 'HG8145V5',
    assigned_to: mockFromOwnerId,
    assigned_contractor_id: '777e8888-e89b-12d3-a456-426614174000',
    assigned_team: 'Team A',
    qa_ready: true,
    qa_readiness_check_at: new Date('2024-01-15T10:00:00Z'),
    fault_cause: 'workmanship',
    fault_cause_details: 'Poor splice quality',
    verification_steps_completed: 12,
    verification_steps_total: 12,
    snapshot_timestamp: new Date('2024-01-15T14:00:00Z'),
  },
  evidence_links: [
    {
      type: 'photo',
      step_number: 1,
      url: 'https://storage.example.com/photo1.jpg',
      filename: 'installation_photo_1.jpg',
      uploaded_at: new Date('2024-01-15T12:00:00Z'),
      uploaded_by: mockFromOwnerId,
    },
  ],
  decisions: [
    {
      decision_type: 'risk_acceptance',
      decision_by: mockHandoverBy,
      decision_at: new Date('2024-01-15T13:00:00Z'),
      notes: 'Approved with minor defect noted',
      metadata: {
        risk_id: '888e9999-e89b-12d3-a456-426614174000',
        risk_type: 'minor_defect',
        status: 'active',
      },
    },
  ],
  guarantee_status: 'under_guarantee',
  from_owner_type: 'build' as OwnerType,
  from_owner_id: mockFromOwnerId,
  to_owner_type: 'qa' as OwnerType,
  to_owner_id: mockToOwnerId,
  handover_at: new Date('2024-01-15T14:00:00Z'),
  handover_by: mockHandoverBy,
  is_locked: true,
  created_at: new Date('2024-01-15T14:00:00Z'),
};

const mockGateValidationPass: HandoverGateValidation = {
  can_handover: true,
  blocking_issues: [],
  warnings: [],
  gates_passed: [
    {
      gate_name: 'AS_BUILT_CONFIRMED',
      passed: true,
      required: true,
      message: 'As-built data confirmed (DR, zone, pole, PON populated)',
    },
    {
      gate_name: 'PHOTOS_ARCHIVED',
      passed: true,
      required: true,
      message: 'Photos archived (5 photos)',
    },
    {
      gate_name: 'ONT_PON_VERIFIED',
      passed: true,
      required: true,
      message: 'ONT/PON verified (Serial: ONT-789, RX: -18.5 dBm)',
    },
    {
      gate_name: 'CONTRACTOR_ASSIGNED',
      passed: true,
      required: true,
      message: 'Contractor assigned',
    },
  ],
  gates_failed: [],
};

const mockGateValidationFail: HandoverGateValidation = {
  can_handover: false,
  blocking_issues: [
    {
      gate_name: 'PHOTOS_ARCHIVED',
      severity: 'critical',
      message: 'At least one photo must be uploaded',
      resolution_hint: 'Upload photo evidence to ticket attachments',
    },
    {
      gate_name: 'ONT_PON_VERIFIED',
      severity: 'high',
      message: 'ONT serial and RX power level must be recorded',
      resolution_hint: 'Update ticket with ONT serial number and RX power level',
    },
  ],
  warnings: ['As-built data incomplete - should be populated before QA'],
  gates_passed: [
    {
      gate_name: 'CONTRACTOR_ASSIGNED',
      passed: true,
      required: false,
      message: 'Contractor assigned',
    },
  ],
  gates_failed: [
    {
      gate_name: 'PHOTOS_ARCHIVED',
      passed: false,
      required: true,
      message: 'No photos archived',
    },
    {
      gate_name: 'ONT_PON_VERIFIED',
      passed: false,
      required: true,
      message: 'ONT serial or RX level missing',
    },
  ],
};

const mockHandoverHistory: TicketHandoverHistory = {
  ticket_id: mockTicketId,
  ticket_uid: 'FT406824',
  handovers: [
    mockHandoverSnapshot,
    {
      ...mockHandoverSnapshot,
      id: '999e0000-e89b-12d3-a456-426614174000',
      handover_type: 'qa_to_maintenance' as HandoverType,
      from_owner_type: 'qa' as OwnerType,
      to_owner_type: 'maintenance' as OwnerType,
      handover_at: new Date('2024-01-16T10:00:00Z'),
    },
  ],
  total_handovers: 2,
  current_owner_type: 'maintenance' as OwnerType,
  current_owner_id: mockToOwnerId,
};

/**
 * Helper function to import route handlers dynamically
 * This is needed because we need to load the actual route file after mocks are set up
 */
async function loadRouteHandlers(routePath: string) {
  const module = await import(routePath);
  return module;
}

// ==================== POST /api/ticketing/tickets/[id]/handover ====================

describe('POST /api/ticketing/tickets/[id]/handover', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should create handover snapshot with all required fields', async () => {
    // Arrange
    vi.mocked(handoverService.validateHandoverGate).mockResolvedValue(mockGateValidationPass);
    vi.mocked(handoverService.createHandoverSnapshot).mockResolvedValue(mockHandoverSnapshot);

    const { POST } = await loadRouteHandlers(
      '../../../../app/api/ticketing/tickets/[id]/handover/route'
    );

    const requestBody = {
      handover_type: 'build_to_qa',
      from_owner_type: 'build',
      from_owner_id: mockFromOwnerId,
      to_owner_type: 'qa',
      to_owner_id: mockToOwnerId,
      handover_by: mockHandoverBy,
    };

    const request = new NextRequest(
      `http://localhost:3000/api/ticketing/tickets/${mockTicketId}/handover`,
      {
        method: 'POST',
        body: JSON.stringify(requestBody),
      }
    );

    // Act
    const response = await POST(request, { params: { id: mockTicketId } });
    const data = await response.json();

    // Assert
    expect(response.status).toBe(201);
    expect(data.success).toBe(true);
    expect(data.data.id).toBe(mockHandoverId);
    expect(data.data.ticket_id).toBe(mockTicketId);
    expect(data.data.handover_type).toBe('build_to_qa');
    expect(data.data.is_locked).toBe(true);
    expect(data.message).toContain('created successfully');
    expect(data.meta.timestamp).toBeDefined();

    // Verify gate validation was called
    expect(handoverService.validateHandoverGate).toHaveBeenCalledWith(
      mockTicketId,
      'build_to_qa'
    );

    // Verify handover creation was called
    expect(handoverService.createHandoverSnapshot).toHaveBeenCalledWith({
      ticket_id: mockTicketId,
      handover_type: 'build_to_qa',
      from_owner_type: 'build',
      from_owner_id: mockFromOwnerId,
      to_owner_type: 'qa',
      to_owner_id: mockToOwnerId,
      handover_by: mockHandoverBy,
    });
  });

  it('should create handover with minimal required fields (no owner IDs)', async () => {
    // Arrange
    const minimalSnapshot = {
      ...mockHandoverSnapshot,
      from_owner_id: null,
      to_owner_id: null,
    };

    vi.mocked(handoverService.validateHandoverGate).mockResolvedValue(mockGateValidationPass);
    vi.mocked(handoverService.createHandoverSnapshot).mockResolvedValue(minimalSnapshot);

    const { POST } = await loadRouteHandlers(
      '../../../../app/api/ticketing/tickets/[id]/handover/route'
    );

    const requestBody = {
      handover_type: 'qa_to_maintenance',
      handover_by: mockHandoverBy,
    };

    const request = new NextRequest(
      `http://localhost:3000/api/ticketing/tickets/${mockTicketId}/handover`,
      {
        method: 'POST',
        body: JSON.stringify(requestBody),
      }
    );

    // Act
    const response = await POST(request, { params: { id: mockTicketId } });
    const data = await response.json();

    // Assert
    expect(response.status).toBe(201);
    expect(data.success).toBe(true);
    expect(data.data.ticket_id).toBe(mockTicketId);
  });

  it('should return 422 when handover gates fail validation', async () => {
    // Arrange
    vi.mocked(handoverService.validateHandoverGate).mockResolvedValue(mockGateValidationFail);

    const { POST } = await loadRouteHandlers(
      '../../../../app/api/ticketing/tickets/[id]/handover/route'
    );

    const requestBody = {
      handover_type: 'qa_to_maintenance',
      handover_by: mockHandoverBy,
    };

    const request = new NextRequest(
      `http://localhost:3000/api/ticketing/tickets/${mockTicketId}/handover`,
      {
        method: 'POST',
        body: JSON.stringify(requestBody),
      }
    );

    // Act
    const response = await POST(request, { params: { id: mockTicketId } });
    const data = await response.json();

    // Assert
    expect(response.status).toBe(422);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe('HANDOVER_GATE_FAILED');
    expect(data.error.message).toContain('Handover gates validation failed');
    expect(data.error.details).toBeDefined();
    expect(data.error.details.blocking_issues).toHaveLength(2);
    expect(data.error.details.gates_passed).toHaveLength(1);
    expect(data.error.details.gates_failed).toHaveLength(2);

    // Verify createHandoverSnapshot was NOT called
    expect(handoverService.createHandoverSnapshot).not.toHaveBeenCalled();
  });

  it('should return 422 when missing handover_type', async () => {
    // Arrange
    const { POST } = await loadRouteHandlers(
      '../../../../app/api/ticketing/tickets/[id]/handover/route'
    );

    const requestBody = {
      handover_by: mockHandoverBy,
      // Missing handover_type
    };

    const request = new NextRequest(
      `http://localhost:3000/api/ticketing/tickets/${mockTicketId}/handover`,
      {
        method: 'POST',
        body: JSON.stringify(requestBody),
      }
    );

    // Act
    const response = await POST(request, { params: { id: mockTicketId } });
    const data = await response.json();

    // Assert
    expect(response.status).toBe(422);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe('VALIDATION_ERROR');
    expect(data.error.message).toContain('handover_type is required');
  });

  it('should return 422 when missing handover_by', async () => {
    // Arrange
    const { POST } = await loadRouteHandlers(
      '../../../../app/api/ticketing/tickets/[id]/handover/route'
    );

    const requestBody = {
      handover_type: 'build_to_qa',
      // Missing handover_by
    };

    const request = new NextRequest(
      `http://localhost:3000/api/ticketing/tickets/${mockTicketId}/handover`,
      {
        method: 'POST',
        body: JSON.stringify(requestBody),
      }
    );

    // Act
    const response = await POST(request, { params: { id: mockTicketId } });
    const data = await response.json();

    // Assert
    expect(response.status).toBe(422);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe('VALIDATION_ERROR');
    expect(data.error.message).toContain('handover_by is required');
  });

  it('should return 422 for invalid ticket ID format', async () => {
    // Arrange
    const { POST } = await loadRouteHandlers(
      '../../../../app/api/ticketing/tickets/[id]/handover/route'
    );

    const requestBody = {
      handover_type: 'build_to_qa',
      handover_by: mockHandoverBy,
    };

    const request = new NextRequest(
      'http://localhost:3000/api/ticketing/tickets/invalid-id/handover',
      {
        method: 'POST',
        body: JSON.stringify(requestBody),
      }
    );

    // Act
    const response = await POST(request, { params: { id: 'invalid-id' } });
    const data = await response.json();

    // Assert
    expect(response.status).toBe(422);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe('VALIDATION_ERROR');
    expect(data.error.message).toContain('Invalid ticket ID format');
  });

  it('should return 422 for invalid handover_by UUID format', async () => {
    // Arrange
    const { POST } = await loadRouteHandlers(
      '../../../../app/api/ticketing/tickets/[id]/handover/route'
    );

    const requestBody = {
      handover_type: 'build_to_qa',
      handover_by: 'invalid-uuid',
    };

    const request = new NextRequest(
      `http://localhost:3000/api/ticketing/tickets/${mockTicketId}/handover`,
      {
        method: 'POST',
        body: JSON.stringify(requestBody),
      }
    );

    // Act
    const response = await POST(request, { params: { id: mockTicketId } });
    const data = await response.json();

    // Assert
    expect(response.status).toBe(422);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe('VALIDATION_ERROR');
    expect(data.error.message).toContain('Invalid handover_by ID format');
  });

  it('should return 422 for invalid handover_type value', async () => {
    // Arrange
    vi.mocked(handoverService.validateHandoverGate).mockRejectedValue(
      new Error('Invalid handover_type value')
    );

    const { POST } = await loadRouteHandlers(
      '../../../../app/api/ticketing/tickets/[id]/handover/route'
    );

    const requestBody = {
      handover_type: 'invalid_type',
      handover_by: mockHandoverBy,
    };

    const request = new NextRequest(
      `http://localhost:3000/api/ticketing/tickets/${mockTicketId}/handover`,
      {
        method: 'POST',
        body: JSON.stringify(requestBody),
      }
    );

    // Act
    const response = await POST(request, { params: { id: mockTicketId } });
    const data = await response.json();

    // Assert
    expect(response.status).toBe(422);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe('VALIDATION_ERROR');
  });

  it('should return 404 when ticket not found', async () => {
    // Arrange
    vi.mocked(handoverService.validateHandoverGate).mockRejectedValue(
      new Error('Ticket not found')
    );

    const { POST } = await loadRouteHandlers(
      '../../../../app/api/ticketing/tickets/[id]/handover/route'
    );

    const requestBody = {
      handover_type: 'build_to_qa',
      handover_by: mockHandoverBy,
    };

    const request = new NextRequest(
      `http://localhost:3000/api/ticketing/tickets/${mockTicketId}/handover`,
      {
        method: 'POST',
        body: JSON.stringify(requestBody),
      }
    );

    // Act
    const response = await POST(request, { params: { id: mockTicketId } });
    const data = await response.json();

    // Assert
    expect(response.status).toBe(404);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe('NOT_FOUND');
  });

  it('should return 500 for database errors', async () => {
    // Arrange
    vi.mocked(handoverService.validateHandoverGate).mockResolvedValue(mockGateValidationPass);
    vi.mocked(handoverService.createHandoverSnapshot).mockRejectedValue(
      new Error('Database connection failed')
    );

    const { POST } = await loadRouteHandlers(
      '../../../../app/api/ticketing/tickets/[id]/handover/route'
    );

    const requestBody = {
      handover_type: 'build_to_qa',
      handover_by: mockHandoverBy,
    };

    const request = new NextRequest(
      `http://localhost:3000/api/ticketing/tickets/${mockTicketId}/handover`,
      {
        method: 'POST',
        body: JSON.stringify(requestBody),
      }
    );

    // Act
    const response = await POST(request, { params: { id: mockTicketId } });
    const data = await response.json();

    // Assert
    expect(response.status).toBe(500);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe('DATABASE_ERROR');
  });

  it('should return 400 for invalid JSON in request body', async () => {
    // Arrange
    const { POST } = await loadRouteHandlers(
      '../../../../app/api/ticketing/tickets/[id]/handover/route'
    );

    const request = new NextRequest(
      `http://localhost:3000/api/ticketing/tickets/${mockTicketId}/handover`,
      {
        method: 'POST',
        body: 'invalid-json{',
      }
    );

    // Act
    const response = await POST(request, { params: { id: mockTicketId } });
    const data = await response.json();

    // Assert
    expect(response.status).toBe(422);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe('VALIDATION_ERROR');
    expect(data.error.message).toContain('Invalid JSON');
  });
});

// ==================== GET /api/ticketing/tickets/[id]/handover-history ====================

describe('GET /api/ticketing/tickets/[id]/handover-history', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should get handover history for a ticket', async () => {
    // Arrange
    vi.mocked(handoverService.getHandoverHistory).mockResolvedValue(mockHandoverHistory);

    const { GET } = await loadRouteHandlers(
      '../../../../app/api/ticketing/tickets/[id]/handover-history/route'
    );

    const request = new NextRequest(
      `http://localhost:3000/api/ticketing/tickets/${mockTicketId}/handover-history`
    );

    // Act
    const response = await GET(request, { params: { id: mockTicketId } });
    const data = await response.json();

    // Assert
    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.ticket_id).toBe(mockTicketId);
    expect(data.data.ticket_uid).toBe('FT406824');
    expect(data.data.handovers).toHaveLength(2);
    expect(data.data.total_handovers).toBe(2);
    expect(data.data.current_owner_type).toBe('maintenance');
    expect(data.data.current_owner_id).toBe(mockToOwnerId);
    expect(data.meta.timestamp).toBeDefined();
    expect(handoverService.getHandoverHistory).toHaveBeenCalledWith(mockTicketId);
  });

  it('should return empty history when no handovers exist', async () => {
    // Arrange
    const emptyHistory: TicketHandoverHistory = {
      ticket_id: mockTicketId,
      ticket_uid: 'FT406824',
      handovers: [],
      total_handovers: 0,
      current_owner_type: null,
      current_owner_id: null,
    };

    vi.mocked(handoverService.getHandoverHistory).mockResolvedValue(emptyHistory);

    const { GET } = await loadRouteHandlers(
      '../../../../app/api/ticketing/tickets/[id]/handover-history/route'
    );

    const request = new NextRequest(
      `http://localhost:3000/api/ticketing/tickets/${mockTicketId}/handover-history`
    );

    // Act
    const response = await GET(request, { params: { id: mockTicketId } });
    const data = await response.json();

    // Assert
    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.handovers).toHaveLength(0);
    expect(data.data.total_handovers).toBe(0);
    expect(data.data.current_owner_type).toBeNull();
  });

  it('should return 422 for invalid ticket ID format', async () => {
    // Arrange
    const { GET } = await loadRouteHandlers(
      '../../../../app/api/ticketing/tickets/[id]/handover-history/route'
    );

    const request = new NextRequest(
      'http://localhost:3000/api/ticketing/tickets/invalid-id/handover-history'
    );

    // Act
    const response = await GET(request, { params: { id: 'invalid-id' } });
    const data = await response.json();

    // Assert
    expect(response.status).toBe(422);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe('VALIDATION_ERROR');
    expect(data.error.message).toContain('Invalid ticket ID format');
  });

  it('should return 404 when ticket not found', async () => {
    // Arrange
    vi.mocked(handoverService.getHandoverHistory).mockRejectedValue(
      new Error('Ticket not found')
    );

    const { GET } = await loadRouteHandlers(
      '../../../../app/api/ticketing/tickets/[id]/handover-history/route'
    );

    const request = new NextRequest(
      `http://localhost:3000/api/ticketing/tickets/${mockTicketId}/handover-history`
    );

    // Act
    const response = await GET(request, { params: { id: mockTicketId } });
    const data = await response.json();

    // Assert
    expect(response.status).toBe(404);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe('NOT_FOUND');
  });

  it('should return 500 for database errors', async () => {
    // Arrange
    vi.mocked(handoverService.getHandoverHistory).mockRejectedValue(
      new Error('Database connection failed')
    );

    const { GET } = await loadRouteHandlers(
      '../../../../app/api/ticketing/tickets/[id]/handover-history/route'
    );

    const request = new NextRequest(
      `http://localhost:3000/api/ticketing/tickets/${mockTicketId}/handover-history`
    );

    // Act
    const response = await GET(request, { params: { id: mockTicketId } });
    const data = await response.json();

    // Assert
    expect(response.status).toBe(500);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe('DATABASE_ERROR');
  });
});

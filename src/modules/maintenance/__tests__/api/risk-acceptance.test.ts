/**
 * Risk Acceptance API Endpoints Integration Tests
 * ⚪ UNTESTED: Tests written FIRST following TDD methodology
 *
 * Tests the risk acceptance API endpoints:
 * - POST /api/ticketing/tickets/[id]/risk-acceptance
 * - GET /api/ticketing/tickets/[id]/risk-acceptances
 * - PUT /api/ticketing/risk-acceptances/[id]/resolve
 *
 * TDD methodology:
 * - Tests written FIRST (this file) ✓
 * - Implementation written SECOND (pending)
 * - Verify tests pass (pending)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import * as riskAcceptanceService from '../../services/riskAcceptanceService';
import type { QARiskAcceptance, RiskType, RiskAcceptanceStatus } from '../../types/riskAcceptance';

// Mock the risk acceptance service
vi.mock('../../services/riskAcceptanceService');

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
const mockRiskId = '987fcdeb-51a2-43d7-b123-456789abcdef';
const mockAcceptedBy = '111e2222-e89b-12d3-a456-426614174000';
const mockResolvedBy = '222e3333-e89b-12d3-a456-426614174000';

const mockRiskAcceptance: QARiskAcceptance = {
  id: mockRiskId,
  ticket_id: mockTicketId,
  risk_type: 'minor_defect' as RiskType,
  risk_description: 'Minor cosmetic issue on enclosure',
  conditions: 'Must be rectified within 7 days',
  risk_expiry_date: new Date('2024-02-01'),
  requires_followup: true,
  followup_date: new Date('2024-01-30'),
  status: 'active' as RiskAcceptanceStatus,
  resolved_at: null,
  resolved_by: null,
  resolution_notes: null,
  accepted_by: mockAcceptedBy,
  accepted_at: new Date('2024-01-15T10:00:00Z'),
  created_at: new Date('2024-01-15T10:00:00Z'),
};

const mockResolvedRisk: QARiskAcceptance = {
  ...mockRiskAcceptance,
  status: 'resolved' as RiskAcceptanceStatus,
  resolved_at: new Date('2024-01-20T14:30:00Z'),
  resolved_by: mockResolvedBy,
  resolution_notes: 'Issue fixed during follow-up visit',
};

const mockRisksList: QARiskAcceptance[] = [
  mockRiskAcceptance,
  {
    ...mockRiskAcceptance,
    id: '333e4444-e89b-12d3-a456-426614174000',
    risk_type: 'documentation_gap' as RiskType,
    risk_description: 'Missing pole photo',
    created_at: new Date('2024-01-14T09:00:00Z'),
  },
];

/**
 * Helper function to import route handlers dynamically
 * This is needed because we need to load the actual route file after mocks are set up
 */
async function loadRouteHandlers(routePath: string) {
  const module = await import(routePath);
  return module;
}

// ==================== POST /api/ticketing/tickets/[id]/risk-acceptance ====================

describe('POST /api/ticketing/tickets/[id]/risk-acceptance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should create risk acceptance with all fields', async () => {
    // Arrange
    vi.mocked(riskAcceptanceService.createRiskAcceptance).mockResolvedValue(mockRiskAcceptance);

    const { POST } = await loadRouteHandlers(
      '../../../../app/api/ticketing/tickets/[id]/risk-acceptance/route'
    );

    const requestBody = {
      risk_type: 'minor_defect',
      risk_description: 'Minor cosmetic issue on enclosure',
      conditions: 'Must be rectified within 7 days',
      risk_expiry_date: '2024-02-01',
      requires_followup: true,
      followup_date: '2024-01-30',
      accepted_by: mockAcceptedBy,
    };

    const request = new NextRequest(
      `http://localhost:3000/api/ticketing/tickets/${mockTicketId}/risk-acceptance`,
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
    expect(data.data.id).toBe(mockRiskId);
    expect(data.data.ticket_id).toBe(mockTicketId);
    expect(data.data.risk_type).toBe('minor_defect');
    expect(data.data.risk_description).toBe('Minor cosmetic issue on enclosure');
    expect(data.data.status).toBe('active');
    expect(data.message).toContain('created successfully');
    expect(data.meta.timestamp).toBeDefined();
    expect(riskAcceptanceService.createRiskAcceptance).toHaveBeenCalledWith({
      ticket_id: mockTicketId,
      risk_type: 'minor_defect',
      risk_description: 'Minor cosmetic issue on enclosure',
      conditions: 'Must be rectified within 7 days',
      risk_expiry_date: '2024-02-01',
      requires_followup: true,
      followup_date: '2024-01-30',
      accepted_by: mockAcceptedBy,
    });
  });

  it('should create risk acceptance with minimal required fields', async () => {
    // Arrange
    const minimalRisk = {
      ...mockRiskAcceptance,
      conditions: null,
      risk_expiry_date: null,
      followup_date: null,
    };

    vi.mocked(riskAcceptanceService.createRiskAcceptance).mockResolvedValue(minimalRisk);

    const { POST } = await loadRouteHandlers(
      '../../../../app/api/ticketing/tickets/[id]/risk-acceptance/route'
    );

    const requestBody = {
      risk_type: 'minor_defect',
      risk_description: 'Minor cosmetic issue on enclosure',
      accepted_by: mockAcceptedBy,
    };

    const request = new NextRequest(
      `http://localhost:3000/api/ticketing/tickets/${mockTicketId}/risk-acceptance`,
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

  it('should return 422 when missing required fields', async () => {
    // Arrange
    const { POST } = await loadRouteHandlers(
      '../../../../app/api/ticketing/tickets/[id]/risk-acceptance/route'
    );

    const requestBody = {
      risk_type: 'minor_defect',
      // Missing risk_description and accepted_by
    };

    const request = new NextRequest(
      `http://localhost:3000/api/ticketing/tickets/${mockTicketId}/risk-acceptance`,
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
    expect(data.error.message).toBeDefined();
  });

  it('should return 422 for invalid ticket ID format', async () => {
    // Arrange
    const { POST } = await loadRouteHandlers(
      '../../../../app/api/ticketing/tickets/[id]/risk-acceptance/route'
    );

    const requestBody = {
      risk_type: 'minor_defect',
      risk_description: 'Test issue',
      accepted_by: mockAcceptedBy,
    };

    const request = new NextRequest(
      'http://localhost:3000/api/ticketing/tickets/invalid-id/risk-acceptance',
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

  it('should return 422 for invalid risk_type', async () => {
    // Arrange
    vi.mocked(riskAcceptanceService.createRiskAcceptance).mockRejectedValue(
      new Error('Invalid risk_type value')
    );

    const { POST } = await loadRouteHandlers(
      '../../../../app/api/ticketing/tickets/[id]/risk-acceptance/route'
    );

    const requestBody = {
      risk_type: 'invalid_type',
      risk_description: 'Test issue',
      accepted_by: mockAcceptedBy,
    };

    const request = new NextRequest(
      `http://localhost:3000/api/ticketing/tickets/${mockTicketId}/risk-acceptance`,
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

  it('should return 500 for database errors', async () => {
    // Arrange
    vi.mocked(riskAcceptanceService.createRiskAcceptance).mockRejectedValue(
      new Error('Database connection failed')
    );

    const { POST } = await loadRouteHandlers(
      '../../../../app/api/ticketing/tickets/[id]/risk-acceptance/route'
    );

    const requestBody = {
      risk_type: 'minor_defect',
      risk_description: 'Test issue',
      accepted_by: mockAcceptedBy,
    };

    const request = new NextRequest(
      `http://localhost:3000/api/ticketing/tickets/${mockTicketId}/risk-acceptance`,
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
});

// ==================== GET /api/ticketing/tickets/[id]/risk-acceptances ====================

describe('GET /api/ticketing/tickets/[id]/risk-acceptances', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should list all risk acceptances for a ticket', async () => {
    // Arrange
    vi.mocked(riskAcceptanceService.listRisksForTicket).mockResolvedValue(mockRisksList);

    const { GET } = await loadRouteHandlers(
      '../../../../app/api/ticketing/tickets/[id]/risk-acceptances/route'
    );

    const request = new NextRequest(
      `http://localhost:3000/api/ticketing/tickets/${mockTicketId}/risk-acceptances`
    );

    // Act
    const response = await GET(request, { params: { id: mockTicketId } });
    const data = await response.json();

    // Assert
    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data).toHaveLength(2);
    expect(data.data[0].ticket_id).toBe(mockTicketId);
    expect(data.meta.timestamp).toBeDefined();
    expect(riskAcceptanceService.listRisksForTicket).toHaveBeenCalledWith(mockTicketId, 'active');
  });

  it('should filter risks by status', async () => {
    // Arrange
    vi.mocked(riskAcceptanceService.listRisksForTicket).mockResolvedValue([mockResolvedRisk]);

    const { GET } = await loadRouteHandlers(
      '../../../../app/api/ticketing/tickets/[id]/risk-acceptances/route'
    );

    const request = new NextRequest(
      `http://localhost:3000/api/ticketing/tickets/${mockTicketId}/risk-acceptances?status=resolved`
    );

    // Act
    const response = await GET(request, { params: { id: mockTicketId } });
    const data = await response.json();

    // Assert
    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data).toHaveLength(1);
    expect(data.data[0].status).toBe('resolved');
    expect(riskAcceptanceService.listRisksForTicket).toHaveBeenCalledWith(mockTicketId, 'resolved');
  });

  it('should return empty array when no risks exist', async () => {
    // Arrange
    vi.mocked(riskAcceptanceService.listRisksForTicket).mockResolvedValue([]);

    const { GET } = await loadRouteHandlers(
      '../../../../app/api/ticketing/tickets/[id]/risk-acceptances/route'
    );

    const request = new NextRequest(
      `http://localhost:3000/api/ticketing/tickets/${mockTicketId}/risk-acceptances`
    );

    // Act
    const response = await GET(request, { params: { id: mockTicketId } });
    const data = await response.json();

    // Assert
    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data).toHaveLength(0);
  });

  it('should return 422 for invalid ticket ID format', async () => {
    // Arrange
    const { GET } = await loadRouteHandlers(
      '../../../../app/api/ticketing/tickets/[id]/risk-acceptances/route'
    );

    const request = new NextRequest(
      'http://localhost:3000/api/ticketing/tickets/invalid-id/risk-acceptances'
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

  it('should return 500 for database errors', async () => {
    // Arrange
    vi.mocked(riskAcceptanceService.listRisksForTicket).mockRejectedValue(
      new Error('Database connection failed')
    );

    const { GET } = await loadRouteHandlers(
      '../../../../app/api/ticketing/tickets/[id]/risk-acceptances/route'
    );

    const request = new NextRequest(
      `http://localhost:3000/api/ticketing/tickets/${mockTicketId}/risk-acceptances`
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

// ==================== PUT /api/ticketing/risk-acceptances/[id]/resolve ====================

describe('PUT /api/ticketing/risk-acceptances/[id]/resolve', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should resolve a risk acceptance', async () => {
    // Arrange
    vi.mocked(riskAcceptanceService.resolveRiskAcceptance).mockResolvedValue(mockResolvedRisk);

    const { PUT } = await loadRouteHandlers(
      '../../../../app/api/ticketing/risk-acceptances/[id]/resolve/route'
    );

    const requestBody = {
      resolved_by: mockResolvedBy,
      resolution_notes: 'Issue fixed during follow-up visit',
    };

    const request = new NextRequest(
      `http://localhost:3000/api/ticketing/risk-acceptances/${mockRiskId}/resolve`,
      {
        method: 'PUT',
        body: JSON.stringify(requestBody),
      }
    );

    // Act
    const response = await PUT(request, { params: { id: mockRiskId } });
    const data = await response.json();

    // Assert
    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.id).toBe(mockRiskId);
    expect(data.data.status).toBe('resolved');
    expect(data.data.resolved_by).toBe(mockResolvedBy);
    expect(data.data.resolution_notes).toBe('Issue fixed during follow-up visit');
    expect(data.message).toContain('resolved successfully');
    expect(data.meta.timestamp).toBeDefined();
    expect(riskAcceptanceService.resolveRiskAcceptance).toHaveBeenCalledWith(mockRiskId, {
      resolved_by: mockResolvedBy,
      resolution_notes: 'Issue fixed during follow-up visit',
    });
  });

  it('should return 422 when missing resolved_by', async () => {
    // Arrange
    const { PUT } = await loadRouteHandlers(
      '../../../../app/api/ticketing/risk-acceptances/[id]/resolve/route'
    );

    const requestBody = {
      resolution_notes: 'Issue fixed during follow-up visit',
      // Missing resolved_by
    };

    const request = new NextRequest(
      `http://localhost:3000/api/ticketing/risk-acceptances/${mockRiskId}/resolve`,
      {
        method: 'PUT',
        body: JSON.stringify(requestBody),
      }
    );

    // Act
    const response = await PUT(request, { params: { id: mockRiskId } });
    const data = await response.json();

    // Assert
    expect(response.status).toBe(422);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe('VALIDATION_ERROR');
    expect(data.error.message).toBeDefined();
  });

  it('should return 422 when missing resolution_notes', async () => {
    // Arrange
    const { PUT } = await loadRouteHandlers(
      '../../../../app/api/ticketing/risk-acceptances/[id]/resolve/route'
    );

    const requestBody = {
      resolved_by: mockResolvedBy,
      // Missing resolution_notes
    };

    const request = new NextRequest(
      `http://localhost:3000/api/ticketing/risk-acceptances/${mockRiskId}/resolve`,
      {
        method: 'PUT',
        body: JSON.stringify(requestBody),
      }
    );

    // Act
    const response = await PUT(request, { params: { id: mockRiskId } });
    const data = await response.json();

    // Assert
    expect(response.status).toBe(422);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe('VALIDATION_ERROR');
  });

  it('should return 422 for invalid risk ID format', async () => {
    // Arrange
    const { PUT } = await loadRouteHandlers(
      '../../../../app/api/ticketing/risk-acceptances/[id]/resolve/route'
    );

    const requestBody = {
      resolved_by: mockResolvedBy,
      resolution_notes: 'Issue fixed',
    };

    const request = new NextRequest(
      'http://localhost:3000/api/ticketing/risk-acceptances/invalid-id/resolve',
      {
        method: 'PUT',
        body: JSON.stringify(requestBody),
      }
    );

    // Act
    const response = await PUT(request, { params: { id: 'invalid-id' } });
    const data = await response.json();

    // Assert
    expect(response.status).toBe(422);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe('VALIDATION_ERROR');
    expect(data.error.message).toContain('Invalid risk acceptance ID format');
  });

  it('should return 404 when risk acceptance not found', async () => {
    // Arrange
    vi.mocked(riskAcceptanceService.resolveRiskAcceptance).mockRejectedValue(
      new Error('Risk acceptance not found')
    );

    const { PUT } = await loadRouteHandlers(
      '../../../../app/api/ticketing/risk-acceptances/[id]/resolve/route'
    );

    const requestBody = {
      resolved_by: mockResolvedBy,
      resolution_notes: 'Issue fixed',
    };

    const request = new NextRequest(
      `http://localhost:3000/api/ticketing/risk-acceptances/${mockRiskId}/resolve`,
      {
        method: 'PUT',
        body: JSON.stringify(requestBody),
      }
    );

    // Act
    const response = await PUT(request, { params: { id: mockRiskId } });
    const data = await response.json();

    // Assert
    expect(response.status).toBe(404);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe('NOT_FOUND');
  });

  it('should return 500 for database errors', async () => {
    // Arrange
    vi.mocked(riskAcceptanceService.resolveRiskAcceptance).mockRejectedValue(
      new Error('Database connection failed')
    );

    const { PUT } = await loadRouteHandlers(
      '../../../../app/api/ticketing/risk-acceptances/[id]/resolve/route'
    );

    const requestBody = {
      resolved_by: mockResolvedBy,
      resolution_notes: 'Issue fixed',
    };

    const request = new NextRequest(
      `http://localhost:3000/api/ticketing/risk-acceptances/${mockRiskId}/resolve`,
      {
        method: 'PUT',
        body: JSON.stringify(requestBody),
      }
    );

    // Act
    const response = await PUT(request, { params: { id: mockRiskId } });
    const data = await response.json();

    // Assert
    expect(response.status).toBe(500);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe('DATABASE_ERROR');
  });
});

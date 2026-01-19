/**
 * Verification API Endpoints Integration Tests
 * ⚪ UNTESTED: Tests written FIRST following TDD methodology
 *
 * Tests the verification API endpoints:
 * - GET /api/ticketing/tickets/[id]/verification
 * - PUT /api/ticketing/tickets/[id]/verification/[step]
 * - POST /api/ticketing/tickets/[id]/verification/complete
 *
 * These tests should FAIL initially (red phase)
 * Implementation comes AFTER tests pass (green phase)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import * as verificationService from '../../services/verificationService';
import type { VerificationStep, VerificationProgress } from '../../types/verification';

// Mock the verification service
vi.mock('../../services/verificationService');

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
const mockUserId = '987fcdeb-51a2-43d7-b123-456789abcdef';
const mockStepId = '111e2222-e89b-12d3-a456-426614174000';

const mockVerificationStep: VerificationStep = {
  id: mockStepId,
  ticket_id: mockTicketId,
  step_number: 1,
  step_name: 'Verify client details',
  step_description: 'Confirm client name, contact number, and address',
  is_complete: false,
  completed_at: null,
  completed_by: null,
  photo_required: false,
  photo_url: null,
  photo_verified: false,
  notes: null,
  created_at: new Date('2024-01-15T10:00:00Z'),
};

const mockCompletedStep: VerificationStep = {
  ...mockVerificationStep,
  is_complete: true,
  completed_at: new Date('2024-01-15T11:00:00Z'),
  completed_by: mockUserId,
  notes: 'Verified all client details',
};

const mockStepWithPhoto: VerificationStep = {
  ...mockVerificationStep,
  step_number: 2,
  step_name: 'Verify DR number',
  step_description: 'Confirm DR number is correct and recorded',
  photo_required: true,
  photo_url: 'https://storage.example.com/photos/dr-photo.jpg',
  photo_verified: true,
};

const mockAllSteps: VerificationStep[] = [
  mockVerificationStep,
  mockStepWithPhoto,
  { ...mockVerificationStep, step_number: 3, step_name: 'Step 3' },
  { ...mockVerificationStep, step_number: 4, step_name: 'Step 4' },
  { ...mockVerificationStep, step_number: 5, step_name: 'Step 5' },
  { ...mockVerificationStep, step_number: 6, step_name: 'Step 6' },
  { ...mockVerificationStep, step_number: 7, step_name: 'Step 7' },
  { ...mockVerificationStep, step_number: 8, step_name: 'Step 8' },
  { ...mockVerificationStep, step_number: 9, step_name: 'Step 9' },
  { ...mockVerificationStep, step_number: 10, step_name: 'Step 10' },
  { ...mockVerificationStep, step_number: 11, step_name: 'Step 11' },
  { ...mockVerificationStep, step_number: 12, step_name: 'Step 12' },
];

const mockProgress: VerificationProgress = {
  ticket_id: mockTicketId,
  total_steps: 12,
  completed_steps: 3,
  pending_steps: 9,
  progress_percentage: 25,
  all_steps_complete: false,
  steps: mockAllSteps,
};

const mockCompleteProgress: VerificationProgress = {
  ...mockProgress,
  completed_steps: 12,
  pending_steps: 0,
  progress_percentage: 100,
  all_steps_complete: true,
};

// ==================== GET /api/ticketing/tickets/[id]/verification ====================

describe('GET /api/ticketing/tickets/[id]/verification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return all verification steps for a ticket', async () => {
    // 🟢 WORKING: Mock service to return all steps
    vi.mocked(verificationService.getVerificationSteps).mockResolvedValue(mockAllSteps);

    // Import the route handler dynamically
    const { GET } = await import('../../../../app/api/ticketing/tickets/[id]/verification/route');

    const request = new NextRequest('http://localhost:3000/api/ticketing/tickets/123/verification');
    const response = await GET(request, { params: { id: mockTicketId } });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data).toHaveLength(12);
    expect(data.data[0]).toMatchObject({
      step_number: 1,
      step_name: 'Verify client details',
    });
    expect(verificationService.getVerificationSteps).toHaveBeenCalledWith(mockTicketId);
  });

  it('should return validation error for invalid ticket ID', async () => {
    const { GET } = await import('../../../../app/api/ticketing/tickets/[id]/verification/route');

    const request = new NextRequest('http://localhost:3000/api/ticketing/tickets/invalid/verification');
    const response = await GET(request, { params: { id: 'invalid-uuid' } });
    const data = await response.json();

    expect(response.status).toBe(422);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe('VALIDATION_ERROR');
    expect(data.error.message).toContain('Invalid ticket ID');
    expect(verificationService.getVerificationSteps).not.toHaveBeenCalled();
  });

  it('should return 404 when ticket not found', async () => {
    // 🟢 WORKING: Mock service to throw not found error
    vi.mocked(verificationService.getVerificationSteps).mockRejectedValue(
      new Error('Ticket not found')
    );

    const { GET } = await import('../../../../app/api/ticketing/tickets/[id]/verification/route');

    const request = new NextRequest('http://localhost:3000/api/ticketing/tickets/123/verification');
    const response = await GET(request, { params: { id: mockTicketId } });
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe('NOT_FOUND');
  });

  it('should return empty array if no verification steps exist', async () => {
    // 🟢 WORKING: Mock service to return empty array
    vi.mocked(verificationService.getVerificationSteps).mockResolvedValue([]);

    const { GET } = await import('../../../../app/api/ticketing/tickets/[id]/verification/route');

    const request = new NextRequest('http://localhost:3000/api/ticketing/tickets/123/verification');
    const response = await GET(request, { params: { id: mockTicketId } });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data).toHaveLength(0);
  });
});

// ==================== PUT /api/ticketing/tickets/[id]/verification/[step] ====================

describe('PUT /api/ticketing/tickets/[id]/verification/[step]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should update a verification step with valid data', async () => {
    // 🟢 WORKING: Mock service to return updated step
    vi.mocked(verificationService.updateVerificationStep).mockResolvedValue(mockCompletedStep);

    const { PUT } = await import('../../../../app/api/ticketing/tickets/[id]/verification/[step]/route');

    const requestBody = {
      is_complete: true,
      completed_by: mockUserId,
      notes: 'Verified all client details',
    };

    const request = new NextRequest('http://localhost:3000/api/ticketing/tickets/123/verification/1', {
      method: 'PUT',
      body: JSON.stringify(requestBody),
    });

    const response = await PUT(request, { params: { id: mockTicketId, step: '1' } });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.is_complete).toBe(true);
    expect(data.data.notes).toBe('Verified all client details');
    expect(verificationService.updateVerificationStep).toHaveBeenCalledWith(
      mockTicketId,
      1,
      requestBody
    );
  });

  it('should update step with photo URL', async () => {
    // 🟢 WORKING: Mock service to return step with photo
    vi.mocked(verificationService.updateVerificationStep).mockResolvedValue(mockStepWithPhoto);

    const { PUT } = await import('../../../../app/api/ticketing/tickets/[id]/verification/[step]/route');

    const requestBody = {
      photo_url: 'https://storage.example.com/photos/dr-photo.jpg',
      photo_verified: true,
    };

    const request = new NextRequest('http://localhost:3000/api/ticketing/tickets/123/verification/2', {
      method: 'PUT',
      body: JSON.stringify(requestBody),
    });

    const response = await PUT(request, { params: { id: mockTicketId, step: '2' } });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.photo_url).toBe('https://storage.example.com/photos/dr-photo.jpg');
    expect(data.data.photo_verified).toBe(true);
  });

  it('should return validation error for invalid ticket ID', async () => {
    const { PUT } = await import('../../../../app/api/ticketing/tickets/[id]/verification/[step]/route');

    const request = new NextRequest('http://localhost:3000/api/ticketing/tickets/invalid/verification/1', {
      method: 'PUT',
      body: JSON.stringify({ is_complete: true }),
    });

    const response = await PUT(request, { params: { id: 'invalid-uuid', step: '1' } });
    const data = await response.json();

    expect(response.status).toBe(422);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe('VALIDATION_ERROR');
    expect(verificationService.updateVerificationStep).not.toHaveBeenCalled();
  });

  it('should return validation error for invalid step number', async () => {
    const { PUT } = await import('../../../../app/api/ticketing/tickets/[id]/verification/[step]/route');

    const request = new NextRequest('http://localhost:3000/api/ticketing/tickets/123/verification/invalid', {
      method: 'PUT',
      body: JSON.stringify({ is_complete: true }),
    });

    const response = await PUT(request, { params: { id: mockTicketId, step: 'invalid' } });
    const data = await response.json();

    expect(response.status).toBe(422);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe('VALIDATION_ERROR');
    expect(data.error.message).toContain('step number');
    expect(verificationService.updateVerificationStep).not.toHaveBeenCalled();
  });

  it('should return validation error for out-of-range step number', async () => {
    const { PUT } = await import('../../../../app/api/ticketing/tickets/[id]/verification/[step]/route');

    const request = new NextRequest('http://localhost:3000/api/ticketing/tickets/123/verification/13', {
      method: 'PUT',
      body: JSON.stringify({ is_complete: true }),
    });

    const response = await PUT(request, { params: { id: mockTicketId, step: '13' } });
    const data = await response.json();

    expect(response.status).toBe(422);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe('VALIDATION_ERROR');
    expect(data.error.message).toContain('1 and 12');
    expect(verificationService.updateVerificationStep).not.toHaveBeenCalled();
  });

  it('should return 404 when step not found', async () => {
    // 🟢 WORKING: Mock service to throw not found error
    vi.mocked(verificationService.updateVerificationStep).mockRejectedValue(
      new Error('Verification step not found')
    );

    const { PUT } = await import('../../../../app/api/ticketing/tickets/[id]/verification/[step]/route');

    const request = new NextRequest('http://localhost:3000/api/ticketing/tickets/123/verification/1', {
      method: 'PUT',
      body: JSON.stringify({ is_complete: true }),
    });

    const response = await PUT(request, { params: { id: mockTicketId, step: '1' } });
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe('NOT_FOUND');
  });

  it('should handle empty request body gracefully', async () => {
    // 🟢 WORKING: Mock service to return unchanged step
    vi.mocked(verificationService.updateVerificationStep).mockResolvedValue(mockVerificationStep);

    const { PUT } = await import('../../../../app/api/ticketing/tickets/[id]/verification/[step]/route');

    const request = new NextRequest('http://localhost:3000/api/ticketing/tickets/123/verification/1', {
      method: 'PUT',
      body: JSON.stringify({}),
    });

    const response = await PUT(request, { params: { id: mockTicketId, step: '1' } });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(verificationService.updateVerificationStep).toHaveBeenCalledWith(
      mockTicketId,
      1,
      {}
    );
  });
});

// ==================== POST /api/ticketing/tickets/[id]/verification/complete ====================

describe('POST /api/ticketing/tickets/[id]/verification/complete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should complete all verification steps successfully', async () => {
    // 🟢 WORKING: Mock service to return complete progress
    vi.mocked(verificationService.calculateProgress).mockResolvedValue(mockCompleteProgress);
    vi.mocked(verificationService.isAllStepsComplete).mockResolvedValue(true);

    const { POST } = await import('../../../../app/api/ticketing/tickets/[id]/verification/complete/route');

    const request = new NextRequest('http://localhost:3000/api/ticketing/tickets/123/verification/complete', {
      method: 'POST',
    });

    const response = await POST(request, { params: { id: mockTicketId } });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.all_steps_complete).toBe(true);
    expect(data.data.completed_steps).toBe(12);
    expect(data.data.progress_percentage).toBe(100);
    expect(data.message).toContain('All verification steps completed');
  });

  it('should return progress even if not all steps complete', async () => {
    // 🟢 WORKING: Mock service to return partial progress
    vi.mocked(verificationService.calculateProgress).mockResolvedValue(mockProgress);
    vi.mocked(verificationService.isAllStepsComplete).mockResolvedValue(false);

    const { POST } = await import('../../../../app/api/ticketing/tickets/[id]/verification/complete/route');

    const request = new NextRequest('http://localhost:3000/api/ticketing/tickets/123/verification/complete', {
      method: 'POST',
    });

    const response = await POST(request, { params: { id: mockTicketId } });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.all_steps_complete).toBe(false);
    expect(data.data.completed_steps).toBe(3);
    expect(data.data.progress_percentage).toBe(25);
    expect(data.message).toContain('Verification progress');
  });

  it('should return validation error for invalid ticket ID', async () => {
    const { POST } = await import('../../../../app/api/ticketing/tickets/[id]/verification/complete/route');

    const request = new NextRequest('http://localhost:3000/api/ticketing/tickets/invalid/verification/complete', {
      method: 'POST',
    });

    const response = await POST(request, { params: { id: 'invalid-uuid' } });
    const data = await response.json();

    expect(response.status).toBe(422);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe('VALIDATION_ERROR');
    expect(verificationService.calculateProgress).not.toHaveBeenCalled();
  });

  it('should return 404 when ticket not found', async () => {
    // 🟢 WORKING: Mock service to throw not found error
    vi.mocked(verificationService.calculateProgress).mockRejectedValue(
      new Error('No verification steps found for this ticket')
    );

    const { POST } = await import('../../../../app/api/ticketing/tickets/[id]/verification/complete/route');

    const request = new NextRequest('http://localhost:3000/api/ticketing/tickets/123/verification/complete', {
      method: 'POST',
    });

    const response = await POST(request, { params: { id: mockTicketId } });
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe('NOT_FOUND');
  });

  it('should handle database errors gracefully', async () => {
    // 🟢 WORKING: Mock service to throw database error
    vi.mocked(verificationService.calculateProgress).mockRejectedValue(
      new Error('Database connection failed')
    );

    const { POST } = await import('../../../../app/api/ticketing/tickets/[id]/verification/complete/route');

    const request = new NextRequest('http://localhost:3000/api/ticketing/tickets/123/verification/complete', {
      method: 'POST',
    });

    const response = await POST(request, { params: { id: mockTicketId } });
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe('DATABASE_ERROR');
  });
});

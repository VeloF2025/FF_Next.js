/**
 * Tests for Contractor Onboarding Complete API
 * POST /api/contractors/[contractorId]/onboarding/complete
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';
import handler from './complete';
import { neonContractorService } from '@/services/contractor/neonContractorService';

// Mock the service
vi.mock('@/services/contractor/neonContractorService', () => ({
  neonContractorService: {
    getContractorById: vi.fn(),
    completeOnboarding: vi.fn(),
  },
}));

// Mock logger
vi.mock('@/lib/logger', () => ({
  log: {
    error: vi.fn(),
  },
  createLogger: vi.fn(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() })),
}));

// Helper to create mock request/response
function createMocks(
  method: string,
  query: Record<string, string | string[]> = {},
  body: any = {}
): { req: NextApiRequest; res: NextApiResponse } {
  const req = {
    method,
    query,
    body,
  } as unknown as NextApiRequest;

  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    setHeader: vi.fn().mockReturnThis(),
  } as unknown as NextApiResponse;

  return { req, res };
}

describe('/api/contractors/[contractorId]/onboarding/complete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const validContractor = {
    id: 'contractor-123',
    companyName: 'Test Contractor',
    onboardingProgress: 90,
    onboardingCompletedAt: null,
  };

  const completedContractor = {
    id: 'contractor-123',
    companyName: 'Test Contractor',
    onboardingProgress: 100,
    onboardingCompletedAt: '2025-10-24T12:00:00Z',
  };

  describe('POST /api/contractors/[contractorId]/onboarding/complete', () => {
    it('should complete onboarding successfully', async () => {
      const { req, res } = createMocks('POST', { contractorId: 'contractor-123' });

      vi.mocked(neonContractorService.getContractorById).mockResolvedValue(validContractor as any);
      vi.mocked(neonContractorService.completeOnboarding).mockResolvedValue(completedContractor as any);

      await handler(req, res);

      expect(neonContractorService.getContractorById).toHaveBeenCalledWith('contractor-123');
      expect(neonContractorService.completeOnboarding).toHaveBeenCalledWith('contractor-123');
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            onboardingProgress: 100,
            onboardingCompletedAt: '2025-10-24T12:00:00Z',
          }),
          message: 'Onboarding completed successfully',
        })
      );
    });

    it('should return updated contractor with onboarding fields', async () => {
      const { req, res } = createMocks('POST', { contractorId: 'contractor-123' });

      vi.mocked(neonContractorService.getContractorById).mockResolvedValue(validContractor as any);
      vi.mocked(neonContractorService.completeOnboarding).mockResolvedValue(completedContractor as any);

      await handler(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            id: 'contractor-123',
            companyName: 'Test Contractor',
          }),
        })
      );
    });

    it('should return 400 if contractorId is missing', async () => {
      const { req, res } = createMocks('POST', {});

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({
            code: 'VALIDATION_ERROR',
            details: { contractorId: 'Invalid contractor ID' },
          }),
        })
      );
    });

    it('should return 400 if contractorId is not a string', async () => {
      const { req, res } = createMocks('POST', { contractorId: ['array-value'] as any });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({
            code: 'VALIDATION_ERROR',
            details: { contractorId: 'Invalid contractor ID' },
          }),
        })
      );
    });

    it('should return 404 if contractor does not exist', async () => {
      const { req, res } = createMocks('POST', { contractorId: 'nonexistent' });

      vi.mocked(neonContractorService.getContractorById).mockResolvedValue(null);

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({
            code: 'NOT_FOUND',
            message: 'Contractor not found: nonexistent',
          }),
        })
      );
    });

    it('should return 400 if onboarding already completed', async () => {
      const alreadyCompletedContractor = {
        ...validContractor,
        onboardingCompletedAt: '2025-10-20T10:00:00Z',
      };

      const { req, res } = createMocks('POST', { contractorId: 'contractor-123' });

      vi.mocked(neonContractorService.getContractorById).mockResolvedValue(alreadyCompletedContractor as any);

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({
            details: {
              onboarding: 'Onboarding already completed on 2025-10-20T10:00:00Z',
            },
          }),
        })
      );
      expect(neonContractorService.completeOnboarding).not.toHaveBeenCalled();
    });

    it('should return 400 if required stages are not completed', async () => {
      const { req, res } = createMocks('POST', { contractorId: 'contractor-123' });

      vi.mocked(neonContractorService.getContractorById).mockResolvedValue(validContractor as any);
      vi.mocked(neonContractorService.completeOnboarding).mockRejectedValue(
        new Error('Cannot complete onboarding. Missing stages: Safety Compliance, Team Setup')
      );

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({
            details: {
              stages: 'Cannot complete onboarding. Missing stages: Safety Compliance, Team Setup',
            },
          }),
        })
      );
    });

    it('should return 400 with specific missing stage names', async () => {
      const { req, res } = createMocks('POST', { contractorId: 'contractor-123' });

      vi.mocked(neonContractorService.getContractorById).mockResolvedValue(validContractor as any);
      vi.mocked(neonContractorService.completeOnboarding).mockRejectedValue(
        new Error('Cannot complete onboarding. Missing stages: Document Upload')
      );

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({
            details: {
              stages: expect.stringContaining('Document Upload'),
            },
          }),
        })
      );
    });

    it('should return 405 for GET method', async () => {
      const { req, res } = createMocks('GET', { contractorId: 'contractor-123' });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(405);
      expect(res.setHeader).toHaveBeenCalledWith('Allow', ['POST']);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Method GET Not Allowed',
      });
    });

    it('should return 405 for PUT method', async () => {
      const { req, res } = createMocks('PUT', { contractorId: 'contractor-123' });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(405);
      expect(res.setHeader).toHaveBeenCalledWith('Allow', ['POST']);
    });

    it('should return 405 for DELETE method', async () => {
      const { req, res } = createMocks('DELETE', { contractorId: 'contractor-123' });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(405);
      expect(res.setHeader).toHaveBeenCalledWith('Allow', ['POST']);
    });

    it('should handle service errors gracefully', async () => {
      const { req, res } = createMocks('POST', { contractorId: 'contractor-123' });

      vi.mocked(neonContractorService.getContractorById).mockResolvedValue(validContractor as any);
      vi.mocked(neonContractorService.completeOnboarding).mockRejectedValue(
        new Error('Database connection failed')
      );

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({
            code: 'INTERNAL_ERROR',
          }),
        })
      );
    });

    it('should handle errors from getContractorById gracefully', async () => {
      const { req, res } = createMocks('POST', { contractorId: 'contractor-123' });

      vi.mocked(neonContractorService.getContractorById).mockRejectedValue(
        new Error('Database query failed')
      );

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({
            code: 'INTERNAL_ERROR',
          }),
        })
      );
    });
  });
});

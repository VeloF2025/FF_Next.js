/**
 * Tests for Contractor Onboarding Stages API
 * GET /api/contractors/[contractorId]/onboarding/stages
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';
import handler from './stages';
import { neonContractorService } from '@/services/contractor/neonContractorService';

// Mock the service
vi.mock('@/services/contractor/neonContractorService', () => ({
  neonContractorService: {
    getContractorById: vi.fn(),
    getOnboardingStages: vi.fn(),
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
  query: Record<string, string | string[]> = {}
): { req: NextApiRequest; res: NextApiResponse } {
  const req = {
    method,
    query,
  } as unknown as NextApiRequest;

  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    setHeader: vi.fn().mockReturnThis(),
  } as unknown as NextApiResponse;

  return { req, res };
}

describe('/api/contractors/[contractorId]/onboarding/stages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const validContractor = {
    id: 'contractor-123',
    companyName: 'Test Contractor',
  };

  const sampleStages = [
    {
      id: 'stage-1',
      contractorId: 'contractor-123',
      stageName: 'Company Registration',
      stageOrder: 1,
      status: 'completed',
      completionPercentage: 100,
      requiredDocuments: ['registration_cert', 'tax_clearance'],
      completedDocuments: ['registration_cert', 'tax_clearance'],
      startedAt: '2025-10-20T10:00:00Z',
      completedAt: '2025-10-21T15:00:00Z',
      dueDate: null,
      notes: 'All documents verified',
    },
    {
      id: 'stage-2',
      contractorId: 'contractor-123',
      stageName: 'Safety Compliance',
      stageOrder: 2,
      status: 'in_progress',
      completionPercentage: 60,
      requiredDocuments: ['safety_cert', 'insurance'],
      completedDocuments: ['safety_cert'],
      startedAt: '2025-10-22T09:00:00Z',
      completedAt: null,
      dueDate: '2025-10-30',
      notes: 'Waiting for insurance documents',
    },
    {
      id: 'stage-3',
      contractorId: 'contractor-123',
      stageName: 'Team Setup',
      stageOrder: 3,
      status: 'pending',
      completionPercentage: 0,
      requiredDocuments: [],
      completedDocuments: [],
      startedAt: null,
      completedAt: null,
      dueDate: null,
      notes: null,
    },
  ];

  describe('GET /api/contractors/[contractorId]/onboarding/stages', () => {
    it('should return all onboarding stages for a contractor', async () => {
      const { req, res } = createMocks('GET', { contractorId: 'contractor-123' });

      vi.mocked(neonContractorService.getContractorById).mockResolvedValue(validContractor as any);
      vi.mocked(neonContractorService.getOnboardingStages).mockResolvedValue(sampleStages as any);

      await handler(req, res);

      expect(neonContractorService.getContractorById).toHaveBeenCalledWith('contractor-123');
      expect(neonContractorService.getOnboardingStages).toHaveBeenCalledWith('contractor-123');
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: sampleStages,
        })
      );
    });

    it('should return stages in order by stage_order', async () => {
      const { req, res } = createMocks('GET', { contractorId: 'contractor-123' });

      vi.mocked(neonContractorService.getContractorById).mockResolvedValue(validContractor as any);
      vi.mocked(neonContractorService.getOnboardingStages).mockResolvedValue(sampleStages as any);

      await handler(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({ stageOrder: 1 }),
            expect.objectContaining({ stageOrder: 2 }),
            expect.objectContaining({ stageOrder: 3 }),
          ]),
        })
      );
    });

    it('should return empty array when no stages exist', async () => {
      const { req, res } = createMocks('GET', { contractorId: 'contractor-123' });

      vi.mocked(neonContractorService.getContractorById).mockResolvedValue(validContractor as any);
      vi.mocked(neonContractorService.getOnboardingStages).mockResolvedValue([]);

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: [],
        })
      );
    });

    it('should return 400 if contractorId is missing', async () => {
      const { req, res } = createMocks('GET', {});

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
      const { req, res } = createMocks('GET', { contractorId: ['array-value'] as any });

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
      const { req, res } = createMocks('GET', { contractorId: 'nonexistent' });

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

    it('should return 405 for POST method', async () => {
      const { req, res } = createMocks('POST', { contractorId: 'contractor-123' });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(405);
      expect(res.setHeader).toHaveBeenCalledWith('Allow', ['GET']);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Method POST Not Allowed',
      });
    });

    it('should return 405 for PUT method', async () => {
      const { req, res } = createMocks('PUT', { contractorId: 'contractor-123' });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(405);
      expect(res.setHeader).toHaveBeenCalledWith('Allow', ['GET']);
    });

    it('should return 405 for DELETE method', async () => {
      const { req, res } = createMocks('DELETE', { contractorId: 'contractor-123' });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(405);
      expect(res.setHeader).toHaveBeenCalledWith('Allow', ['GET']);
    });

    it('should handle service errors gracefully', async () => {
      const { req, res } = createMocks('GET', { contractorId: 'contractor-123' });

      vi.mocked(neonContractorService.getContractorById).mockResolvedValue(validContractor as any);
      vi.mocked(neonContractorService.getOnboardingStages).mockRejectedValue(
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
  });
});

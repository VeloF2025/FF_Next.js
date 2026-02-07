/**
 * Tests for Contractor Onboarding Stage API
 * PUT /api/contractors/[contractorId]/onboarding/stages/[stageId]
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';
import handler from './[stageId]';
import { neonContractorService } from '@/services/contractor/neonContractorService';

// Mock the service
vi.mock('@/services/contractor/neonContractorService', () => ({
  neonContractorService: {
    getContractorById: vi.fn(),
    getOnboardingStages: vi.fn(),
    updateOnboardingStage: vi.fn(),
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

describe('/api/contractors/[contractorId]/onboarding/stages/[stageId]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const validContractor = {
    id: 'contractor-123',
    companyName: 'Test Contractor',
  };

  const existingStages = [
    {
      id: 'stage-1',
      contractorId: 'contractor-123',
      stageName: 'Company Registration',
      stageOrder: 1,
      status: 'in_progress',
      completionPercentage: 50,
    },
    {
      id: 'stage-2',
      contractorId: 'contractor-123',
      stageName: 'Safety Compliance',
      stageOrder: 2,
      status: 'pending',
      completionPercentage: 0,
    },
  ];

  describe('PUT /api/contractors/[contractorId]/onboarding/stages/[stageId]', () => {
    it('should update stage status successfully', async () => {
      const { req, res } = createMocks('PUT',
        { contractorId: 'contractor-123', stageId: 'stage-1' },
        { status: 'completed' }
      );

      vi.mocked(neonContractorService.getContractorById).mockResolvedValue(validContractor as any);
      vi.mocked(neonContractorService.getOnboardingStages).mockResolvedValue(existingStages as any);
      vi.mocked(neonContractorService.updateOnboardingStage).mockResolvedValue({
        ...existingStages[0],
        status: 'completed',
      } as any);

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            status: 'completed',
          }),
          message: 'Onboarding stage updated successfully',
        })
      );
      expect(neonContractorService.updateOnboardingStage).toHaveBeenCalledWith(
        'stage-1',
        { status: 'completed' }
      );
    });

    it('should update completion percentage', async () => {
      const { req, res } = createMocks('PUT',
        { contractorId: 'contractor-123', stageId: 'stage-1' },
        { completionPercentage: 75 }
      );

      vi.mocked(neonContractorService.getContractorById).mockResolvedValue(validContractor as any);
      vi.mocked(neonContractorService.getOnboardingStages).mockResolvedValue(existingStages as any);
      vi.mocked(neonContractorService.updateOnboardingStage).mockResolvedValue({
        ...existingStages[0],
        completionPercentage: 75,
      } as any);

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(neonContractorService.updateOnboardingStage).toHaveBeenCalledWith(
        'stage-1',
        { completionPercentage: 75 }
      );
    });

    it('should update completed documents', async () => {
      const { req, res } = createMocks('PUT',
        { contractorId: 'contractor-123', stageId: 'stage-1' },
        { completedDocuments: ['doc1', 'doc2', 'doc3'] }
      );

      vi.mocked(neonContractorService.getContractorById).mockResolvedValue(validContractor as any);
      vi.mocked(neonContractorService.getOnboardingStages).mockResolvedValue(existingStages as any);
      vi.mocked(neonContractorService.updateOnboardingStage).mockResolvedValue({
        ...existingStages[0],
        completedDocuments: ['doc1', 'doc2', 'doc3'],
      } as any);

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(neonContractorService.updateOnboardingStage).toHaveBeenCalledWith(
        'stage-1',
        { completedDocuments: ['doc1', 'doc2', 'doc3'] }
      );
    });

    it('should update all fields at once', async () => {
      const updateData = {
        status: 'completed',
        completionPercentage: 100,
        completedDocuments: ['doc1', 'doc2'],
        startedAt: '2025-10-20T10:00:00Z',
        completedAt: '2025-10-24T15:00:00Z',
        notes: 'All requirements met',
      };

      const { req, res } = createMocks('PUT',
        { contractorId: 'contractor-123', stageId: 'stage-1' },
        updateData
      );

      vi.mocked(neonContractorService.getContractorById).mockResolvedValue(validContractor as any);
      vi.mocked(neonContractorService.getOnboardingStages).mockResolvedValue(existingStages as any);
      vi.mocked(neonContractorService.updateOnboardingStage).mockResolvedValue({
        ...existingStages[0],
        ...updateData,
      } as any);

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(neonContractorService.updateOnboardingStage).toHaveBeenCalledWith(
        'stage-1',
        expect.objectContaining({
          status: 'completed',
          completionPercentage: 100,
          completedDocuments: ['doc1', 'doc2'],
          notes: 'All requirements met',
        })
      );
    });

    it('should return 400 if contractorId is missing', async () => {
      const { req, res } = createMocks('PUT', { stageId: 'stage-1' }, { status: 'completed' });

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

    it('should return 400 if stageId is missing', async () => {
      const { req, res } = createMocks('PUT', { contractorId: 'contractor-123' }, { status: 'completed' });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({
            code: 'VALIDATION_ERROR',
            details: { stageId: 'Invalid stage ID' },
          }),
        })
      );
    });

    it('should return 404 if contractor does not exist', async () => {
      const { req, res } = createMocks('PUT',
        { contractorId: 'nonexistent', stageId: 'stage-1' },
        { status: 'completed' }
      );

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

    it('should return 404 if stage does not exist for contractor', async () => {
      const { req, res } = createMocks('PUT',
        { contractorId: 'contractor-123', stageId: 'nonexistent-stage' },
        { status: 'completed' }
      );

      vi.mocked(neonContractorService.getContractorById).mockResolvedValue(validContractor as any);
      vi.mocked(neonContractorService.getOnboardingStages).mockResolvedValue(existingStages as any);

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({
            code: 'NOT_FOUND',
            message: 'Onboarding stage not found: nonexistent-stage',
          }),
        })
      );
    });

    it('should return 400 for invalid status', async () => {
      const { req, res } = createMocks('PUT',
        { contractorId: 'contractor-123', stageId: 'stage-1' },
        { status: 'invalid_status' }
      );

      vi.mocked(neonContractorService.getContractorById).mockResolvedValue(validContractor as any);
      vi.mocked(neonContractorService.getOnboardingStages).mockResolvedValue(existingStages as any);

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({
            details: { status: 'Invalid status. Must be one of: pending, in_progress, completed, skipped' },
          }),
        })
      );
    });

    it('should return 400 for completion percentage below 0', async () => {
      const { req, res } = createMocks('PUT',
        { contractorId: 'contractor-123', stageId: 'stage-1' },
        { completionPercentage: -10 }
      );

      vi.mocked(neonContractorService.getContractorById).mockResolvedValue(validContractor as any);
      vi.mocked(neonContractorService.getOnboardingStages).mockResolvedValue(existingStages as any);

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({
            details: { completionPercentage: 'Completion percentage must be between 0 and 100' },
          }),
        })
      );
    });

    it('should return 400 for completion percentage above 100', async () => {
      const { req, res } = createMocks('PUT',
        { contractorId: 'contractor-123', stageId: 'stage-1' },
        { completionPercentage: 150 }
      );

      vi.mocked(neonContractorService.getContractorById).mockResolvedValue(validContractor as any);
      vi.mocked(neonContractorService.getOnboardingStages).mockResolvedValue(existingStages as any);

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({
            details: { completionPercentage: 'Completion percentage must be between 0 and 100' },
          }),
        })
      );
    });

    it('should return 400 if completedDocuments is not an array', async () => {
      const { req, res } = createMocks('PUT',
        { contractorId: 'contractor-123', stageId: 'stage-1' },
        { completedDocuments: 'not-an-array' }
      );

      vi.mocked(neonContractorService.getContractorById).mockResolvedValue(validContractor as any);
      vi.mocked(neonContractorService.getOnboardingStages).mockResolvedValue(existingStages as any);

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({
            details: { completedDocuments: 'Completed documents must be an array' },
          }),
        })
      );
    });

    it('should return 400 for invalid startedAt date', async () => {
      const { req, res } = createMocks('PUT',
        { contractorId: 'contractor-123', stageId: 'stage-1' },
        { startedAt: 'invalid-date' }
      );

      vi.mocked(neonContractorService.getContractorById).mockResolvedValue(validContractor as any);
      vi.mocked(neonContractorService.getOnboardingStages).mockResolvedValue(existingStages as any);

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({
            details: { startedAt: 'Invalid date format' },
          }),
        })
      );
    });

    it('should return 400 for invalid completedAt date', async () => {
      const { req, res } = createMocks('PUT',
        { contractorId: 'contractor-123', stageId: 'stage-1' },
        { completedAt: 'not-a-date' }
      );

      vi.mocked(neonContractorService.getContractorById).mockResolvedValue(validContractor as any);
      vi.mocked(neonContractorService.getOnboardingStages).mockResolvedValue(existingStages as any);

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({
            details: { completedAt: 'Invalid date format' },
          }),
        })
      );
    });

    it('should return 405 for GET method', async () => {
      const { req, res } = createMocks('GET', { contractorId: 'contractor-123', stageId: 'stage-1' });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(405);
      expect(res.setHeader).toHaveBeenCalledWith('Allow', ['PUT']);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Method GET Not Allowed',
      });
    });

    it('should return 405 for POST method', async () => {
      const { req, res } = createMocks('POST', { contractorId: 'contractor-123', stageId: 'stage-1' });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(405);
      expect(res.setHeader).toHaveBeenCalledWith('Allow', ['PUT']);
    });

    it('should return 405 for DELETE method', async () => {
      const { req, res } = createMocks('DELETE', { contractorId: 'contractor-123', stageId: 'stage-1' });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(405);
      expect(res.setHeader).toHaveBeenCalledWith('Allow', ['PUT']);
    });

    it('should handle service errors gracefully', async () => {
      const { req, res } = createMocks('PUT',
        { contractorId: 'contractor-123', stageId: 'stage-1' },
        { status: 'completed' }
      );

      vi.mocked(neonContractorService.getContractorById).mockResolvedValue(validContractor as any);
      vi.mocked(neonContractorService.getOnboardingStages).mockResolvedValue(existingStages as any);
      vi.mocked(neonContractorService.updateOnboardingStage).mockRejectedValue(
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

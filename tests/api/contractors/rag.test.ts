/**
 * Tests for Contractor RAG API
 * PUT /api/contractors/[contractorId]/rag - Update RAG scores
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';
import handler from '../../../pages/api/contractors-rag';
import { neonContractorService } from '@/services/contractor/neonContractorService';

// Mock the service
vi.mock('@/services/contractor/neonContractorService', () => ({
  neonContractorService: {
    getContractorById: vi.fn(),
    updateRAGScores: vi.fn(),
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
  query: Record<string, string> = {},
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

describe('/api/contractors/[contractorId]/rag', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('PUT /api/contractors/[contractorId]/rag', () => {
    const validContractor = {
      id: 'contractor-123',
      companyName: 'Test Contractor',
      ragScoreOverall: 'green',
      ragScoreFinancial: 'green',
      ragScoreCompliance: 'green',
      ragScorePerformance: 'green',
      ragScoreSafety: 'green',
    };

    it('should update RAG scores successfully', async () => {
      const { req, res } = createMocks('PUT', { contractorId: 'contractor-123' }, {
        scores: {
          overall: 'amber',
          financial: 'green',
        },
        reason: 'Late payment issues identified',
        changedBy: 'user-123',
      });

      vi.mocked(neonContractorService.getContractorById).mockResolvedValue(validContractor as any);
      vi.mocked(neonContractorService.updateRAGScores).mockResolvedValue({
        ...validContractor,
        ragScoreOverall: 'amber',
      } as any);

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            ragScoreOverall: 'amber',
          }),
          message: 'RAG scores updated successfully',
        })
      );
      expect(neonContractorService.updateRAGScores).toHaveBeenCalledWith(
        'contractor-123',
        { overall: 'amber', financial: 'green' },
        'Late payment issues identified',
        'user-123'
      );
    });

    it('should update all RAG score types', async () => {
      const { req, res } = createMocks('PUT', { contractorId: 'contractor-123' }, {
        scores: {
          overall: 'red',
          financial: 'amber',
          compliance: 'green',
          performance: 'amber',
          safety: 'red',
        },
        reason: 'Comprehensive review conducted',
        changedBy: 'admin-456',
      });

      vi.mocked(neonContractorService.getContractorById).mockResolvedValue(validContractor as any);
      vi.mocked(neonContractorService.updateRAGScores).mockResolvedValue({
        ...validContractor,
        ragScoreOverall: 'red',
        ragScoreFinancial: 'amber',
        ragScoreCompliance: 'green',
        ragScorePerformance: 'amber',
        ragScoreSafety: 'red',
      } as any);

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(neonContractorService.updateRAGScores).toHaveBeenCalledWith(
        'contractor-123',
        expect.objectContaining({
          overall: 'red',
          financial: 'amber',
          compliance: 'green',
          performance: 'amber',
          safety: 'red',
        }),
        'Comprehensive review conducted',
        'admin-456'
      );
    });

    it('should return 400 if contractorId is missing', async () => {
      const { req, res } = createMocks('PUT', {}, {
        scores: { overall: 'green' },
        reason: 'Test',
        changedBy: 'user-123',
      });

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
      const { req, res } = createMocks('PUT', { contractorId: ['array-value'] as any }, {
        scores: { overall: 'green' },
        reason: 'Test',
        changedBy: 'user-123',
      });

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
      const { req, res } = createMocks('PUT', { contractorId: 'nonexistent' }, {
        scores: { overall: 'green' },
        reason: 'Test',
        changedBy: 'user-123',
      });

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

    it('should return 400 if scores is missing', async () => {
      const { req, res } = createMocks('PUT', { contractorId: 'contractor-123' }, {
        reason: 'Test',
        changedBy: 'user-123',
      });

      vi.mocked(neonContractorService.getContractorById).mockResolvedValue(validContractor as any);

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({
            details: { scores: 'scores object is required' },
          }),
        })
      );
    });

    it('should return 400 if scores is not an object', async () => {
      const { req, res } = createMocks('PUT', { contractorId: 'contractor-123' }, {
        scores: 'not-an-object',
        reason: 'Test',
        changedBy: 'user-123',
      });

      vi.mocked(neonContractorService.getContractorById).mockResolvedValue(validContractor as any);

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({
            details: { scores: 'scores object is required' },
          }),
        })
      );
    });

    it('should return 400 if reason is missing', async () => {
      const { req, res } = createMocks('PUT', { contractorId: 'contractor-123' }, {
        scores: { overall: 'green' },
        changedBy: 'user-123',
      });

      vi.mocked(neonContractorService.getContractorById).mockResolvedValue(validContractor as any);

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({
            details: { reason: 'Change reason is required' },
          }),
        })
      );
    });

    it('should return 400 if reason is empty', async () => {
      const { req, res } = createMocks('PUT', { contractorId: 'contractor-123' }, {
        scores: { overall: 'green' },
        reason: '   ',
        changedBy: 'user-123',
      });

      vi.mocked(neonContractorService.getContractorById).mockResolvedValue(validContractor as any);

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({
            details: { reason: 'Change reason is required' },
          }),
        })
      );
    });

    it('should return 400 if changedBy is missing', async () => {
      const { req, res } = createMocks('PUT', { contractorId: 'contractor-123' }, {
        scores: { overall: 'green' },
        reason: 'Test reason',
      });

      vi.mocked(neonContractorService.getContractorById).mockResolvedValue(validContractor as any);

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({
            details: { changedBy: 'changedBy is required' },
          }),
        })
      );
    });

    it('should return 400 if changedBy is empty', async () => {
      const { req, res } = createMocks('PUT', { contractorId: 'contractor-123' }, {
        scores: { overall: 'green' },
        reason: 'Test reason',
        changedBy: '   ',
      });

      vi.mocked(neonContractorService.getContractorById).mockResolvedValue(validContractor as any);

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({
            details: { changedBy: 'changedBy is required' },
          }),
        })
      );
    });

    it('should return 400 for invalid RAG value', async () => {
      const { req, res } = createMocks('PUT', { contractorId: 'contractor-123' }, {
        scores: { overall: 'blue' },
        reason: 'Test',
        changedBy: 'user-123',
      });

      vi.mocked(neonContractorService.getContractorById).mockResolvedValue(validContractor as any);

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({
            details: { overall: 'Invalid RAG value. Must be one of: red, amber, green' },
          }),
        })
      );
    });

    it('should return 400 for invalid score type', async () => {
      const { req, res } = createMocks('PUT', { contractorId: 'contractor-123' }, {
        scores: { invalid_type: 'green' },
        reason: 'Test',
        changedBy: 'user-123',
      });

      vi.mocked(neonContractorService.getContractorById).mockResolvedValue(validContractor as any);

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({
            details: { invalid_type: 'Invalid score type. Must be one of: overall, financial, compliance, performance, safety' },
          }),
        })
      );
    });

    it('should allow null RAG values', async () => {
      const { req, res } = createMocks('PUT', { contractorId: 'contractor-123' }, {
        scores: { overall: null, financial: 'green' },
        reason: 'Clearing overall score',
        changedBy: 'user-123',
      });

      vi.mocked(neonContractorService.getContractorById).mockResolvedValue(validContractor as any);
      vi.mocked(neonContractorService.updateRAGScores).mockResolvedValue({
        ...validContractor,
        ragScoreOverall: null,
      } as any);

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(neonContractorService.updateRAGScores).toHaveBeenCalledWith(
        'contractor-123',
        { overall: null, financial: 'green' },
        'Clearing overall score',
        'user-123'
      );
    });

    it('should return 405 for GET method', async () => {
      const { req, res } = createMocks('GET', { contractorId: 'contractor-123' });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(405);
      expect(res.setHeader).toHaveBeenCalledWith('Allow', ['PUT']);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Method GET Not Allowed',
      });
    });

    it('should return 405 for POST method', async () => {
      const { req, res } = createMocks('POST', { contractorId: 'contractor-123' });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(405);
      expect(res.setHeader).toHaveBeenCalledWith('Allow', ['PUT']);
    });

    it('should return 405 for DELETE method', async () => {
      const { req, res } = createMocks('DELETE', { contractorId: 'contractor-123' });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(405);
      expect(res.setHeader).toHaveBeenCalledWith('Allow', ['PUT']);
    });

    it('should handle service errors gracefully', async () => {
      const { req, res } = createMocks('PUT', { contractorId: 'contractor-123' }, {
        scores: { overall: 'green' },
        reason: 'Test',
        changedBy: 'user-123',
      });

      vi.mocked(neonContractorService.getContractorById).mockResolvedValue(validContractor as any);
      vi.mocked(neonContractorService.updateRAGScores).mockRejectedValue(
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

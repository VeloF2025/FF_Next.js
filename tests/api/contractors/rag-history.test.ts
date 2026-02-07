/**
 * Tests for Contractor RAG History API
 * GET /api/contractors/[contractorId]/rag/history - Get RAG score change history
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';
import handler from './history';
import { neonContractorService } from '@/services/contractor/neonContractorService';

// Mock the service
vi.mock('@/services/contractor/neonContractorService', () => ({
  neonContractorService: {
    getContractorById: vi.fn(),
    getRAGHistory: vi.fn(),
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

describe('/api/contractors/[contractorId]/rag/history', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const validContractor = {
    id: 'contractor-123',
    companyName: 'Test Contractor',
  };

  const sampleHistory = [
    {
      id: 'history-1',
      contractorId: 'contractor-123',
      scoreType: 'overall',
      oldScore: 'green',
      newScore: 'amber',
      reason: 'Late payments identified',
      changedBy: 'user-123',
      changedAt: '2025-10-24T10:00:00Z',
    },
    {
      id: 'history-2',
      contractorId: 'contractor-123',
      scoreType: 'financial',
      oldScore: 'green',
      newScore: 'red',
      reason: 'Cash flow concerns',
      changedBy: 'user-456',
      changedAt: '2025-10-24T09:00:00Z',
    },
  ];

  describe('GET /api/contractors/[contractorId]/rag/history', () => {
    it('should return all RAG history for a contractor', async () => {
      const { req, res } = createMocks('GET', { contractorId: 'contractor-123' });

      vi.mocked(neonContractorService.getContractorById).mockResolvedValue(validContractor as any);
      vi.mocked(neonContractorService.getRAGHistory).mockResolvedValue(sampleHistory as any);

      await handler(req, res);

      expect(neonContractorService.getContractorById).toHaveBeenCalledWith('contractor-123');
      expect(neonContractorService.getRAGHistory).toHaveBeenCalledWith('contractor-123', undefined);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: sampleHistory,
        })
      );
    });

    it('should filter history by scoreType', async () => {
      const { req, res } = createMocks('GET', {
        contractorId: 'contractor-123',
        scoreType: 'financial',
      });

      const filteredHistory = [sampleHistory[1]];

      vi.mocked(neonContractorService.getContractorById).mockResolvedValue(validContractor as any);
      vi.mocked(neonContractorService.getRAGHistory).mockResolvedValue(filteredHistory as any);

      await handler(req, res);

      expect(neonContractorService.getRAGHistory).toHaveBeenCalledWith('contractor-123', 'financial');
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: filteredHistory,
        })
      );
    });

    it('should filter by overall score type', async () => {
      const { req, res } = createMocks('GET', {
        contractorId: 'contractor-123',
        scoreType: 'overall',
      });

      vi.mocked(neonContractorService.getContractorById).mockResolvedValue(validContractor as any);
      vi.mocked(neonContractorService.getRAGHistory).mockResolvedValue([sampleHistory[0]] as any);

      await handler(req, res);

      expect(neonContractorService.getRAGHistory).toHaveBeenCalledWith('contractor-123', 'overall');
    });

    it('should filter by compliance score type', async () => {
      const { req, res } = createMocks('GET', {
        contractorId: 'contractor-123',
        scoreType: 'compliance',
      });

      vi.mocked(neonContractorService.getContractorById).mockResolvedValue(validContractor as any);
      vi.mocked(neonContractorService.getRAGHistory).mockResolvedValue([] as any);

      await handler(req, res);

      expect(neonContractorService.getRAGHistory).toHaveBeenCalledWith('contractor-123', 'compliance');
    });

    it('should filter by performance score type', async () => {
      const { req, res } = createMocks('GET', {
        contractorId: 'contractor-123',
        scoreType: 'performance',
      });

      vi.mocked(neonContractorService.getContractorById).mockResolvedValue(validContractor as any);
      vi.mocked(neonContractorService.getRAGHistory).mockResolvedValue([] as any);

      await handler(req, res);

      expect(neonContractorService.getRAGHistory).toHaveBeenCalledWith('contractor-123', 'performance');
    });

    it('should filter by safety score type', async () => {
      const { req, res } = createMocks('GET', {
        contractorId: 'contractor-123',
        scoreType: 'safety',
      });

      vi.mocked(neonContractorService.getContractorById).mockResolvedValue(validContractor as any);
      vi.mocked(neonContractorService.getRAGHistory).mockResolvedValue([] as any);

      await handler(req, res);

      expect(neonContractorService.getRAGHistory).toHaveBeenCalledWith('contractor-123', 'safety');
    });

    it('should return empty array when no history exists', async () => {
      const { req, res } = createMocks('GET', { contractorId: 'contractor-123' });

      vi.mocked(neonContractorService.getContractorById).mockResolvedValue(validContractor as any);
      vi.mocked(neonContractorService.getRAGHistory).mockResolvedValue([]);

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

    it('should return 400 for invalid scoreType', async () => {
      const { req, res } = createMocks('GET', {
        contractorId: 'contractor-123',
        scoreType: 'invalid_type',
      });

      vi.mocked(neonContractorService.getContractorById).mockResolvedValue(validContractor as any);

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({
            details: {
              scoreType: 'Invalid score type. Must be one of: overall, financial, compliance, performance, safety',
            },
          }),
        })
      );
    });

    it('should ignore scoreType if it is an array', async () => {
      const { req, res } = createMocks('GET', {
        contractorId: 'contractor-123',
        scoreType: ['overall', 'financial'] as any,
      });

      vi.mocked(neonContractorService.getContractorById).mockResolvedValue(validContractor as any);
      vi.mocked(neonContractorService.getRAGHistory).mockResolvedValue(sampleHistory as any);

      await handler(req, res);

      // Should call without scoreType filter when it's an array
      expect(neonContractorService.getRAGHistory).toHaveBeenCalledWith('contractor-123', undefined);
      expect(res.status).toHaveBeenCalledWith(200);
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
      vi.mocked(neonContractorService.getRAGHistory).mockRejectedValue(
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

    it('should handle getContractorById errors gracefully', async () => {
      const { req, res } = createMocks('GET', { contractorId: 'contractor-123' });

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

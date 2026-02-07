/**
 * Tests for Team CRUD API endpoints
 * Story 1.1: Implement Team CRUD Endpoints
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';
import handler from './[teamId]';
import { neonContractorService } from '@/services/contractor/neonContractorService';
import { apiResponse } from '@/lib/apiResponse';

// Mock dependencies
vi.mock('@/services/contractor/neonContractorService');
vi.mock('@/lib/apiResponse');
vi.mock('@/lib/logger', () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), getLogs: vi.fn(() => []), clearLogs: vi.fn() },
  createLogger: vi.fn(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() })),
}));

describe('Team API - Individual Team Operations', () => {
  let req: Partial<NextApiRequest>;
  let res: Partial<NextApiResponse>;

  beforeEach(() => {
    vi.clearAllMocks();

    req = {
      query: {
        contractorId: '123',
        teamId: '456'
      },
      body: {}
    };

    res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      setHeader: vi.fn().mockReturnThis()
    };

    // Mock apiResponse helper methods
    (apiResponse.success as any) = vi.fn();
    (apiResponse.notFound as any) = vi.fn();
    (apiResponse.validationError as any) = vi.fn();
    (apiResponse.internalError as any) = vi.fn();
  });

  describe('GET /api/contractors/[contractorId]/teams/[teamId]', () => {
    it('should return team when valid IDs provided', async () => {
      req.method = 'GET';

      const mockContractor = { id: '123', companyName: 'Test Contractor' };
      const mockTeam = {
        id: '456',
        contractorId: '123',
        teamName: 'Installation Team A',
        teamType: 'installation',
        teamSize: 5
      };

      (neonContractorService.getContractorById as any).mockResolvedValue(mockContractor);
      (neonContractorService.getContractorTeams as any).mockResolvedValue([mockTeam]);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(neonContractorService.getContractorById).toHaveBeenCalledWith('123');
      expect(neonContractorService.getContractorTeams).toHaveBeenCalledWith('123');
      expect(apiResponse.success).toHaveBeenCalledWith(res, mockTeam);
    });

    it('should return 404 when contractor not found', async () => {
      req.method = 'GET';

      (neonContractorService.getContractorById as any).mockResolvedValue(null);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(apiResponse.notFound).toHaveBeenCalledWith(res, 'Contractor', '123');
    });

    it('should return 404 when team not found', async () => {
      req.method = 'GET';

      const mockContractor = { id: '123', companyName: 'Test Contractor' };
      (neonContractorService.getContractorById as any).mockResolvedValue(mockContractor);
      (neonContractorService.getContractorTeams as any).mockResolvedValue([]);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(apiResponse.notFound).toHaveBeenCalledWith(res, 'Team', '456');
    });

    it('should return validation error when team belongs to different contractor', async () => {
      req.method = 'GET';

      const mockContractor = { id: '123', companyName: 'Test Contractor' };
      const mockTeam = {
        id: '456',
        contractorId: '999', // Different contractor
        teamName: 'Installation Team A'
      };

      (neonContractorService.getContractorById as any).mockResolvedValue(mockContractor);
      (neonContractorService.getContractorTeams as any).mockResolvedValue([mockTeam]);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(apiResponse.validationError).toHaveBeenCalledWith(res, {
        teamId: 'Team does not belong to this contractor'
      });
    });
  });

  describe('PUT /api/contractors/[contractorId]/teams/[teamId]', () => {
    it('should update team with valid data', async () => {
      req.method = 'PUT';
      req.body = {
        teamName: 'Updated Team Name',
        teamSize: 7,
        availability: 'available'
      };

      const mockContractor = { id: '123', companyName: 'Test Contractor' };
      const mockExistingTeam = {
        id: '456',
        contractorId: '123',
        teamName: 'Old Name',
        teamSize: 5
      };
      const mockUpdatedTeam = {
        ...mockExistingTeam,
        ...req.body
      };

      (neonContractorService.getContractorById as any).mockResolvedValue(mockContractor);
      (neonContractorService.getContractorTeams as any).mockResolvedValue([mockExistingTeam]);
      (neonContractorService.updateTeam as any).mockResolvedValue(mockUpdatedTeam);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(neonContractorService.updateTeam).toHaveBeenCalledWith('456', req.body);
      expect(apiResponse.success).toHaveBeenCalledWith(res, mockUpdatedTeam, 'Team updated successfully');
    });

    it('should validate team type', async () => {
      req.method = 'PUT';
      req.body = {
        teamType: 'invalid_type'
      };

      const mockContractor = { id: '123', companyName: 'Test Contractor' };
      const mockExistingTeam = { id: '456', contractorId: '123', teamName: 'Team A' };

      (neonContractorService.getContractorById as any).mockResolvedValue(mockContractor);
      (neonContractorService.getContractorTeams as any).mockResolvedValue([mockExistingTeam]);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(apiResponse.validationError).toHaveBeenCalled();
      const call = (apiResponse.validationError as any).mock.calls[0];
      expect(call[1].teamType).toContain('Invalid team type');
    });

    it('should validate team size range', async () => {
      req.method = 'PUT';
      req.body = {
        teamSize: 150 // Invalid - too large
      };

      const mockContractor = { id: '123', companyName: 'Test Contractor' };
      const mockExistingTeam = { id: '456', contractorId: '123', teamName: 'Team A' };

      (neonContractorService.getContractorById as any).mockResolvedValue(mockContractor);
      (neonContractorService.getContractorTeams as any).mockResolvedValue([mockExistingTeam]);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(apiResponse.validationError).toHaveBeenCalledWith(res, {
        teamSize: 'Team size must be between 1 and 100'
      });
    });

    it('should validate lead email format', async () => {
      req.method = 'PUT';
      req.body = {
        leadEmail: 'invalid-email'
      };

      const mockContractor = { id: '123', companyName: 'Test Contractor' };
      const mockExistingTeam = { id: '456', contractorId: '123', teamName: 'Team A' };

      (neonContractorService.getContractorById as any).mockResolvedValue(mockContractor);
      (neonContractorService.getContractorTeams as any).mockResolvedValue([mockExistingTeam]);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(apiResponse.validationError).toHaveBeenCalledWith(res, {
        leadEmail: 'Invalid email format'
      });
    });

    it('should handle duplicate team name error', async () => {
      req.method = 'PUT';
      req.body = {
        teamName: 'Duplicate Name'
      };

      const mockContractor = { id: '123', companyName: 'Test Contractor' };
      const mockExistingTeam = { id: '456', contractorId: '123', teamName: 'Team A' };

      (neonContractorService.getContractorById as any).mockResolvedValue(mockContractor);
      (neonContractorService.getContractorTeams as any).mockResolvedValue([mockExistingTeam]);
      (neonContractorService.updateTeam as any).mockRejectedValue(
        new Error('duplicate key value violates unique constraint')
      );

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(apiResponse.validationError).toHaveBeenCalledWith(res, {
        teamName: 'A team with this name already exists for this contractor'
      });
    });
  });

  describe('DELETE /api/contractors/[contractorId]/teams/[teamId]', () => {
    it('should delete team when valid', async () => {
      req.method = 'DELETE';

      const mockContractor = { id: '123', companyName: 'Test Contractor' };
      const mockExistingTeam = {
        id: '456',
        contractorId: '123',
        teamName: 'Team to Delete'
      };

      (neonContractorService.getContractorById as any).mockResolvedValue(mockContractor);
      (neonContractorService.getContractorTeams as any).mockResolvedValue([mockExistingTeam]);
      (neonContractorService.deleteTeam as any).mockResolvedValue(undefined);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(neonContractorService.deleteTeam).toHaveBeenCalledWith('456');
      expect(apiResponse.success).toHaveBeenCalledWith(
        res,
        { id: '456' },
        'Team deleted successfully'
      );
    });

    it('should return 404 when team not found', async () => {
      req.method = 'DELETE';

      const mockContractor = { id: '123', companyName: 'Test Contractor' };
      (neonContractorService.getContractorById as any).mockResolvedValue(mockContractor);
      (neonContractorService.getContractorTeams as any).mockResolvedValue([]);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(apiResponse.notFound).toHaveBeenCalledWith(res, 'Team', '456');
      expect(neonContractorService.deleteTeam).not.toHaveBeenCalled();
    });
  });

  describe('PATCH /api/contractors/[contractorId]/teams/[teamId]', () => {
    it('should update availability', async () => {
      req.method = 'PATCH';
      req.body = {
        availability: 'busy'
      };

      const mockContractor = { id: '123', companyName: 'Test Contractor' };
      const mockExistingTeam = {
        id: '456',
        contractorId: '123',
        teamName: 'Team A',
        availability: 'available'
      };
      const mockUpdatedTeam = {
        ...mockExistingTeam,
        availability: 'busy'
      };

      (neonContractorService.getContractorById as any).mockResolvedValue(mockContractor);
      (neonContractorService.getContractorTeams as any).mockResolvedValue([mockExistingTeam]);
      (neonContractorService.updateTeam as any).mockResolvedValue(mockUpdatedTeam);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(neonContractorService.updateTeam).toHaveBeenCalledWith('456', { availability: 'busy' });
      expect(apiResponse.success).toHaveBeenCalledWith(
        res,
        mockUpdatedTeam,
        'Team availability updated successfully'
      );
    });

    it('should validate availability value', async () => {
      req.method = 'PATCH';
      req.body = {
        availability: 'invalid_status'
      };

      const mockContractor = { id: '123', companyName: 'Test Contractor' };
      const mockExistingTeam = { id: '456', contractorId: '123', teamName: 'Team A' };

      (neonContractorService.getContractorById as any).mockResolvedValue(mockContractor);
      (neonContractorService.getContractorTeams as any).mockResolvedValue([mockExistingTeam]);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(apiResponse.validationError).toHaveBeenCalled();
      const call = (apiResponse.validationError as any).mock.calls[0];
      expect(call[1].availability).toContain('Invalid availability');
    });

    it('should return validation error when no valid fields provided', async () => {
      req.method = 'PATCH';
      req.body = {}; // No fields

      const mockContractor = { id: '123', companyName: 'Test Contractor' };
      const mockExistingTeam = { id: '456', contractorId: '123', teamName: 'Team A' };

      (neonContractorService.getContractorById as any).mockResolvedValue(mockContractor);
      (neonContractorService.getContractorTeams as any).mockResolvedValue([mockExistingTeam]);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(apiResponse.validationError).toHaveBeenCalledWith(res, {
        message: 'No valid fields provided for update. Supported fields: availability'
      });
    });
  });

  describe('Invalid method', () => {
    it('should return 405 for unsupported methods', async () => {
      req.method = 'POST';

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(res.setHeader).toHaveBeenCalledWith('Allow', ['GET', 'PUT', 'DELETE', 'PATCH']);
      expect(res.status).toHaveBeenCalledWith(405);
    });
  });

  describe('Invalid parameters', () => {
    it('should return validation error for invalid contractorId', async () => {
      req.method = 'GET';
      req.query = {
        contractorId: null,
        teamId: '456'
      };

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(apiResponse.validationError).toHaveBeenCalledWith(res, {
        contractorId: 'Invalid contractor ID'
      });
    });

    it('should return validation error for invalid teamId', async () => {
      req.method = 'GET';
      req.query = {
        contractorId: '123',
        teamId: null
      };

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(apiResponse.validationError).toHaveBeenCalledWith(res, {
        teamId: 'Invalid team ID'
      });
    });
  });
});

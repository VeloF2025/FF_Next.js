/**
 * Tests for Contractor Teams API endpoints
 * Story 2.1: Add API Route Tests
 * Tests: GET, POST /api/contractors/[id]/teams
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';
import handler from '../../../pages/api/contractors-teams';
import { neonContractorService } from '@/services/contractor/neonContractorService';
import { apiResponse } from '@/lib/apiResponse';

// Mock dependencies
vi.mock('@/services/contractor/neonContractorService');
vi.mock('@/lib/apiResponse');
vi.mock('@/lib/logger', () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), getLogs: vi.fn(() => []), clearLogs: vi.fn() },
  createLogger: vi.fn(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() })),
}));

describe('Contractor Teams API - List and Create', () => {
  let req: Partial<NextApiRequest>;
  let res: Partial<NextApiResponse>;

  beforeEach(() => {
    vi.clearAllMocks();

    req = {
      query: {
        id: '123'
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
    (apiResponse.created as any) = vi.fn();
    (apiResponse.notFound as any) = vi.fn();
    (apiResponse.validationError as any) = vi.fn();
    (apiResponse.internalError as any) = vi.fn();
  });

  describe('GET /api/contractors/[id]/teams', () => {
    it('should return all teams for a contractor', async () => {
      req.method = 'GET';

      const mockContractor = {
        id: '123',
        companyName: 'ABC Contractors'
      };

      const mockTeams = [
        {
          id: 'team1',
          contractorId: '123',
          teamName: 'Installation Team A',
          teamType: 'installation',
          teamSize: 5
        },
        {
          id: 'team2',
          contractorId: '123',
          teamName: 'Maintenance Team B',
          teamType: 'maintenance',
          teamSize: 3
        }
      ];

      (neonContractorService.getContractorById as any).mockResolvedValue(mockContractor);
      (neonContractorService.getContractorTeams as any).mockResolvedValue(mockTeams);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(neonContractorService.getContractorById).toHaveBeenCalledWith('123');
      expect(neonContractorService.getContractorTeams).toHaveBeenCalledWith('123');
      expect(apiResponse.success).toHaveBeenCalledWith(res, mockTeams);
    });

    it('should return 404 when contractor not found', async () => {
      req.method = 'GET';

      (neonContractorService.getContractorById as any).mockResolvedValue(null);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(apiResponse.notFound).toHaveBeenCalledWith(res, 'Contractor', '123');
      expect(neonContractorService.getContractorTeams).not.toHaveBeenCalled();
    });

    it('should return empty array when contractor has no teams', async () => {
      req.method = 'GET';

      const mockContractor = {
        id: '123',
        companyName: 'ABC Contractors'
      };

      (neonContractorService.getContractorById as any).mockResolvedValue(mockContractor);
      (neonContractorService.getContractorTeams as any).mockResolvedValue([]);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(apiResponse.success).toHaveBeenCalledWith(res, []);
    });

    it('should return validation error for invalid contractor ID', async () => {
      req.method = 'GET';
      req.query = { id: null };

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(apiResponse.validationError).toHaveBeenCalledWith(res, {
        contractorId: 'Invalid contractor ID'
      });
      expect(neonContractorService.getContractorById).not.toHaveBeenCalled();
    });

    it('should return validation error for array ID', async () => {
      req.method = 'GET';
      req.query = { id: ['123', '456'] };

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(apiResponse.validationError).toHaveBeenCalledWith(res, {
        contractorId: 'Invalid contractor ID'
      });
      expect(neonContractorService.getContractorById).not.toHaveBeenCalled();
    });

    it('should handle service errors', async () => {
      req.method = 'GET';

      const mockContractor = {
        id: '123',
        companyName: 'ABC Contractors'
      };

      const mockError = new Error('Database connection failed');
      (neonContractorService.getContractorById as any).mockResolvedValue(mockContractor);
      (neonContractorService.getContractorTeams as any).mockRejectedValue(mockError);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(apiResponse.internalError).toHaveBeenCalledWith(res, mockError);
    });
  });

  describe('POST /api/contractors/[id]/teams', () => {
    it('should create team with valid data', async () => {
      req.method = 'POST';
      req.body = {
        teamName: 'New Installation Team',
        teamType: 'installation',
        teamSize: 8,
        leadName: 'John Smith',
        leadEmail: 'john.smith@example.com',
        availability: 'available'
      };

      const mockContractor = {
        id: '123',
        companyName: 'ABC Contractors'
      };

      const mockCreatedTeam = {
        id: 'new-team-id',
        contractorId: '123',
        ...req.body,
        createdAt: new Date().toISOString()
      };

      (neonContractorService.getContractorById as any).mockResolvedValue(mockContractor);
      (neonContractorService.createTeam as any).mockResolvedValue(mockCreatedTeam);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(neonContractorService.getContractorById).toHaveBeenCalledWith('123');
      expect(neonContractorService.createTeam).toHaveBeenCalledWith('123', req.body);
      expect(apiResponse.created).toHaveBeenCalledWith(
        res,
        mockCreatedTeam,
        'Team created successfully'
      );
    });

    it('should return 404 when contractor not found', async () => {
      req.method = 'POST';
      req.body = {
        teamName: 'New Team',
        teamType: 'installation',
        teamSize: 5
      };

      (neonContractorService.getContractorById as any).mockResolvedValue(null);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(apiResponse.notFound).toHaveBeenCalledWith(res, 'Contractor', '123');
      expect(neonContractorService.createTeam).not.toHaveBeenCalled();
    });

    it('should validate required fields - missing teamName', async () => {
      req.method = 'POST';
      req.body = {
        teamType: 'installation',
        teamSize: 5
      };

      const mockContractor = {
        id: '123',
        companyName: 'ABC Contractors'
      };

      (neonContractorService.getContractorById as any).mockResolvedValue(mockContractor);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(apiResponse.validationError).toHaveBeenCalledWith(res, {
        required: 'Missing required fields: teamName, teamType, teamSize'
      });
      expect(neonContractorService.createTeam).not.toHaveBeenCalled();
    });

    it('should validate required fields - missing teamType', async () => {
      req.method = 'POST';
      req.body = {
        teamName: 'New Team',
        teamSize: 5
      };

      const mockContractor = {
        id: '123',
        companyName: 'ABC Contractors'
      };

      (neonContractorService.getContractorById as any).mockResolvedValue(mockContractor);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(apiResponse.validationError).toHaveBeenCalledWith(res, {
        required: 'Missing required fields: teamName, teamType, teamSize'
      });
      expect(neonContractorService.createTeam).not.toHaveBeenCalled();
    });

    it('should validate required fields - missing teamSize', async () => {
      req.method = 'POST';
      req.body = {
        teamName: 'New Team',
        teamType: 'installation'
      };

      const mockContractor = {
        id: '123',
        companyName: 'ABC Contractors'
      };

      (neonContractorService.getContractorById as any).mockResolvedValue(mockContractor);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(apiResponse.validationError).toHaveBeenCalledWith(res, {
        required: 'Missing required fields: teamName, teamType, teamSize'
      });
      expect(neonContractorService.createTeam).not.toHaveBeenCalled();
    });

    it('should validate team size - too small', async () => {
      req.method = 'POST';
      req.body = {
        teamName: 'New Team',
        teamType: 'installation',
        teamSize: 0
      };

      const mockContractor = {
        id: '123',
        companyName: 'ABC Contractors'
      };

      (neonContractorService.getContractorById as any).mockResolvedValue(mockContractor);

      await handler(req as NextApiRequest, res as NextApiResponse);

      // Note: teamSize: 0 is treated as falsy, so it triggers required fields error
      expect(apiResponse.validationError).toHaveBeenCalledWith(res, {
        required: 'Missing required fields: teamName, teamType, teamSize'
      });
      expect(neonContractorService.createTeam).not.toHaveBeenCalled();
    });

    it('should validate team size - too large', async () => {
      req.method = 'POST';
      req.body = {
        teamName: 'New Team',
        teamType: 'installation',
        teamSize: 101
      };

      const mockContractor = {
        id: '123',
        companyName: 'ABC Contractors'
      };

      (neonContractorService.getContractorById as any).mockResolvedValue(mockContractor);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(apiResponse.validationError).toHaveBeenCalledWith(res, {
        teamSize: 'Team size must be between 1 and 100'
      });
      expect(neonContractorService.createTeam).not.toHaveBeenCalled();
    });

    it('should validate team size - negative number', async () => {
      req.method = 'POST';
      req.body = {
        teamName: 'New Team',
        teamType: 'installation',
        teamSize: -5
      };

      const mockContractor = {
        id: '123',
        companyName: 'ABC Contractors'
      };

      (neonContractorService.getContractorById as any).mockResolvedValue(mockContractor);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(apiResponse.validationError).toHaveBeenCalledWith(res, {
        teamSize: 'Team size must be between 1 and 100'
      });
      expect(neonContractorService.createTeam).not.toHaveBeenCalled();
    });

    it('should allow valid team size at minimum', async () => {
      req.method = 'POST';
      req.body = {
        teamName: 'Solo Team',
        teamType: 'installation',
        teamSize: 1
      };

      const mockContractor = {
        id: '123',
        companyName: 'ABC Contractors'
      };

      const mockCreatedTeam = {
        id: 'new-team-id',
        contractorId: '123',
        ...req.body
      };

      (neonContractorService.getContractorById as any).mockResolvedValue(mockContractor);
      (neonContractorService.createTeam as any).mockResolvedValue(mockCreatedTeam);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(neonContractorService.createTeam).toHaveBeenCalledWith('123', req.body);
      expect(apiResponse.created).toHaveBeenCalled();
    });

    it('should allow valid team size at maximum', async () => {
      req.method = 'POST';
      req.body = {
        teamName: 'Large Team',
        teamType: 'installation',
        teamSize: 100
      };

      const mockContractor = {
        id: '123',
        companyName: 'ABC Contractors'
      };

      const mockCreatedTeam = {
        id: 'new-team-id',
        contractorId: '123',
        ...req.body
      };

      (neonContractorService.getContractorById as any).mockResolvedValue(mockContractor);
      (neonContractorService.createTeam as any).mockResolvedValue(mockCreatedTeam);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(neonContractorService.createTeam).toHaveBeenCalledWith('123', req.body);
      expect(apiResponse.created).toHaveBeenCalled();
    });

    it('should validate lead email format - invalid', async () => {
      req.method = 'POST';
      req.body = {
        teamName: 'New Team',
        teamType: 'installation',
        teamSize: 5,
        leadEmail: 'invalid-email'
      };

      const mockContractor = {
        id: '123',
        companyName: 'ABC Contractors'
      };

      (neonContractorService.getContractorById as any).mockResolvedValue(mockContractor);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(apiResponse.validationError).toHaveBeenCalledWith(res, {
        leadEmail: 'Invalid lead email format'
      });
      expect(neonContractorService.createTeam).not.toHaveBeenCalled();
    });

    it('should validate lead email format - missing @', async () => {
      req.method = 'POST';
      req.body = {
        teamName: 'New Team',
        teamType: 'installation',
        teamSize: 5,
        leadEmail: 'testexample.com'
      };

      const mockContractor = {
        id: '123',
        companyName: 'ABC Contractors'
      };

      (neonContractorService.getContractorById as any).mockResolvedValue(mockContractor);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(apiResponse.validationError).toHaveBeenCalledWith(res, {
        leadEmail: 'Invalid lead email format'
      });
      expect(neonContractorService.createTeam).not.toHaveBeenCalled();
    });

    it('should validate lead email format - missing domain', async () => {
      req.method = 'POST';
      req.body = {
        teamName: 'New Team',
        teamType: 'installation',
        teamSize: 5,
        leadEmail: 'test@'
      };

      const mockContractor = {
        id: '123',
        companyName: 'ABC Contractors'
      };

      (neonContractorService.getContractorById as any).mockResolvedValue(mockContractor);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(apiResponse.validationError).toHaveBeenCalledWith(res, {
        leadEmail: 'Invalid lead email format'
      });
      expect(neonContractorService.createTeam).not.toHaveBeenCalled();
    });

    it('should allow team creation without lead email', async () => {
      req.method = 'POST';
      req.body = {
        teamName: 'New Team',
        teamType: 'installation',
        teamSize: 5
      };

      const mockContractor = {
        id: '123',
        companyName: 'ABC Contractors'
      };

      const mockCreatedTeam = {
        id: 'new-team-id',
        contractorId: '123',
        ...req.body
      };

      (neonContractorService.getContractorById as any).mockResolvedValue(mockContractor);
      (neonContractorService.createTeam as any).mockResolvedValue(mockCreatedTeam);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(neonContractorService.createTeam).toHaveBeenCalledWith('123', req.body);
      expect(apiResponse.created).toHaveBeenCalled();
    });

    it('should handle duplicate team name error', async () => {
      req.method = 'POST';
      req.body = {
        teamName: 'Existing Team',
        teamType: 'installation',
        teamSize: 5
      };

      const mockContractor = {
        id: '123',
        companyName: 'ABC Contractors'
      };

      const duplicateError = new Error('duplicate key value violates unique constraint');
      (neonContractorService.getContractorById as any).mockResolvedValue(mockContractor);
      (neonContractorService.createTeam as any).mockRejectedValue(duplicateError);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(apiResponse.validationError).toHaveBeenCalledWith(res, {
        teamName: 'A team with this name already exists for this contractor'
      });
    });

    it('should handle service errors during creation', async () => {
      req.method = 'POST';
      req.body = {
        teamName: 'New Team',
        teamType: 'installation',
        teamSize: 5
      };

      const mockContractor = {
        id: '123',
        companyName: 'ABC Contractors'
      };

      const mockError = new Error('Database error');
      (neonContractorService.getContractorById as any).mockResolvedValue(mockContractor);
      (neonContractorService.createTeam as any).mockRejectedValue(mockError);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(apiResponse.internalError).toHaveBeenCalledWith(res, mockError);
    });
  });

  describe('Invalid method', () => {
    it('should return 405 for PUT method', async () => {
      req.method = 'PUT';

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(res.setHeader).toHaveBeenCalledWith('Allow', ['GET', 'POST']);
      expect(res.status).toHaveBeenCalledWith(405);
    });

    it('should return 405 for DELETE method', async () => {
      req.method = 'DELETE';

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(res.setHeader).toHaveBeenCalledWith('Allow', ['GET', 'POST']);
      expect(res.status).toHaveBeenCalledWith(405);
    });

    it('should return 405 for PATCH method', async () => {
      req.method = 'PATCH';

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(res.setHeader).toHaveBeenCalledWith('Allow', ['GET', 'POST']);
      expect(res.status).toHaveBeenCalledWith(405);
    });
  });
});

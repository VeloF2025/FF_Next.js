/**
 * Tests for Single Contractor API endpoints
 * Story 2.1: Add API Route Tests
 * Tests: GET, PUT, DELETE /api/contractors/[contractorId]
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';
import handler from './index';
import { neonContractorService } from '@/services/contractor/neonContractorService';
import { apiResponse } from '@/lib/apiResponse';

// Mock dependencies
vi.mock('@/services/contractor/neonContractorService');
vi.mock('@/lib/apiResponse');
vi.mock('@/lib/logger', () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), getLogs: vi.fn(() => []), clearLogs: vi.fn() },
  createLogger: vi.fn(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() })),
}));

describe('Contractor API - Individual Contractor Operations', () => {
  let req: Partial<NextApiRequest>;
  let res: Partial<NextApiResponse>;

  beforeEach(() => {
    vi.clearAllMocks();

    req = {
      query: {
        contractorId: '123'
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

  describe('GET /api/contractors/[contractorId]', () => {
    it('should return contractor when ID is valid', async () => {
      req.method = 'GET';

      const mockContractor = {
        id: '123',
        companyName: 'ABC Contractors',
        registrationNumber: 'REG123456',
        contactPerson: 'John Doe',
        email: 'john@abc.com',
        status: 'active'
      };

      (neonContractorService.getContractorById as any).mockResolvedValue(mockContractor);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(neonContractorService.getContractorById).toHaveBeenCalledWith('123');
      expect(apiResponse.success).toHaveBeenCalledWith(res, mockContractor);
    });

    it('should return 404 when contractor not found', async () => {
      req.method = 'GET';

      (neonContractorService.getContractorById as any).mockResolvedValue(null);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(apiResponse.notFound).toHaveBeenCalledWith(res, 'Contractor', '123');
    });

    it('should return validation error for invalid contractorId', async () => {
      req.method = 'GET';
      req.query = { contractorId: null };

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(apiResponse.validationError).toHaveBeenCalledWith(res, {
        contractorId: 'Invalid contractor ID'
      });
      expect(neonContractorService.getContractorById).not.toHaveBeenCalled();
    });

    it('should return validation error for array contractorId', async () => {
      req.method = 'GET';
      req.query = { contractorId: ['123', '456'] };

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(apiResponse.validationError).toHaveBeenCalledWith(res, {
        contractorId: 'Invalid contractor ID'
      });
      expect(neonContractorService.getContractorById).not.toHaveBeenCalled();
    });

    it('should handle service errors', async () => {
      req.method = 'GET';

      const mockError = new Error('Database connection failed');
      (neonContractorService.getContractorById as any).mockRejectedValue(mockError);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(apiResponse.internalError).toHaveBeenCalledWith(res, mockError);
    });
  });

  describe('PUT /api/contractors/[contractorId]', () => {
    it('should update contractor with valid data', async () => {
      req.method = 'PUT';
      req.body = {
        companyName: 'Updated Company Name',
        phone: '+1234567890',
        address: '456 New Street'
      };

      const mockExistingContractor = {
        id: '123',
        companyName: 'Old Name',
        status: 'active'
      };

      const mockUpdatedContractor = {
        ...mockExistingContractor,
        ...req.body
      };

      (neonContractorService.getContractorById as any).mockResolvedValue(mockExistingContractor);
      (neonContractorService.updateContractor as any).mockResolvedValue(mockUpdatedContractor);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(neonContractorService.getContractorById).toHaveBeenCalledWith('123');
      expect(neonContractorService.updateContractor).toHaveBeenCalledWith('123', req.body);
      expect(apiResponse.success).toHaveBeenCalledWith(
        res,
        mockUpdatedContractor,
        'Contractor updated successfully'
      );
    });

    it('should return 404 when contractor not found', async () => {
      req.method = 'PUT';
      req.body = { companyName: 'Updated Name' };

      (neonContractorService.getContractorById as any).mockResolvedValue(null);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(apiResponse.notFound).toHaveBeenCalledWith(res, 'Contractor', '123');
      expect(neonContractorService.updateContractor).not.toHaveBeenCalled();
    });

    it('should validate email format when email is updated', async () => {
      req.method = 'PUT';
      req.body = {
        email: 'invalid-email'
      };

      const mockExistingContractor = {
        id: '123',
        companyName: 'ABC Contractors'
      };

      (neonContractorService.getContractorById as any).mockResolvedValue(mockExistingContractor);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(apiResponse.validationError).toHaveBeenCalledWith(res, {
        email: 'Invalid email format'
      });
      expect(neonContractorService.updateContractor).not.toHaveBeenCalled();
    });

    it('should validate email format - missing @', async () => {
      req.method = 'PUT';
      req.body = {
        email: 'testexample.com'
      };

      const mockExistingContractor = {
        id: '123',
        companyName: 'ABC Contractors'
      };

      (neonContractorService.getContractorById as any).mockResolvedValue(mockExistingContractor);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(apiResponse.validationError).toHaveBeenCalledWith(res, {
        email: 'Invalid email format'
      });
      expect(neonContractorService.updateContractor).not.toHaveBeenCalled();
    });

    it('should validate email format - missing domain', async () => {
      req.method = 'PUT';
      req.body = {
        email: 'test@'
      };

      const mockExistingContractor = {
        id: '123',
        companyName: 'ABC Contractors'
      };

      (neonContractorService.getContractorById as any).mockResolvedValue(mockExistingContractor);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(apiResponse.validationError).toHaveBeenCalledWith(res, {
        email: 'Invalid email format'
      });
      expect(neonContractorService.updateContractor).not.toHaveBeenCalled();
    });

    it('should allow valid email update', async () => {
      req.method = 'PUT';
      req.body = {
        email: 'newemail@contractor.com'
      };

      const mockExistingContractor = {
        id: '123',
        companyName: 'ABC Contractors',
        email: 'old@contractor.com'
      };

      const mockUpdatedContractor = {
        ...mockExistingContractor,
        email: 'newemail@contractor.com'
      };

      (neonContractorService.getContractorById as any).mockResolvedValue(mockExistingContractor);
      (neonContractorService.updateContractor as any).mockResolvedValue(mockUpdatedContractor);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(neonContractorService.updateContractor).toHaveBeenCalledWith('123', req.body);
      expect(apiResponse.success).toHaveBeenCalledWith(
        res,
        mockUpdatedContractor,
        'Contractor updated successfully'
      );
    });

    it('should handle duplicate registration number error', async () => {
      req.method = 'PUT';
      req.body = {
        registrationNumber: 'EXISTING123'
      };

      const mockExistingContractor = {
        id: '123',
        companyName: 'ABC Contractors'
      };

      (neonContractorService.getContractorById as any).mockResolvedValue(mockExistingContractor);
      (neonContractorService.updateContractor as any).mockRejectedValue(
        new Error('duplicate key value violates unique constraint')
      );

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(apiResponse.validationError).toHaveBeenCalledWith(res, {
        registrationNumber: 'A contractor with this registration number already exists'
      });
    });

    it('should handle service errors during update', async () => {
      req.method = 'PUT';
      req.body = { companyName: 'Updated Name' };

      const mockExistingContractor = {
        id: '123',
        companyName: 'ABC Contractors'
      };

      const mockError = new Error('Database error');
      (neonContractorService.getContractorById as any).mockResolvedValue(mockExistingContractor);
      (neonContractorService.updateContractor as any).mockRejectedValue(mockError);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(apiResponse.internalError).toHaveBeenCalledWith(res, mockError);
    });

    it('should allow partial updates', async () => {
      req.method = 'PUT';
      req.body = {
        phone: '+9876543210'
      };

      const mockExistingContractor = {
        id: '123',
        companyName: 'ABC Contractors',
        phone: '+1234567890'
      };

      const mockUpdatedContractor = {
        ...mockExistingContractor,
        phone: '+9876543210'
      };

      (neonContractorService.getContractorById as any).mockResolvedValue(mockExistingContractor);
      (neonContractorService.updateContractor as any).mockResolvedValue(mockUpdatedContractor);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(neonContractorService.updateContractor).toHaveBeenCalledWith('123', req.body);
      expect(apiResponse.success).toHaveBeenCalled();
    });

    it('should allow updating multiple fields', async () => {
      req.method = 'PUT';
      req.body = {
        companyName: 'New Company Name',
        contactPerson: 'Jane Smith',
        email: 'jane@newcompany.com',
        phone: '+9876543210',
        address: '789 Business Ave'
      };

      const mockExistingContractor = {
        id: '123',
        companyName: 'Old Name',
        contactPerson: 'John Doe'
      };

      const mockUpdatedContractor = {
        ...mockExistingContractor,
        ...req.body
      };

      (neonContractorService.getContractorById as any).mockResolvedValue(mockExistingContractor);
      (neonContractorService.updateContractor as any).mockResolvedValue(mockUpdatedContractor);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(neonContractorService.updateContractor).toHaveBeenCalledWith('123', req.body);
      expect(apiResponse.success).toHaveBeenCalledWith(
        res,
        mockUpdatedContractor,
        'Contractor updated successfully'
      );
    });
  });

  describe('DELETE /api/contractors/[contractorId]', () => {
    it('should delete contractor when ID is valid', async () => {
      req.method = 'DELETE';

      const mockExistingContractor = {
        id: '123',
        companyName: 'ABC Contractors'
      };

      (neonContractorService.getContractorById as any).mockResolvedValue(mockExistingContractor);
      (neonContractorService.deleteContractor as any).mockResolvedValue(undefined);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(neonContractorService.getContractorById).toHaveBeenCalledWith('123');
      expect(neonContractorService.deleteContractor).toHaveBeenCalledWith('123');
      expect(apiResponse.success).toHaveBeenCalledWith(
        res,
        { id: '123' },
        'Contractor deleted successfully'
      );
    });

    it('should return 404 when contractor not found', async () => {
      req.method = 'DELETE';

      (neonContractorService.getContractorById as any).mockResolvedValue(null);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(apiResponse.notFound).toHaveBeenCalledWith(res, 'Contractor', '123');
      expect(neonContractorService.deleteContractor).not.toHaveBeenCalled();
    });

    it('should handle soft delete (default behavior)', async () => {
      req.method = 'DELETE';

      const mockExistingContractor = {
        id: '123',
        companyName: 'ABC Contractors',
        isActive: true
      };

      (neonContractorService.getContractorById as any).mockResolvedValue(mockExistingContractor);
      (neonContractorService.deleteContractor as any).mockResolvedValue(undefined);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(neonContractorService.deleteContractor).toHaveBeenCalledWith('123');
      expect(apiResponse.success).toHaveBeenCalled();
    });

    it('should handle hard delete query parameter', async () => {
      req.method = 'DELETE';
      req.query = {
        contractorId: '123',
        hard: 'true'
      };

      const mockExistingContractor = {
        id: '123',
        companyName: 'ABC Contractors'
      };

      (neonContractorService.getContractorById as any).mockResolvedValue(mockExistingContractor);
      (neonContractorService.deleteContractor as any).mockResolvedValue(undefined);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(neonContractorService.deleteContractor).toHaveBeenCalledWith('123');
      expect(apiResponse.success).toHaveBeenCalled();
    });

    it('should handle service errors during deletion', async () => {
      req.method = 'DELETE';

      const mockExistingContractor = {
        id: '123',
        companyName: 'ABC Contractors'
      };

      const mockError = new Error('Database error');
      (neonContractorService.getContractorById as any).mockResolvedValue(mockExistingContractor);
      (neonContractorService.deleteContractor as any).mockRejectedValue(mockError);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(apiResponse.internalError).toHaveBeenCalledWith(res, mockError);
    });
  });

  describe('Invalid method', () => {
    it('should return 405 for POST method', async () => {
      req.method = 'POST';

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(res.setHeader).toHaveBeenCalledWith('Allow', ['GET', 'PUT', 'DELETE']);
      expect(res.status).toHaveBeenCalledWith(405);
    });

    it('should return 405 for PATCH method', async () => {
      req.method = 'PATCH';

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(res.setHeader).toHaveBeenCalledWith('Allow', ['GET', 'PUT', 'DELETE']);
      expect(res.status).toHaveBeenCalledWith(405);
    });
  });

  describe('Invalid parameters', () => {
    it('should validate contractorId before GET', async () => {
      req.method = 'GET';
      req.query = { contractorId: '' };

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(apiResponse.validationError).toHaveBeenCalled();
    });

    it('should validate contractorId before PUT', async () => {
      req.method = 'PUT';
      req.query = { contractorId: undefined };

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(apiResponse.validationError).toHaveBeenCalled();
      expect(neonContractorService.getContractorById).not.toHaveBeenCalled();
    });

    it('should validate contractorId before DELETE', async () => {
      req.method = 'DELETE';
      req.query = {};

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(apiResponse.validationError).toHaveBeenCalled();
      expect(neonContractorService.getContractorById).not.toHaveBeenCalled();
    });
  });
});

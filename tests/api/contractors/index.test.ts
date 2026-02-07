/**
 * Tests for Contractors API endpoints
 * Story 2.1: Add API Route Tests
 * Tests: GET /api/contractors, POST /api/contractors
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
vi.mock('@neondatabase/serverless', () => ({
  neon: vi.fn(() => vi.fn().mockResolvedValue([]))
}));

describe('Contractors API - List and Create', () => {
  let req: Partial<NextApiRequest>;
  let res: Partial<NextApiResponse>;

  beforeEach(() => {
    vi.clearAllMocks();

    req = {
      query: {},
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
    (apiResponse.validationError as any) = vi.fn();
    (apiResponse.internalError as any) = vi.fn();
  });

  describe('GET /api/contractors', () => {
    it('should return all contractors when no filters provided', async () => {
      req.method = 'GET';

      const mockContractors = [
        { id: '1', companyName: 'Contractor A', status: 'active' },
        { id: '2', companyName: 'Contractor B', status: 'pending' }
      ];

      (neonContractorService.getContractors as any).mockResolvedValue(mockContractors);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(neonContractorService.getContractors).toHaveBeenCalledWith({});
      expect(apiResponse.success).toHaveBeenCalledWith(res, mockContractors);
    });

    it('should filter by status', async () => {
      req.method = 'GET';
      req.query = { status: 'active' };

      const mockContractors = [
        { id: '1', companyName: 'Contractor A', status: 'active' }
      ];

      (neonContractorService.getContractors as any).mockResolvedValue(mockContractors);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(neonContractorService.getContractors).toHaveBeenCalledWith({
        status: 'active'
      });
      expect(apiResponse.success).toHaveBeenCalledWith(res, mockContractors);
    });

    it('should filter by multiple statuses', async () => {
      req.method = 'GET';
      req.query = { status: ['active', 'approved'] };

      const mockContractors = [
        { id: '1', companyName: 'Contractor A', status: 'active' },
        { id: '2', companyName: 'Contractor B', status: 'approved' }
      ];

      (neonContractorService.getContractors as any).mockResolvedValue(mockContractors);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(neonContractorService.getContractors).toHaveBeenCalledWith({
        status: ['active', 'approved']
      });
      expect(apiResponse.success).toHaveBeenCalledWith(res, mockContractors);
    });

    it('should filter by complianceStatus', async () => {
      req.method = 'GET';
      req.query = { complianceStatus: 'compliant' };

      const mockContractors = [
        { id: '1', companyName: 'Contractor A', complianceStatus: 'compliant' }
      ];

      (neonContractorService.getContractors as any).mockResolvedValue(mockContractors);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(neonContractorService.getContractors).toHaveBeenCalledWith({
        complianceStatus: 'compliant'
      });
      expect(apiResponse.success).toHaveBeenCalledWith(res, mockContractors);
    });

    it('should filter by RAG score', async () => {
      req.method = 'GET';
      req.query = { ragOverall: 'green' };

      const mockContractors = [
        { id: '1', companyName: 'Contractor A', ragOverall: 'green' }
      ];

      (neonContractorService.getContractors as any).mockResolvedValue(mockContractors);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(neonContractorService.getContractors).toHaveBeenCalledWith({
        ragOverall: 'green'
      });
      expect(apiResponse.success).toHaveBeenCalledWith(res, mockContractors);
    });

    it('should filter by isActive=true', async () => {
      req.method = 'GET';
      req.query = { isActive: 'true' };

      const mockContractors = [
        { id: '1', companyName: 'Contractor A', isActive: true }
      ];

      (neonContractorService.getContractors as any).mockResolvedValue(mockContractors);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(neonContractorService.getContractors).toHaveBeenCalledWith({
        isActive: true
      });
      expect(apiResponse.success).toHaveBeenCalledWith(res, mockContractors);
    });

    it('should filter by isActive=false', async () => {
      req.method = 'GET';
      req.query = { isActive: 'false' };

      const mockContractors = [
        { id: '1', companyName: 'Contractor A', isActive: false }
      ];

      (neonContractorService.getContractors as any).mockResolvedValue(mockContractors);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(neonContractorService.getContractors).toHaveBeenCalledWith({
        isActive: false
      });
      expect(apiResponse.success).toHaveBeenCalledWith(res, mockContractors);
    });

    it('should filter by search term', async () => {
      req.method = 'GET';
      req.query = { search: 'Builder' };

      const mockContractors = [
        { id: '1', companyName: 'ABC Builders', search: 'Builder' }
      ];

      (neonContractorService.getContractors as any).mockResolvedValue(mockContractors);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(neonContractorService.getContractors).toHaveBeenCalledWith({
        search: 'Builder'
      });
      expect(apiResponse.success).toHaveBeenCalledWith(res, mockContractors);
    });

    it('should apply multiple filters', async () => {
      req.method = 'GET';
      req.query = {
        status: 'active',
        complianceStatus: 'compliant',
        ragOverall: 'green',
        isActive: 'true',
        search: 'ABC'
      };

      const mockContractors = [
        { id: '1', companyName: 'ABC Contractors', status: 'active' }
      ];

      (neonContractorService.getContractors as any).mockResolvedValue(mockContractors);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(neonContractorService.getContractors).toHaveBeenCalledWith({
        status: 'active',
        complianceStatus: 'compliant',
        ragOverall: 'green',
        isActive: true,
        search: 'ABC'
      });
      expect(apiResponse.success).toHaveBeenCalledWith(res, mockContractors);
    });

    it('should handle service errors', async () => {
      req.method = 'GET';

      const mockError = new Error('Database connection failed');
      (neonContractorService.getContractors as any).mockRejectedValue(mockError);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(apiResponse.internalError).toHaveBeenCalledWith(res, mockError);
    });

    it('should return empty array when no contractors found', async () => {
      req.method = 'GET';
      req.query = { status: 'archived' };

      (neonContractorService.getContractors as any).mockResolvedValue([]);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(apiResponse.success).toHaveBeenCalledWith(res, []);
    });
  });

  describe('POST /api/contractors', () => {
    it('should create contractor with valid data', async () => {
      req.method = 'POST';
      req.body = {
        companyName: 'New Contractor LLC',
        registrationNumber: 'REG123456',
        contactPerson: 'John Doe',
        email: 'john@contractor.com',
        phone: '+1234567890',
        address: '123 Main St'
      };

      const mockCreatedContractor = {
        id: 'new-id',
        ...req.body,
        status: 'pending',
        createdAt: new Date().toISOString()
      };

      (neonContractorService.createContractor as any).mockResolvedValue(mockCreatedContractor);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(neonContractorService.createContractor).toHaveBeenCalledWith(req.body);
      expect(apiResponse.created).toHaveBeenCalledWith(
        res,
        mockCreatedContractor,
        'Contractor created successfully'
      );
    });

    it('should validate required fields - missing companyName', async () => {
      req.method = 'POST';
      req.body = {
        registrationNumber: 'REG123456',
        contactPerson: 'John Doe',
        email: 'john@contractor.com'
      };

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(apiResponse.validationError).toHaveBeenCalledWith(res, {
        required: 'Missing required fields: companyName, registrationNumber, contactPerson, email'
      });
      expect(neonContractorService.createContractor).not.toHaveBeenCalled();
    });

    it('should validate required fields - missing registrationNumber', async () => {
      req.method = 'POST';
      req.body = {
        companyName: 'New Contractor LLC',
        contactPerson: 'John Doe',
        email: 'john@contractor.com'
      };

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(apiResponse.validationError).toHaveBeenCalledWith(res, {
        required: 'Missing required fields: companyName, registrationNumber, contactPerson, email'
      });
      expect(neonContractorService.createContractor).not.toHaveBeenCalled();
    });

    it('should validate required fields - missing contactPerson', async () => {
      req.method = 'POST';
      req.body = {
        companyName: 'New Contractor LLC',
        registrationNumber: 'REG123456',
        email: 'john@contractor.com'
      };

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(apiResponse.validationError).toHaveBeenCalledWith(res, {
        required: 'Missing required fields: companyName, registrationNumber, contactPerson, email'
      });
      expect(neonContractorService.createContractor).not.toHaveBeenCalled();
    });

    it('should validate required fields - missing email', async () => {
      req.method = 'POST';
      req.body = {
        companyName: 'New Contractor LLC',
        registrationNumber: 'REG123456',
        contactPerson: 'John Doe'
      };

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(apiResponse.validationError).toHaveBeenCalledWith(res, {
        required: 'Missing required fields: companyName, registrationNumber, contactPerson, email'
      });
      expect(neonContractorService.createContractor).not.toHaveBeenCalled();
    });

    it('should validate email format - invalid email', async () => {
      req.method = 'POST';
      req.body = {
        companyName: 'New Contractor LLC',
        registrationNumber: 'REG123456',
        contactPerson: 'John Doe',
        email: 'invalid-email'
      };

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(apiResponse.validationError).toHaveBeenCalledWith(res, {
        email: 'Invalid email format'
      });
      expect(neonContractorService.createContractor).not.toHaveBeenCalled();
    });

    it('should validate email format - missing @', async () => {
      req.method = 'POST';
      req.body = {
        companyName: 'New Contractor LLC',
        registrationNumber: 'REG123456',
        contactPerson: 'John Doe',
        email: 'johndoe.com'
      };

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(apiResponse.validationError).toHaveBeenCalledWith(res, {
        email: 'Invalid email format'
      });
      expect(neonContractorService.createContractor).not.toHaveBeenCalled();
    });

    it('should validate email format - missing domain', async () => {
      req.method = 'POST';
      req.body = {
        companyName: 'New Contractor LLC',
        registrationNumber: 'REG123456',
        contactPerson: 'John Doe',
        email: 'john@'
      };

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(apiResponse.validationError).toHaveBeenCalledWith(res, {
        email: 'Invalid email format'
      });
      expect(neonContractorService.createContractor).not.toHaveBeenCalled();
    });

    it('should handle duplicate registration number', async () => {
      req.method = 'POST';
      req.body = {
        companyName: 'New Contractor LLC',
        registrationNumber: 'REG123456',
        contactPerson: 'John Doe',
        email: 'john@contractor.com'
      };

      const duplicateError = new Error('duplicate key value violates unique constraint');
      (neonContractorService.createContractor as any).mockRejectedValue(duplicateError);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(apiResponse.validationError).toHaveBeenCalledWith(res, {
        registrationNumber: 'A contractor with this registration number already exists'
      });
    });

    it('should handle service errors during creation', async () => {
      req.method = 'POST';
      req.body = {
        companyName: 'New Contractor LLC',
        registrationNumber: 'REG123456',
        contactPerson: 'John Doe',
        email: 'john@contractor.com'
      };

      const mockError = new Error('Database error');
      (neonContractorService.createContractor as any).mockRejectedValue(mockError);

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

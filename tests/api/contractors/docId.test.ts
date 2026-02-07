/**
 * Tests for Document CRUD API endpoints
 * Story 1.2: Implement Document CRUD Endpoints
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';
import handler from './[docId]';
import { neonContractorService } from '@/services/contractor/neonContractorService';
import { apiResponse } from '@/lib/apiResponse';

// Mock dependencies
vi.mock('@/services/contractor/neonContractorService');
vi.mock('@/lib/apiResponse');
vi.mock('@/lib/logger', () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), getLogs: vi.fn(() => []), clearLogs: vi.fn() },
  createLogger: vi.fn(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() })),
}));

describe('Document API - Individual Document Operations', () => {
  let req: Partial<NextApiRequest>;
  let res: Partial<NextApiResponse>;

  beforeEach(() => {
    vi.clearAllMocks();

    req = {
      query: {
        contractorId: '123',
        docId: '456'
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

  describe('GET /api/contractors/[contractorId]/documents/[docId]', () => {
    it('should return document when valid IDs provided', async () => {
      req.method = 'GET';

      const mockContractor = { id: '123', companyName: 'Test Contractor' };
      const mockDocument = {
        id: '456',
        contractorId: '123',
        documentName: 'Tax Certificate',
        documentType: 'tax_certificate',
        fileName: 'tax_cert.pdf'
      };

      (neonContractorService.getContractorById as any).mockResolvedValue(mockContractor);
      (neonContractorService.getContractorDocuments as any).mockResolvedValue([mockDocument]);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(neonContractorService.getContractorById).toHaveBeenCalledWith('123');
      expect(neonContractorService.getContractorDocuments).toHaveBeenCalledWith('123');
      expect(apiResponse.success).toHaveBeenCalledWith(res, mockDocument);
    });

    it('should return 404 when contractor not found', async () => {
      req.method = 'GET';

      (neonContractorService.getContractorById as any).mockResolvedValue(null);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(apiResponse.notFound).toHaveBeenCalledWith(res, 'Contractor', '123');
    });

    it('should return 404 when document not found', async () => {
      req.method = 'GET';

      const mockContractor = { id: '123', companyName: 'Test Contractor' };
      (neonContractorService.getContractorById as any).mockResolvedValue(mockContractor);
      (neonContractorService.getContractorDocuments as any).mockResolvedValue([]);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(apiResponse.notFound).toHaveBeenCalledWith(res, 'Document', '456');
    });

    it('should return validation error when document belongs to different contractor', async () => {
      req.method = 'GET';

      const mockContractor = { id: '123', companyName: 'Test Contractor' };
      const mockDocument = {
        id: '456',
        contractorId: '999', // Different contractor
        documentName: 'Tax Certificate'
      };

      (neonContractorService.getContractorById as any).mockResolvedValue(mockContractor);
      (neonContractorService.getContractorDocuments as any).mockResolvedValue([mockDocument]);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(apiResponse.validationError).toHaveBeenCalledWith(res, {
        docId: 'Document does not belong to this contractor'
      });
    });
  });

  describe('PUT /api/contractors/[contractorId]/documents/[docId]', () => {
    it('should update document with valid data', async () => {
      req.method = 'PUT';
      req.body = {
        documentName: 'Updated Tax Certificate',
        documentNumber: 'TAX-2024-001',
        notes: 'Renewed for 2024'
      };

      const mockContractor = { id: '123', companyName: 'Test Contractor' };
      const mockExistingDocument = {
        id: '456',
        contractorId: '123',
        documentName: 'Old Name',
        documentType: 'tax_certificate'
      };
      const mockUpdatedDocument = {
        ...mockExistingDocument,
        ...req.body
      };

      (neonContractorService.getContractorById as any).mockResolvedValue(mockContractor);
      (neonContractorService.getContractorDocuments as any).mockResolvedValue([mockExistingDocument]);
      (neonContractorService.updateDocument as any).mockResolvedValue(mockUpdatedDocument);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(neonContractorService.updateDocument).toHaveBeenCalledWith('456', {
        documentName: 'Updated Tax Certificate',
        documentNumber: 'TAX-2024-001',
        documentType: undefined,
        issueDate: undefined,
        expiryDate: undefined,
        notes: 'Renewed for 2024'
      });
      expect(apiResponse.success).toHaveBeenCalledWith(res, mockUpdatedDocument, 'Document updated successfully');
    });

    it('should validate document type', async () => {
      req.method = 'PUT';
      req.body = {
        documentType: 'invalid_type'
      };

      const mockContractor = { id: '123', companyName: 'Test Contractor' };
      const mockExistingDocument = { id: '456', contractorId: '123', documentName: 'Doc A' };

      (neonContractorService.getContractorById as any).mockResolvedValue(mockContractor);
      (neonContractorService.getContractorDocuments as any).mockResolvedValue([mockExistingDocument]);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(apiResponse.validationError).toHaveBeenCalled();
      const call = (apiResponse.validationError as any).mock.calls[0];
      expect(call[1].documentType).toContain('Invalid document type');
    });

    it('should validate expiry date format', async () => {
      req.method = 'PUT';
      req.body = {
        expiryDate: 'invalid-date'
      };

      const mockContractor = { id: '123', companyName: 'Test Contractor' };
      const mockExistingDocument = { id: '456', contractorId: '123', documentName: 'Doc A' };

      (neonContractorService.getContractorById as any).mockResolvedValue(mockContractor);
      (neonContractorService.getContractorDocuments as any).mockResolvedValue([mockExistingDocument]);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(apiResponse.validationError).toHaveBeenCalledWith(res, {
        expiryDate: 'Invalid expiry date format'
      });
    });

    it('should validate issue date format', async () => {
      req.method = 'PUT';
      req.body = {
        issueDate: 'not-a-date'
      };

      const mockContractor = { id: '123', companyName: 'Test Contractor' };
      const mockExistingDocument = { id: '456', contractorId: '123', documentName: 'Doc A' };

      (neonContractorService.getContractorById as any).mockResolvedValue(mockContractor);
      (neonContractorService.getContractorDocuments as any).mockResolvedValue([mockExistingDocument]);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(apiResponse.validationError).toHaveBeenCalledWith(res, {
        issueDate: 'Invalid issue date format'
      });
    });

    it('should prevent changing file path (security)', async () => {
      req.method = 'PUT';
      req.body = {
        filePath: '/malicious/path/hacked.pdf'
      };

      const mockContractor = { id: '123', companyName: 'Test Contractor' };
      const mockExistingDocument = { id: '456', contractorId: '123', documentName: 'Doc A' };

      (neonContractorService.getContractorById as any).mockResolvedValue(mockContractor);
      (neonContractorService.getContractorDocuments as any).mockResolvedValue([mockExistingDocument]);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(apiResponse.validationError).toHaveBeenCalledWith(res, {
        filePath: 'File path cannot be changed after upload'
      });
      expect(neonContractorService.updateDocument).not.toHaveBeenCalled();
    });

    it('should accept valid dates', async () => {
      req.method = 'PUT';
      req.body = {
        issueDate: '2024-01-01',
        expiryDate: '2025-12-31'
      };

      const mockContractor = { id: '123', companyName: 'Test Contractor' };
      const mockExistingDocument = { id: '456', contractorId: '123', documentName: 'Doc A' };
      const mockUpdatedDocument = { ...mockExistingDocument, ...req.body };

      (neonContractorService.getContractorById as any).mockResolvedValue(mockContractor);
      (neonContractorService.getContractorDocuments as any).mockResolvedValue([mockExistingDocument]);
      (neonContractorService.updateDocument as any).mockResolvedValue(mockUpdatedDocument);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(neonContractorService.updateDocument).toHaveBeenCalled();
      const updateCall = (neonContractorService.updateDocument as any).mock.calls[0];
      expect(updateCall[1].issueDate).toBeInstanceOf(Date);
      expect(updateCall[1].expiryDate).toBeInstanceOf(Date);
    });
  });

  describe('DELETE /api/contractors/[contractorId]/documents/[docId]', () => {
    it('should delete document when valid', async () => {
      req.method = 'DELETE';

      const mockContractor = { id: '123', companyName: 'Test Contractor' };
      const mockExistingDocument = {
        id: '456',
        contractorId: '123',
        documentName: 'Document to Delete'
      };

      (neonContractorService.getContractorById as any).mockResolvedValue(mockContractor);
      (neonContractorService.getContractorDocuments as any).mockResolvedValue([mockExistingDocument]);
      (neonContractorService.deleteDocument as any).mockResolvedValue(undefined);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(neonContractorService.deleteDocument).toHaveBeenCalledWith('456');
      expect(apiResponse.success).toHaveBeenCalledWith(
        res,
        { id: '456' },
        'Document deleted successfully'
      );
    });

    it('should return 404 when document not found', async () => {
      req.method = 'DELETE';

      const mockContractor = { id: '123', companyName: 'Test Contractor' };
      (neonContractorService.getContractorById as any).mockResolvedValue(mockContractor);
      (neonContractorService.getContractorDocuments as any).mockResolvedValue([]);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(apiResponse.notFound).toHaveBeenCalledWith(res, 'Document', '456');
      expect(neonContractorService.deleteDocument).not.toHaveBeenCalled();
    });
  });

  describe('PATCH /api/contractors/[contractorId]/documents/[docId] - Verify', () => {
    it('should verify document with valid data', async () => {
      req.method = 'PATCH';
      req.body = {
        action: 'verify',
        verifiedBy: 'admin@company.com',
        verificationNotes: 'Document verified and approved'
      };

      const mockContractor = { id: '123', companyName: 'Test Contractor' };
      const mockExistingDocument = {
        id: '456',
        contractorId: '123',
        documentName: 'Tax Certificate',
        status: 'pending'
      };
      const mockVerifiedDocument = {
        ...mockExistingDocument,
        isVerified: true,
        verifiedBy: 'admin@company.com',
        status: 'approved'
      };

      (neonContractorService.getContractorById as any).mockResolvedValue(mockContractor);
      (neonContractorService.getContractorDocuments as any).mockResolvedValue([mockExistingDocument]);
      (neonContractorService.verifyDocument as any).mockResolvedValue(mockVerifiedDocument);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(neonContractorService.verifyDocument).toHaveBeenCalledWith(
        '456',
        'admin@company.com',
        'Document verified and approved'
      );
      expect(apiResponse.success).toHaveBeenCalledWith(
        res,
        mockVerifiedDocument,
        'Document verified successfully'
      );
    });

    it('should require verifiedBy for verification', async () => {
      req.method = 'PATCH';
      req.body = {
        action: 'verify'
        // Missing verifiedBy
      };

      const mockContractor = { id: '123', companyName: 'Test Contractor' };
      const mockExistingDocument = { id: '456', contractorId: '123', documentName: 'Doc A' };

      (neonContractorService.getContractorById as any).mockResolvedValue(mockContractor);
      (neonContractorService.getContractorDocuments as any).mockResolvedValue([mockExistingDocument]);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(apiResponse.validationError).toHaveBeenCalledWith(res, {
        verifiedBy: 'verifiedBy is required for verification'
      });
    });
  });

  describe('PATCH /api/contractors/[contractorId]/documents/[docId] - Status', () => {
    it('should update document status with update_status action', async () => {
      req.method = 'PATCH';
      req.body = {
        action: 'update_status',
        status: 'approved'
      };

      const mockContractor = { id: '123', companyName: 'Test Contractor' };
      const mockExistingDocument = {
        id: '456',
        contractorId: '123',
        documentName: 'Tax Certificate',
        status: 'pending'
      };
      const mockUpdatedDocument = {
        ...mockExistingDocument,
        status: 'approved'
      };

      (neonContractorService.getContractorById as any).mockResolvedValue(mockContractor);
      (neonContractorService.getContractorDocuments as any).mockResolvedValue([mockExistingDocument]);
      (neonContractorService.updateDocumentStatus as any).mockResolvedValue(mockUpdatedDocument);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(neonContractorService.updateDocumentStatus).toHaveBeenCalledWith('456', 'approved', undefined);
      expect(apiResponse.success).toHaveBeenCalledWith(
        res,
        mockUpdatedDocument,
        'Document status updated successfully'
      );
    });

    it('should update document status with just status field', async () => {
      req.method = 'PATCH';
      req.body = {
        status: 'expired'
      };

      const mockContractor = { id: '123', companyName: 'Test Contractor' };
      const mockExistingDocument = { id: '456', contractorId: '123', documentName: 'Doc A' };
      const mockUpdatedDocument = { ...mockExistingDocument, status: 'expired' };

      (neonContractorService.getContractorById as any).mockResolvedValue(mockContractor);
      (neonContractorService.getContractorDocuments as any).mockResolvedValue([mockExistingDocument]);
      (neonContractorService.updateDocumentStatus as any).mockResolvedValue(mockUpdatedDocument);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(neonContractorService.updateDocumentStatus).toHaveBeenCalledWith('456', 'expired', undefined);
    });

    it('should validate status value', async () => {
      req.method = 'PATCH';
      req.body = {
        status: 'invalid_status'
      };

      const mockContractor = { id: '123', companyName: 'Test Contractor' };
      const mockExistingDocument = { id: '456', contractorId: '123', documentName: 'Doc A' };

      (neonContractorService.getContractorById as any).mockResolvedValue(mockContractor);
      (neonContractorService.getContractorDocuments as any).mockResolvedValue([mockExistingDocument]);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(apiResponse.validationError).toHaveBeenCalled();
      const call = (apiResponse.validationError as any).mock.calls[0];
      expect(call[1].status).toContain('Invalid status');
    });

    it('should require rejection reason when status is rejected', async () => {
      req.method = 'PATCH';
      req.body = {
        status: 'rejected'
        // Missing rejectionReason
      };

      const mockContractor = { id: '123', companyName: 'Test Contractor' };
      const mockExistingDocument = { id: '456', contractorId: '123', documentName: 'Doc A' };

      (neonContractorService.getContractorById as any).mockResolvedValue(mockContractor);
      (neonContractorService.getContractorDocuments as any).mockResolvedValue([mockExistingDocument]);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(apiResponse.validationError).toHaveBeenCalledWith(res, {
        rejectionReason: 'Rejection reason is required when rejecting a document'
      });
    });

    it('should accept rejection with reason', async () => {
      req.method = 'PATCH';
      req.body = {
        status: 'rejected',
        rejectionReason: 'Document expired'
      };

      const mockContractor = { id: '123', companyName: 'Test Contractor' };
      const mockExistingDocument = { id: '456', contractorId: '123', documentName: 'Doc A' };
      const mockUpdatedDocument = { ...mockExistingDocument, status: 'rejected' };

      (neonContractorService.getContractorById as any).mockResolvedValue(mockContractor);
      (neonContractorService.getContractorDocuments as any).mockResolvedValue([mockExistingDocument]);
      (neonContractorService.updateDocumentStatus as any).mockResolvedValue(mockUpdatedDocument);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(neonContractorService.updateDocumentStatus).toHaveBeenCalledWith('456', 'rejected', 'Document expired');
    });

    it('should return validation error when no valid action provided', async () => {
      req.method = 'PATCH';
      req.body = {}; // No action or status

      const mockContractor = { id: '123', companyName: 'Test Contractor' };
      const mockExistingDocument = { id: '456', contractorId: '123', documentName: 'Doc A' };

      (neonContractorService.getContractorById as any).mockResolvedValue(mockContractor);
      (neonContractorService.getContractorDocuments as any).mockResolvedValue([mockExistingDocument]);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(apiResponse.validationError).toHaveBeenCalledWith(res, {
        action: 'No valid action provided. Supported actions: "verify", "update_status", or provide "status" field'
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
        docId: '456'
      };

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(apiResponse.validationError).toHaveBeenCalledWith(res, {
        contractorId: 'Invalid contractor ID'
      });
    });

    it('should return validation error for invalid docId', async () => {
      req.method = 'GET';
      req.query = {
        contractorId: '123',
        docId: null
      };

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(apiResponse.validationError).toHaveBeenCalledWith(res, {
        docId: 'Invalid document ID'
      });
    });
  });
});

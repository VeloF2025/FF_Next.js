/**
 * Tests for Contractor Documents API endpoints
 * Story 2.1: Add API Route Tests
 * Tests: GET, POST /api/contractors/[id]/documents
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';
import handler from '../../../pages/api/contractors-documents';
import { neonContractorService } from '@/services/contractor/neonContractorService';
import { apiResponse } from '@/lib/apiResponse';

// Mock dependencies
vi.mock('@/services/contractor/neonContractorService');
vi.mock('@/lib/apiResponse');
vi.mock('@/lib/logger', () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), getLogs: vi.fn(() => []), clearLogs: vi.fn() },
  createLogger: vi.fn(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() })),
}));

describe('Contractor Documents API - List and Create', () => {
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

  describe('GET /api/contractors/[id]/documents', () => {
    it('should return all documents for a contractor', async () => {
      req.method = 'GET';

      const mockContractor = {
        id: '123',
        companyName: 'ABC Contractors'
      };

      const mockDocuments = [
        {
          id: 'doc1',
          contractorId: '123',
          documentType: 'id_document',
          documentName: 'Company Registration',
          fileName: 'reg.pdf',
          filePath: '/uploads/reg.pdf',
          uploadedAt: new Date().toISOString()
        },
        {
          id: 'doc2',
          contractorId: '123',
          documentType: 'tax_certificate',
          documentName: 'Tax Certificate',
          fileName: 'tax.pdf',
          filePath: '/uploads/tax.pdf',
          uploadedAt: new Date().toISOString()
        }
      ];

      (neonContractorService.getContractorById as any).mockResolvedValue(mockContractor);
      (neonContractorService.getContractorDocuments as any).mockResolvedValue(mockDocuments);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(neonContractorService.getContractorById).toHaveBeenCalledWith('123');
      expect(neonContractorService.getContractorDocuments).toHaveBeenCalledWith('123');
      expect(apiResponse.success).toHaveBeenCalledWith(res, mockDocuments);
    });

    it('should return 404 when contractor not found', async () => {
      req.method = 'GET';

      (neonContractorService.getContractorById as any).mockResolvedValue(null);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(apiResponse.notFound).toHaveBeenCalledWith(res, 'Contractor', '123');
      expect(neonContractorService.getContractorDocuments).not.toHaveBeenCalled();
    });

    it('should return empty array when contractor has no documents', async () => {
      req.method = 'GET';

      const mockContractor = {
        id: '123',
        companyName: 'ABC Contractors'
      };

      (neonContractorService.getContractorById as any).mockResolvedValue(mockContractor);
      (neonContractorService.getContractorDocuments as any).mockResolvedValue([]);

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
      (neonContractorService.getContractorDocuments as any).mockRejectedValue(mockError);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(apiResponse.internalError).toHaveBeenCalledWith(res, mockError);
    });
  });

  describe('POST /api/contractors/[id]/documents', () => {
    it('should add document with valid data', async () => {
      req.method = 'POST';
      req.body = {
        documentType: 'tax_certificate',
        documentName: 'Tax Clearance Certificate',
        fileName: 'tax_cert_2024.pdf',
        filePath: '/uploads/contractors/123/tax_cert_2024.pdf',
        fileUrl: 'https://storage.example.com/tax_cert_2024.pdf',
        expiryDate: '2025-12-31',
        notes: 'Annual tax certificate'
      };

      const mockContractor = {
        id: '123',
        companyName: 'ABC Contractors'
      };

      const mockCreatedDocument = {
        id: 'new-doc-id',
        contractorId: '123',
        ...req.body,
        uploadedAt: new Date().toISOString()
      };

      (neonContractorService.getContractorById as any).mockResolvedValue(mockContractor);
      (neonContractorService.addDocument as any).mockResolvedValue(mockCreatedDocument);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(neonContractorService.getContractorById).toHaveBeenCalledWith('123');
      expect(neonContractorService.addDocument).toHaveBeenCalledWith('123', expect.objectContaining({
        documentType: 'tax_certificate',
        documentName: 'Tax Clearance Certificate',
        fileName: 'tax_cert_2024.pdf',
        filePath: '/uploads/contractors/123/tax_cert_2024.pdf'
      }));
      expect(apiResponse.created).toHaveBeenCalledWith(
        res,
        mockCreatedDocument,
        'Document added successfully'
      );
    });

    it('should return 404 when contractor not found', async () => {
      req.method = 'POST';
      req.body = {
        documentType: 'tax_certificate',
        documentName: 'Tax Cert',
        fileName: 'tax.pdf',
        filePath: '/uploads/tax.pdf'
      };

      (neonContractorService.getContractorById as any).mockResolvedValue(null);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(apiResponse.notFound).toHaveBeenCalledWith(res, 'Contractor', '123');
      expect(neonContractorService.addDocument).not.toHaveBeenCalled();
    });

    it('should validate required fields - missing documentType', async () => {
      req.method = 'POST';
      req.body = {
        documentName: 'Tax Cert',
        fileName: 'tax.pdf',
        filePath: '/uploads/tax.pdf'
      };

      const mockContractor = {
        id: '123',
        companyName: 'ABC Contractors'
      };

      (neonContractorService.getContractorById as any).mockResolvedValue(mockContractor);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(apiResponse.validationError).toHaveBeenCalledWith(res, {
        required: 'Missing required fields: documentType, documentName, fileName, filePath'
      });
      expect(neonContractorService.addDocument).not.toHaveBeenCalled();
    });

    it('should validate required fields - missing documentName', async () => {
      req.method = 'POST';
      req.body = {
        documentType: 'tax_certificate',
        fileName: 'tax.pdf',
        filePath: '/uploads/tax.pdf'
      };

      const mockContractor = {
        id: '123',
        companyName: 'ABC Contractors'
      };

      (neonContractorService.getContractorById as any).mockResolvedValue(mockContractor);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(apiResponse.validationError).toHaveBeenCalledWith(res, {
        required: 'Missing required fields: documentType, documentName, fileName, filePath'
      });
      expect(neonContractorService.addDocument).not.toHaveBeenCalled();
    });

    it('should validate required fields - missing fileName', async () => {
      req.method = 'POST';
      req.body = {
        documentType: 'tax_certificate',
        documentName: 'Tax Cert',
        filePath: '/uploads/tax.pdf'
      };

      const mockContractor = {
        id: '123',
        companyName: 'ABC Contractors'
      };

      (neonContractorService.getContractorById as any).mockResolvedValue(mockContractor);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(apiResponse.validationError).toHaveBeenCalledWith(res, {
        required: 'Missing required fields: documentType, documentName, fileName, filePath'
      });
      expect(neonContractorService.addDocument).not.toHaveBeenCalled();
    });

    it('should validate required fields - missing filePath', async () => {
      req.method = 'POST';
      req.body = {
        documentType: 'tax_certificate',
        documentName: 'Tax Cert',
        fileName: 'tax.pdf'
      };

      const mockContractor = {
        id: '123',
        companyName: 'ABC Contractors'
      };

      (neonContractorService.getContractorById as any).mockResolvedValue(mockContractor);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(apiResponse.validationError).toHaveBeenCalledWith(res, {
        required: 'Missing required fields: documentType, documentName, fileName, filePath'
      });
      expect(neonContractorService.addDocument).not.toHaveBeenCalled();
    });

    it('should validate document type - invalid type', async () => {
      req.method = 'POST';
      req.body = {
        documentType: 'invalid_type',
        documentName: 'Some Document',
        fileName: 'doc.pdf',
        filePath: '/uploads/doc.pdf'
      };

      const mockContractor = {
        id: '123',
        companyName: 'ABC Contractors'
      };

      (neonContractorService.getContractorById as any).mockResolvedValue(mockContractor);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(apiResponse.validationError).toHaveBeenCalled();
      const call = (apiResponse.validationError as any).mock.calls[0];
      expect(call[1].documentType).toContain('Invalid document type');
      expect(neonContractorService.addDocument).not.toHaveBeenCalled();
    });

    it('should accept valid document type - id_document', async () => {
      req.method = 'POST';
      req.body = {
        documentType: 'id_document',
        documentName: 'ID Document',
        fileName: 'id.pdf',
        filePath: '/uploads/id.pdf'
      };

      const mockContractor = {
        id: '123',
        companyName: 'ABC Contractors'
      };

      const mockCreatedDocument = {
        id: 'new-doc-id',
        contractorId: '123',
        ...req.body
      };

      (neonContractorService.getContractorById as any).mockResolvedValue(mockContractor);
      (neonContractorService.addDocument as any).mockResolvedValue(mockCreatedDocument);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(neonContractorService.addDocument).toHaveBeenCalled();
      expect(apiResponse.created).toHaveBeenCalled();
    });

    it('should accept valid document type - company_registration', async () => {
      req.method = 'POST';
      req.body = {
        documentType: 'company_registration',
        documentName: 'Company Registration',
        fileName: 'reg.pdf',
        filePath: '/uploads/reg.pdf'
      };

      const mockContractor = {
        id: '123',
        companyName: 'ABC Contractors'
      };

      const mockCreatedDocument = {
        id: 'new-doc-id',
        contractorId: '123',
        ...req.body
      };

      (neonContractorService.getContractorById as any).mockResolvedValue(mockContractor);
      (neonContractorService.addDocument as any).mockResolvedValue(mockCreatedDocument);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(neonContractorService.addDocument).toHaveBeenCalled();
      expect(apiResponse.created).toHaveBeenCalled();
    });

    it('should accept valid document type - other', async () => {
      req.method = 'POST';
      req.body = {
        documentType: 'other',
        documentName: 'Miscellaneous Document',
        fileName: 'misc.pdf',
        filePath: '/uploads/misc.pdf'
      };

      const mockContractor = {
        id: '123',
        companyName: 'ABC Contractors'
      };

      const mockCreatedDocument = {
        id: 'new-doc-id',
        contractorId: '123',
        ...req.body
      };

      (neonContractorService.getContractorById as any).mockResolvedValue(mockContractor);
      (neonContractorService.addDocument as any).mockResolvedValue(mockCreatedDocument);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(neonContractorService.addDocument).toHaveBeenCalled();
      expect(apiResponse.created).toHaveBeenCalled();
    });

    it('should validate expiry date format - invalid date', async () => {
      req.method = 'POST';
      req.body = {
        documentType: 'tax_certificate',
        documentName: 'Tax Cert',
        fileName: 'tax.pdf',
        filePath: '/uploads/tax.pdf',
        expiryDate: 'invalid-date'
      };

      const mockContractor = {
        id: '123',
        companyName: 'ABC Contractors'
      };

      (neonContractorService.getContractorById as any).mockResolvedValue(mockContractor);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(apiResponse.validationError).toHaveBeenCalledWith(res, {
        expiryDate: 'Invalid expiry date format'
      });
      expect(neonContractorService.addDocument).not.toHaveBeenCalled();
    });

    it('should allow valid expiry date', async () => {
      req.method = 'POST';
      req.body = {
        documentType: 'tax_certificate',
        documentName: 'Tax Cert',
        fileName: 'tax.pdf',
        filePath: '/uploads/tax.pdf',
        expiryDate: '2025-12-31'
      };

      const mockContractor = {
        id: '123',
        companyName: 'ABC Contractors'
      };

      const mockCreatedDocument = {
        id: 'new-doc-id',
        contractorId: '123',
        ...req.body
      };

      (neonContractorService.getContractorById as any).mockResolvedValue(mockContractor);
      (neonContractorService.addDocument as any).mockResolvedValue(mockCreatedDocument);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(neonContractorService.addDocument).toHaveBeenCalled();
      expect(apiResponse.created).toHaveBeenCalled();
    });

    it('should allow document creation without expiry date', async () => {
      req.method = 'POST';
      req.body = {
        documentType: 'company_registration',
        documentName: 'Company Reg',
        fileName: 'reg.pdf',
        filePath: '/uploads/reg.pdf'
      };

      const mockContractor = {
        id: '123',
        companyName: 'ABC Contractors'
      };

      const mockCreatedDocument = {
        id: 'new-doc-id',
        contractorId: '123',
        ...req.body
      };

      (neonContractorService.getContractorById as any).mockResolvedValue(mockContractor);
      (neonContractorService.addDocument as any).mockResolvedValue(mockCreatedDocument);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(neonContractorService.addDocument).toHaveBeenCalled();
      expect(apiResponse.created).toHaveBeenCalled();
    });

    it('should allow document creation without notes', async () => {
      req.method = 'POST';
      req.body = {
        documentType: 'tax_certificate',
        documentName: 'Tax Cert',
        fileName: 'tax.pdf',
        filePath: '/uploads/tax.pdf'
      };

      const mockContractor = {
        id: '123',
        companyName: 'ABC Contractors'
      };

      const mockCreatedDocument = {
        id: 'new-doc-id',
        contractorId: '123',
        ...req.body
      };

      (neonContractorService.getContractorById as any).mockResolvedValue(mockContractor);
      (neonContractorService.addDocument as any).mockResolvedValue(mockCreatedDocument);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(neonContractorService.addDocument).toHaveBeenCalled();
      expect(apiResponse.created).toHaveBeenCalled();
    });

    it('should allow document creation without fileUrl', async () => {
      req.method = 'POST';
      req.body = {
        documentType: 'tax_certificate',
        documentName: 'Tax Cert',
        fileName: 'tax.pdf',
        filePath: '/uploads/tax.pdf'
      };

      const mockContractor = {
        id: '123',
        companyName: 'ABC Contractors'
      };

      const mockCreatedDocument = {
        id: 'new-doc-id',
        contractorId: '123',
        ...req.body
      };

      (neonContractorService.getContractorById as any).mockResolvedValue(mockContractor);
      (neonContractorService.addDocument as any).mockResolvedValue(mockCreatedDocument);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(neonContractorService.addDocument).toHaveBeenCalled();
      expect(apiResponse.created).toHaveBeenCalled();
    });

    it('should handle service errors during creation', async () => {
      req.method = 'POST';
      req.body = {
        documentType: 'tax_certificate',
        documentName: 'Tax Cert',
        fileName: 'tax.pdf',
        filePath: '/uploads/tax.pdf'
      };

      const mockContractor = {
        id: '123',
        companyName: 'ABC Contractors'
      };

      const mockError = new Error('Database error');
      (neonContractorService.getContractorById as any).mockResolvedValue(mockContractor);
      (neonContractorService.addDocument as any).mockRejectedValue(mockError);

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

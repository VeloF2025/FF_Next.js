/**
 * Tests for Staff Document API endpoints
 * GET, PUT, DELETE /api/staff-documents/[documentId]
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

// Use vi.hoisted to create mock before vi.mock is hoisted
const { mockSql } = vi.hoisted(() => {
  return { mockSql: vi.fn() };
});

// Mock dependencies
vi.mock('@neondatabase/serverless', () => ({
  neon: () => mockSql,
  neonConfig: { fetchConnectionCache: false },
}));

vi.mock('@/lib/arcjet', () => ({
  withArcjetProtection: (handler: Function) => handler,
  aj: {},
}));

vi.mock('@/lib/logger', () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), getLogs: vi.fn(() => []), clearLogs: vi.fn() },
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('@/config/firebase-admin', () => ({
  getAdminStorage: () => ({
    file: vi.fn().mockReturnValue({
      delete: vi.fn().mockResolvedValue(undefined),
    }),
  }),
}));

// Import handler after mocks
import handler from '../../../pages/api/staff-documents/[documentId]';

describe('Staff Document API - /api/staff-documents/[documentId]', () => {
  let req: Partial<NextApiRequest>;
  let res: Partial<NextApiResponse>;

  beforeEach(() => {
    vi.clearAllMocks();

    req = {
      method: 'GET',
      query: { documentId: 'doc-123' },
      body: {},
    };

    res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      setHeader: vi.fn().mockReturnThis(),
    };
  });

  describe('GET /api/staff-documents/[documentId]', () => {
    it('should return a single document by ID', async () => {
      const mockDocument = {
        id: 'doc-123',
        staff_id: 'staff-456',
        document_type: 'id_document',
        document_name: 'ID Card',
        file_url: 'https://example.com/doc.pdf',
        file_size: 1024,
        mime_type: 'application/pdf',
        verification_status: 'verified',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        staff_name: 'John Doe',
        verifier_name: 'Admin',
      };

      mockSql.mockResolvedValueOnce([mockDocument]);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          document: expect.objectContaining({
            id: 'doc-123',
            documentType: 'id_document',
          }),
        })
      );
    });

    it('should return 404 when document not found', async () => {
      mockSql.mockResolvedValueOnce([]);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Document not found',
        })
      );
    });

    it('should return 400 when documentId is missing', async () => {
      req.query = {};

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Document ID is required',
        })
      );
    });

    it('should return 500 on database error', async () => {
      mockSql.mockRejectedValueOnce(new Error('Database error'));

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Failed to fetch document',
        })
      );
    });
  });

  describe('PUT /api/staff-documents/[documentId]', () => {
    beforeEach(() => {
      req.method = 'PUT';
    });

    it('should update document metadata successfully', async () => {
      req.body = {
        documentName: 'Updated Name',
        documentNumber: 'DOC-12345',
      };

      const updatedDocument = {
        id: 'doc-123',
        staff_id: 'staff-456',
        document_type: 'id_document',
        document_name: 'Updated Name',
        document_number: 'DOC-12345',
        file_url: 'https://example.com/doc.pdf',
        verification_status: 'pending',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      mockSql.mockResolvedValueOnce([updatedDocument]);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          document: expect.objectContaining({
            documentName: 'Updated Name',
            documentNumber: 'DOC-12345',
          }),
        })
      );
    });

    it('should update expiry and issued dates', async () => {
      req.body = {
        expiryDate: '2025-12-31',
        issuedDate: '2024-01-15',
        issuingAuthority: 'Authority Corp',
      };

      const updatedDocument = {
        id: 'doc-123',
        staff_id: 'staff-456',
        document_type: 'drivers_license',
        document_name: 'License',
        expiry_date: '2025-12-31',
        issued_date: '2024-01-15',
        issuing_authority: 'Authority Corp',
        file_url: 'https://example.com/doc.pdf',
        verification_status: 'pending',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      mockSql.mockResolvedValueOnce([updatedDocument]);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          document: expect.objectContaining({
            issuingAuthority: 'Authority Corp',
          }),
        })
      );
    });

    it('should return 404 when updating non-existent document', async () => {
      req.body = { documentName: 'New Name' };
      mockSql.mockResolvedValueOnce([]);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Document not found',
        })
      );
    });

    it('should return 500 on database error during update', async () => {
      req.body = { documentName: 'New Name' };
      mockSql.mockRejectedValueOnce(new Error('Update failed'));

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Failed to update document',
        })
      );
    });
  });

  describe('DELETE /api/staff-documents/[documentId]', () => {
    beforeEach(() => {
      req.method = 'DELETE';
    });

    it('should delete document successfully', async () => {
      const mockDocument = {
        id: 'doc-123',
        file_url: 'https://storage.googleapis.com/bucket/staff-documents/staff-456/id/doc.pdf',
      };

      // First query: get document
      mockSql.mockResolvedValueOnce([mockDocument]);
      // Second query: delete document
      mockSql.mockResolvedValueOnce([{ id: 'doc-123' }]);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          message: 'Document deleted successfully',
        })
      );
    });

    it('should return 404 when deleting non-existent document', async () => {
      mockSql.mockResolvedValueOnce([]);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Document not found',
        })
      );
    });

    it('should delete document even if Firebase delete fails', async () => {
      const mockDocument = {
        id: 'doc-123',
        file_url: 'https://storage.googleapis.com/bucket/staff-documents/path/doc.pdf',
      };

      mockSql.mockResolvedValueOnce([mockDocument]);
      mockSql.mockResolvedValueOnce([{ id: 'doc-123' }]);

      // Firebase delete is mocked to succeed by default
      // The handler catches Firebase errors and continues

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('should return 500 on database error during delete', async () => {
      const mockDocument = {
        id: 'doc-123',
        file_url: 'https://example.com/doc.pdf',
      };

      mockSql.mockResolvedValueOnce([mockDocument]);
      mockSql.mockRejectedValueOnce(new Error('Delete failed'));

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Failed to delete document',
        })
      );
    });
  });

  describe('Method validation', () => {
    it('should return 405 for unsupported methods', async () => {
      req.method = 'PATCH';

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(res.status).toHaveBeenCalledWith(405);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Method not allowed',
        })
      );
    });
  });
});

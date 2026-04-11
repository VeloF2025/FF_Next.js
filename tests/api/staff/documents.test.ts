/**
 * Tests for Staff Documents API endpoints
 * GET /api/staff/[staffId]/documents
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

// Use vi.hoisted to create mock before vi.mock is hoisted
const { mockSql } = vi.hoisted(() => {
  return { mockSql: vi.fn() };
});

// Mock dependencies before any imports
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

// Import handler after mocks are set up
import handler from '../../../pages/api/staff/[staffId]/documents';

describe('Staff Documents API - GET /api/staff/[staffId]/documents', () => {
  let req: Partial<NextApiRequest>;
  let res: Partial<NextApiResponse>;

  beforeEach(() => {
    vi.clearAllMocks();

    req = {
      method: 'GET',
      query: { staffId: 'staff-123' },
      body: {},
    };

    res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      setHeader: vi.fn().mockReturnThis(),
    };
  });

  it('should return documents for a staff member', async () => {
    const mockDocuments = [
      {
        id: 'doc-1',
        staff_id: 'staff-123',
        document_type: 'id_document',
        document_name: 'ID Card',
        file_url: 'https://example.com/doc1.pdf',
        file_size: 1024,
        mime_type: 'application/pdf',
        verification_status: 'verified',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        staff_name: 'John Doe',
      },
      {
        id: 'doc-2',
        staff_id: 'staff-123',
        document_type: 'drivers_license',
        document_name: 'License',
        file_url: 'https://example.com/doc2.pdf',
        file_size: 2048,
        mime_type: 'application/pdf',
        verification_status: 'pending',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        staff_name: 'John Doe',
      },
    ];

    // Handler calls sql twice - once for query variable, once for actual fetch
    mockSql
      .mockResolvedValueOnce([]) // First call (unused query variable)
      .mockResolvedValueOnce(mockDocuments); // Second call (actual documents fetch)

    await handler(req as NextApiRequest, res as NextApiResponse);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        documents: expect.arrayContaining([
          expect.objectContaining({
            id: 'doc-1',
            documentType: 'id_document',
          }),
          expect.objectContaining({
            id: 'doc-2',
            documentType: 'drivers_license',
          }),
        ]),
        count: 2,
      })
    );
  });

  it('should filter documents by documentType', async () => {
    req.query = { staffId: 'staff-123', documentType: 'id_document' };

    const mockDocuments = [
      {
        id: 'doc-1',
        staff_id: 'staff-123',
        document_type: 'id_document',
        document_name: 'ID Card',
        file_url: 'https://example.com/doc1.pdf',
        verification_status: 'verified',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: 'doc-2',
        staff_id: 'staff-123',
        document_type: 'drivers_license',
        document_name: 'License',
        file_url: 'https://example.com/doc2.pdf',
        verification_status: 'pending',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ];

    // Handler calls sql multiple times for different query variations
    mockSql
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(mockDocuments);

    await handler(req as NextApiRequest, res as NextApiResponse);

    expect(res.status).toHaveBeenCalledWith(200);
    // The handler filters in JS, so only id_document should be returned
    const jsonCall = (res.json as any).mock.calls[0][0];
    expect(jsonCall.documents.every((d: any) => d.documentType === 'id_document')).toBe(true);
  });

  it('should filter documents by verificationStatus', async () => {
    req.query = { staffId: 'staff-123', verificationStatus: 'verified' };

    const mockDocuments = [
      {
        id: 'doc-1',
        staff_id: 'staff-123',
        document_type: 'id_document',
        document_name: 'ID Card',
        file_url: 'https://example.com/doc1.pdf',
        verification_status: 'verified',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: 'doc-2',
        staff_id: 'staff-123',
        document_type: 'drivers_license',
        document_name: 'License',
        file_url: 'https://example.com/doc2.pdf',
        verification_status: 'pending',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ];

    // Handler calls sql multiple times for different query variations
    mockSql
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(mockDocuments);

    await handler(req as NextApiRequest, res as NextApiResponse);

    expect(res.status).toHaveBeenCalledWith(200);
    const jsonCall = (res.json as any).mock.calls[0][0];
    expect(jsonCall.documents.every((d: any) => d.verificationStatus === 'verified')).toBe(true);
  });

  it('should return empty array when no documents exist', async () => {
    // Handler calls sql twice
    mockSql
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    await handler(req as NextApiRequest, res as NextApiResponse);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        documents: [],
        count: 0,
      })
    );
  });

  it('should return 400 when staffId is missing', async () => {
    req.query = {};

    await handler(req as NextApiRequest, res as NextApiResponse);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'Staff ID is required',
      })
    );
  });

  it('should return 400 when staffId is array', async () => {
    req.query = { staffId: ['staff-1', 'staff-2'] };

    await handler(req as NextApiRequest, res as NextApiResponse);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'Staff ID is required',
      })
    );
  });

  it('should return 500 on database error', async () => {
    mockSql
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('Database connection failed'));

    await handler(req as NextApiRequest, res as NextApiResponse);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'Failed to fetch documents',
      })
    );
  });

  it('should return 405 for unsupported methods', async () => {
    req.method = 'PUT';

    await handler(req as NextApiRequest, res as NextApiResponse);

    expect(res.status).toHaveBeenCalledWith(405);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'Method not allowed',
      })
    );
  });

  it('should map database fields to camelCase', async () => {
    const mockDocument = {
      id: 'doc-1',
      staff_id: 'staff-123',
      document_type: 'certification',
      document_name: 'Safety Cert',
      file_url: 'https://example.com/cert.pdf',
      file_size: 1024,
      mime_type: 'application/pdf',
      expiry_date: '2025-12-31',
      issued_date: '2024-01-15',
      issuing_authority: 'SafetyCorp',
      document_number: 'CERT-12345',
      verification_status: 'verified',
      verified_by: 'admin-1',
      verified_at: new Date().toISOString(),
      verification_notes: 'Approved',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      staff_name: 'John Doe',
      verifier_name: 'Admin User',
    };

    // Handler calls sql twice
    mockSql
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([mockDocument]);

    await handler(req as NextApiRequest, res as NextApiResponse);

    expect(res.status).toHaveBeenCalledWith(200);
    const jsonCall = (res.json as any).mock.calls[0][0];
    const doc = jsonCall.documents[0];

    expect(doc).toHaveProperty('staffId', 'staff-123');
    expect(doc).toHaveProperty('documentType', 'certification');
    expect(doc).toHaveProperty('documentName', 'Safety Cert');
    expect(doc).toHaveProperty('fileUrl');
    expect(doc).toHaveProperty('fileSize', 1024);
    expect(doc).toHaveProperty('mimeType', 'application/pdf');
    expect(doc).toHaveProperty('issuingAuthority', 'SafetyCorp');
    expect(doc).toHaveProperty('documentNumber', 'CERT-12345');
    expect(doc).toHaveProperty('verificationStatus', 'verified');
    expect(doc).toHaveProperty('verificationNotes', 'Approved');
    expect(doc).toHaveProperty('staff');
    expect(doc.staff).toEqual({ id: 'staff-123', name: 'John Doe' });
    expect(doc).toHaveProperty('verifier');
    expect(doc.verifier).toEqual({ id: 'admin-1', name: 'Admin User' });
  });
});

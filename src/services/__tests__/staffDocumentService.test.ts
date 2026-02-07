/**
 * Tests for Staff Document Service
 * Tests all CRUD operations and compliance status calculations
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StaffDocumentServiceClass } from '../staffDocumentService';
import type { StaffDocument, DocumentType, VerificationStatus } from '@/types/staff-document.types';

// Mock logger
vi.mock('@/lib/logger', () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), getLogs: vi.fn(() => []), clearLogs: vi.fn() },
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Create a fresh instance for testing
const createService = () => new StaffDocumentServiceClass();

// Mock data factories
const createMockDocument = (overrides: Partial<StaffDocument> = {}): StaffDocument => ({
  id: 'doc-123',
  staffId: 'staff-456',
  documentType: 'id_document',
  documentName: 'ID Card',
  fileUrl: 'https://storage.example.com/doc.pdf',
  fileSize: 1024,
  mimeType: 'application/pdf',
  verificationStatus: 'pending',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
});

describe('StaffDocumentService', () => {
  let service: StaffDocumentServiceClass;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    service = createService();
    mockFetch = vi.fn();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('getByStaffId', () => {
    it('should fetch documents for a staff member', async () => {
      const mockDocuments = [
        createMockDocument({ id: 'doc-1', documentName: 'ID Card' }),
        createMockDocument({ id: 'doc-2', documentName: 'License', documentType: 'drivers_license' }),
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ documents: mockDocuments }),
      });

      const result = await service.getByStaffId('staff-456');

      expect(mockFetch).toHaveBeenCalledWith('/api/staff/staff-456/documents');
      expect(result).toEqual(mockDocuments);
    });

    it('should fetch documents with documentType filter', async () => {
      const mockDocuments = [createMockDocument({ documentType: 'drivers_license' })];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ documents: mockDocuments }),
      });

      const result = await service.getByStaffId('staff-456', { documentType: 'drivers_license' });

      expect(mockFetch).toHaveBeenCalledWith('/api/staff/staff-456/documents?documentType=drivers_license');
      expect(result).toEqual(mockDocuments);
    });

    it('should fetch documents with verificationStatus filter', async () => {
      const mockDocuments = [createMockDocument({ verificationStatus: 'verified' })];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ documents: mockDocuments }),
      });

      const result = await service.getByStaffId('staff-456', { verificationStatus: 'verified' });

      expect(mockFetch).toHaveBeenCalledWith('/api/staff/staff-456/documents?verificationStatus=verified');
      expect(result).toEqual(mockDocuments);
    });

    it('should fetch documents with multiple filters', async () => {
      const mockDocuments: StaffDocument[] = [];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ documents: mockDocuments }),
      });

      await service.getByStaffId('staff-456', {
        documentType: 'id_document',
        verificationStatus: 'pending',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/staff/staff-456/documents?documentType=id_document&verificationStatus=pending'
      );
    });

    it('should return empty array when no documents exist', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ documents: [] }),
      });

      const result = await service.getByStaffId('staff-456');

      expect(result).toEqual([]);
    });

    it('should handle API errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ message: 'Staff not found' }),
      });

      await expect(service.getByStaffId('invalid-staff')).rejects.toThrow('Staff not found');
    });

    it('should handle network errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      await expect(service.getByStaffId('staff-456')).rejects.toThrow('Network error');
    });
  });

  describe('getById', () => {
    it('should fetch a single document by ID', async () => {
      const mockDocument = createMockDocument();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ document: mockDocument }),
      });

      const result = await service.getById('doc-123');

      expect(mockFetch).toHaveBeenCalledWith('/api/staff-documents/doc-123');
      expect(result).toEqual(mockDocument);
    });

    it('should handle document not found', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ message: 'Document not found' }),
      });

      await expect(service.getById('non-existent')).rejects.toThrow('Document not found');
    });
  });

  describe('upload', () => {
    it('should upload a document successfully', async () => {
      const mockFile = new File(['test content'], 'test.pdf', { type: 'application/pdf' });
      const mockDocument = createMockDocument({
        documentName: 'Test Document',
        documentType: 'certification',
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ document: mockDocument }),
      });

      const result = await service.upload('staff-456', 'certification', 'Test Document', mockFile);

      expect(mockFetch).toHaveBeenCalledWith('/api/staff-documents-upload', {
        method: 'POST',
        body: expect.any(FormData),
      });

      // Verify FormData contents
      const call = mockFetch.mock.calls[0];
      const formData = call[1].body as FormData;
      expect(formData.get('staffId')).toBe('staff-456');
      expect(formData.get('documentType')).toBe('certification');
      expect(formData.get('documentName')).toBe('Test Document');
      expect(formData.get('file')).toBe(mockFile);

      expect(result).toEqual(mockDocument);
    });

    it('should upload document with metadata', async () => {
      const mockFile = new File(['test'], 'license.pdf', { type: 'application/pdf' });
      const mockDocument = createMockDocument();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ document: mockDocument }),
      });

      await service.upload('staff-456', 'drivers_license', 'Driver License', mockFile, {
        expiryDate: '2025-12-31',
        issuedDate: '2020-01-15',
        issuingAuthority: 'DMV',
        documentNumber: 'DL123456',
      });

      const call = mockFetch.mock.calls[0];
      const formData = call[1].body as FormData;
      expect(formData.get('expiryDate')).toBe('2025-12-31');
      expect(formData.get('issuedDate')).toBe('2020-01-15');
      expect(formData.get('issuingAuthority')).toBe('DMV');
      expect(formData.get('documentNumber')).toBe('DL123456');
    });

    it('should not include undefined metadata fields', async () => {
      const mockFile = new File(['test'], 'doc.pdf', { type: 'application/pdf' });
      const mockDocument = createMockDocument();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ document: mockDocument }),
      });

      await service.upload('staff-456', 'id_document', 'ID', mockFile, {
        expiryDate: '2025-12-31',
        // other fields undefined
      });

      const call = mockFetch.mock.calls[0];
      const formData = call[1].body as FormData;
      expect(formData.get('expiryDate')).toBe('2025-12-31');
      expect(formData.get('issuedDate')).toBeNull();
      expect(formData.get('issuingAuthority')).toBeNull();
    });

    it('should handle upload errors', async () => {
      const mockFile = new File(['test'], 'doc.pdf', { type: 'application/pdf' });

      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ message: 'File too large' }),
      });

      await expect(service.upload('staff-456', 'id_document', 'ID', mockFile)).rejects.toThrow(
        'File too large'
      );
    });
  });

  describe('update', () => {
    it('should update document metadata', async () => {
      const updatedDocument = createMockDocument({
        documentName: 'Updated Name',
        documentNumber: 'NEW-123',
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ document: updatedDocument }),
      });

      const result = await service.update('doc-123', {
        documentName: 'Updated Name',
        documentNumber: 'NEW-123',
      });

      expect(mockFetch).toHaveBeenCalledWith('/api/staff-documents/doc-123', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentName: 'Updated Name',
          documentNumber: 'NEW-123',
        }),
      });
      expect(result).toEqual(updatedDocument);
    });

    it('should handle update errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ message: 'Update failed' }),
      });

      await expect(service.update('doc-123', { documentName: 'New' })).rejects.toThrow('Update failed');
    });
  });

  describe('delete', () => {
    it('should delete a document', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      await service.delete('doc-123');

      expect(mockFetch).toHaveBeenCalledWith('/api/staff-documents/doc-123', {
        method: 'DELETE',
      });
    });

    it('should handle delete errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ message: 'Cannot delete verified document' }),
      });

      await expect(service.delete('doc-123')).rejects.toThrow('Cannot delete verified document');
    });
  });

  describe('verify', () => {
    it('should verify a document', async () => {
      const verifiedDocument = createMockDocument({
        verificationStatus: 'verified',
        verifiedAt: new Date().toISOString(),
        verifiedBy: 'admin-123',
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ document: verifiedDocument }),
      });

      const result = await service.verify('doc-123', 'verified');

      expect(mockFetch).toHaveBeenCalledWith('/api/staff-documents/doc-123/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'verified', notes: undefined }),
      });
      expect(result.verificationStatus).toBe('verified');
    });

    it('should reject a document with notes', async () => {
      const rejectedDocument = createMockDocument({
        verificationStatus: 'rejected',
        verificationNotes: 'Document is blurry',
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ document: rejectedDocument }),
      });

      const result = await service.verify('doc-123', 'rejected', 'Document is blurry');

      expect(mockFetch).toHaveBeenCalledWith('/api/staff-documents/doc-123/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'rejected', notes: 'Document is blurry' }),
      });
      expect(result.verificationStatus).toBe('rejected');
    });

    it('should handle verification errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ message: 'Unauthorized to verify' }),
      });

      await expect(service.verify('doc-123', 'verified')).rejects.toThrow('Unauthorized to verify');
    });
  });

  describe('getExpiring', () => {
    it('should fetch expiring documents with default days', async () => {
      const expiringDocs = [
        createMockDocument({ expiryDate: '2024-02-15' }),
        createMockDocument({ expiryDate: '2024-02-20' }),
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ documents: expiringDocs }),
      });

      const result = await service.getExpiring();

      expect(mockFetch).toHaveBeenCalledWith('/api/staff-documents/expiring?days=30');
      expect(result).toEqual(expiringDocs);
    });

    it('should fetch expiring documents with custom days', async () => {
      const expiringDocs = [createMockDocument({ expiryDate: '2024-02-05' })];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ documents: expiringDocs }),
      });

      const result = await service.getExpiring(7);

      expect(mockFetch).toHaveBeenCalledWith('/api/staff-documents/expiring?days=7');
      expect(result).toEqual(expiringDocs);
    });

    it('should fetch expiring documents for specific staff', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ documents: [] }),
      });

      await service.getExpiring(30, 'staff-456');

      expect(mockFetch).toHaveBeenCalledWith('/api/staff-documents/expiring?days=30&staffId=staff-456');
    });

    it('should handle API errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ message: 'Server error' }),
      });

      await expect(service.getExpiring()).rejects.toThrow('Server error');
    });
  });

  describe('getComplianceStatus', () => {
    it('should return compliant status when all required documents are verified', async () => {
      const documents = [
        createMockDocument({
          documentType: 'id_document',
          verificationStatus: 'verified',
        }),
        createMockDocument({
          documentType: 'employment_contract',
          verificationStatus: 'verified',
        }),
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ documents }),
      });

      const result = await service.getComplianceStatus('staff-456');

      expect(result.status).toBe('compliant');
      expect(result.compliancePercentage).toBe(100);
      expect(result.missingRequired).toEqual([]);
      expect(result.verifiedDocuments).toBe(2);
    });

    it('should return non_compliant status when required documents are missing', async () => {
      const documents = [
        createMockDocument({
          documentType: 'drivers_license',
          verificationStatus: 'verified',
        }),
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ documents }),
      });

      const result = await service.getComplianceStatus('staff-456');

      expect(result.status).toBe('non_compliant');
      expect(result.compliancePercentage).toBe(0);
      expect(result.missingRequired).toContain('id_document');
      expect(result.missingRequired).toContain('employment_contract');
    });

    it('should return non_compliant status when documents are expired', async () => {
      const documents = [
        createMockDocument({
          documentType: 'id_document',
          verificationStatus: 'expired',
        }),
        createMockDocument({
          documentType: 'employment_contract',
          verificationStatus: 'verified',
        }),
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ documents }),
      });

      const result = await service.getComplianceStatus('staff-456');

      expect(result.status).toBe('non_compliant');
      expect(result.expiredDocuments).toBe(1);
    });

    it('should return warning status when documents are pending', async () => {
      const documents = [
        createMockDocument({
          documentType: 'id_document',
          verificationStatus: 'verified',
        }),
        createMockDocument({
          documentType: 'employment_contract',
          verificationStatus: 'pending',
        }),
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ documents }),
      });

      const result = await service.getComplianceStatus('staff-456');

      expect(result.status).toBe('warning');
      expect(result.pendingDocuments).toBe(1);
    });

    it('should return warning status when documents are expiring within 7 days', async () => {
      const in5Days = new Date();
      in5Days.setDate(in5Days.getDate() + 5);

      const documents = [
        createMockDocument({
          documentType: 'id_document',
          verificationStatus: 'verified',
          expiryDate: in5Days.toISOString(),
        }),
        createMockDocument({
          documentType: 'employment_contract',
          verificationStatus: 'verified',
        }),
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ documents }),
      });

      const result = await service.getComplianceStatus('staff-456');

      expect(result.status).toBe('warning');
      expect(result.expiringIn7Days).toBe(1);
    });

    it('should calculate expiring in 30 days correctly', async () => {
      const in20Days = new Date();
      in20Days.setDate(in20Days.getDate() + 20);

      const documents = [
        createMockDocument({
          documentType: 'id_document',
          verificationStatus: 'verified',
          expiryDate: in20Days.toISOString(),
        }),
        createMockDocument({
          documentType: 'employment_contract',
          verificationStatus: 'verified',
        }),
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ documents }),
      });

      const result = await service.getComplianceStatus('staff-456');

      expect(result.expiringIn30Days).toBe(1);
      expect(result.expiringIn7Days).toBe(0);
    });

    it('should count document statuses correctly', async () => {
      const documents = [
        createMockDocument({ verificationStatus: 'verified' }),
        createMockDocument({ verificationStatus: 'verified' }),
        createMockDocument({ verificationStatus: 'pending' }),
        createMockDocument({ verificationStatus: 'rejected' }),
        createMockDocument({ verificationStatus: 'expired' }),
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ documents }),
      });

      const result = await service.getComplianceStatus('staff-456');

      expect(result.totalDocuments).toBe(5);
      expect(result.verifiedDocuments).toBe(2);
      expect(result.pendingDocuments).toBe(1);
      expect(result.rejectedDocuments).toBe(1);
      expect(result.expiredDocuments).toBe(1);
    });

    it('should handle empty documents', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ documents: [] }),
      });

      const result = await service.getComplianceStatus('staff-456');

      expect(result.totalDocuments).toBe(0);
      expect(result.status).toBe('non_compliant');
      expect(result.missingRequired.length).toBe(2);
    });

    it('should handle API errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ message: 'Staff not found' }),
      });

      await expect(service.getComplianceStatus('invalid-staff')).rejects.toThrow('Staff not found');
    });
  });

  describe('getDownloadUrl', () => {
    it('should return the file URL from document', () => {
      const document = createMockDocument({
        fileUrl: 'https://storage.example.com/documents/test.pdf',
      });

      const url = service.getDownloadUrl(document);

      expect(url).toBe('https://storage.example.com/documents/test.pdf');
    });
  });
});

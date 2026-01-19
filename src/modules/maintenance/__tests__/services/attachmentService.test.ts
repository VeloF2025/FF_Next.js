/**
 * Attachment Service Tests (TDD)
 *
 * Tests FIRST - Implementation SECOND
 *
 * Testing attachment operations with Firebase Storage integration:
 * - Upload photo to Firebase Storage
 * - Create attachment record in DB
 * - Link attachment to verification step
 * - List attachments for ticket
 * - Delete attachment (cascade)
 * - File type validation
 * - File size validation
 *
 * 🟢 WORKING: Comprehensive test suite for attachment service
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  uploadAttachment,
  createAttachment,
  getAttachmentById,
  listAttachmentsForTicket,
  deleteAttachment,
  validateFileUpload,
  getPhotoEvidenceSummary,
  getAttachmentStatistics
} from '../../services/attachmentService';
import {
  FileType,
  CreateAttachmentPayload,
  FileUploadRequest,
  AttachmentFilters
} from '../../types/attachment';

// Mock the database utility
vi.mock('../../utils/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  transaction: vi.fn()
}));

// Mock Firebase Storage
vi.mock('firebase/storage', () => ({
  ref: vi.fn(),
  uploadBytes: vi.fn(),
  getDownloadURL: vi.fn(),
  deleteObject: vi.fn()
}));

// Mock Firebase config
vi.mock('@/config/firebase', () => ({
  storage: {}
}));

// Mock the logger
vi.mock('@/lib/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn()
  }))
}));

import { query, queryOne } from '../../utils/db';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';

describe('Attachment Service - Firebase Storage Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('validateFileUpload', () => {
    it('should pass validation for valid photo file', () => {
      // 🟢 WORKING: Test file validation for photo uploads
      const file = {
        name: 'photo.jpg',
        size: 2 * 1024 * 1024, // 2MB
        type: 'image/jpeg'
      } as File;

      const result = validateFileUpload(file);

      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should pass validation for PNG photo', () => {
      const file = {
        name: 'screenshot.png',
        size: 1 * 1024 * 1024, // 1MB
        type: 'image/png'
      } as File;

      const result = validateFileUpload(file);

      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should pass validation for PDF document', () => {
      const file = {
        name: 'document.pdf',
        size: 3 * 1024 * 1024, // 3MB
        type: 'application/pdf'
      } as File;

      const result = validateFileUpload(file);

      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should fail validation for unsupported file type', () => {
      const file = {
        name: 'virus.exe',
        size: 1 * 1024 * 1024,
        type: 'application/x-msdownload'
      } as File;

      const result = validateFileUpload(file);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid file type');
    });

    it('should fail validation for file too large', () => {
      const file = {
        name: 'huge-photo.jpg',
        size: 15 * 1024 * 1024, // 15MB (exceeds 10MB limit)
        type: 'image/jpeg'
      } as File;

      const result = validateFileUpload(file);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('too large');
    });

    it('should validate with custom file size limit', () => {
      const file = {
        name: 'photo.jpg',
        size: 2 * 1024 * 1024, // 2MB
        type: 'image/jpeg'
      } as File;

      const result = validateFileUpload(file, { maxSize: 1 * 1024 * 1024 }); // 1MB limit

      expect(result.valid).toBe(false);
      expect(result.error).toContain('too large');
    });

    it('should validate with custom allowed types', () => {
      const file = {
        name: 'photo.jpg',
        size: 1 * 1024 * 1024,
        type: 'image/jpeg'
      } as File;

      const result = validateFileUpload(file, {
        allowedTypes: ['application/pdf']
      });

      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid file type');
    });
  });

  describe('uploadAttachment', () => {
    it('should upload photo to Firebase Storage and create DB record', async () => {
      // 🟢 WORKING: Test complete upload workflow
      const mockFile = {
        name: 'photo.jpg',
        size: 1024000, // ~1MB
        type: 'image/jpeg'
      } as File;

      const request: FileUploadRequest = {
        ticket_id: 'ticket-uuid-123',
        file: mockFile,
        filename: 'photo.jpg',
        uploaded_by: 'user-uuid-456',
        is_evidence: true,
        verification_step_id: 'step-uuid-789'
      };

      const mockStorageRef = { fullPath: 'tickets/ticket-uuid-123/1234567890_photo.jpg' };
      const mockUploadResult = {
        ref: mockStorageRef,
        metadata: { size: 1024000, contentType: 'image/jpeg' }
      };
      const mockDownloadURL = 'https://storage.googleapis.com/bucket/tickets/ticket-uuid-123/photo.jpg';

      // Mock Firebase Storage calls
      vi.mocked(ref).mockReturnValue(mockStorageRef as any);
      vi.mocked(uploadBytes).mockResolvedValue(mockUploadResult as any);
      vi.mocked(getDownloadURL).mockResolvedValue(mockDownloadURL);

      // Mock DB insert
      const mockAttachment = {
        id: 'attachment-uuid-111',
        ticket_id: 'ticket-uuid-123',
        filename: 'photo.jpg',
        file_type: FileType.PHOTO,
        mime_type: 'image/jpeg',
        file_size: 1024000,
        storage_path: 'tickets/ticket-uuid-123/1234567890_photo.jpg',
        storage_url: mockDownloadURL,
        uploaded_by: 'user-uuid-456',
        uploaded_at: new Date('2024-01-15T10:00:00Z'),
        verification_step_id: 'step-uuid-789',
        is_evidence: true
      };

      vi.mocked(queryOne).mockResolvedValue(mockAttachment);

      const result = await uploadAttachment(request);

      // Verify Firebase Storage was called correctly
      expect(ref).toHaveBeenCalled();
      expect(uploadBytes).toHaveBeenCalledWith(
        mockStorageRef,
        mockFile,
        expect.objectContaining({ contentType: 'image/jpeg' })
      );
      expect(getDownloadURL).toHaveBeenCalledWith(mockStorageRef);

      // Verify DB record was created
      expect(queryOne).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO ticket_attachments'),
        expect.arrayContaining([
          'ticket-uuid-123',
          'photo.jpg',
          FileType.PHOTO,
          'image/jpeg',
          1024000,
          expect.stringContaining('tickets/ticket-uuid-123'),
          mockDownloadURL,
          'user-uuid-456',
          'step-uuid-789',
          true
        ])
      );

      // Verify result
      expect(result).toMatchObject({
        attachment_id: 'attachment-uuid-111',
        ticket_id: 'ticket-uuid-123',
        filename: 'photo.jpg',
        storage_url: mockDownloadURL,
        file_size: 1024000,
        mime_type: 'image/jpeg'
      });
    });

    it('should upload attachment without verification step', async () => {
      const mockFile = {
        name: 'document.pdf',
        size: 500000,
        type: 'application/pdf'
      } as File;

      const request: FileUploadRequest = {
        ticket_id: 'ticket-uuid-123',
        file: mockFile,
        filename: 'document.pdf',
        uploaded_by: 'user-uuid-456',
        is_evidence: false
      };

      const mockStorageRef = { fullPath: 'tickets/ticket-uuid-123/1234567890_document.pdf' };
      const mockDownloadURL = 'https://storage.googleapis.com/bucket/document.pdf';

      vi.mocked(ref).mockReturnValue(mockStorageRef as any);
      vi.mocked(uploadBytes).mockResolvedValue({ ref: mockStorageRef, metadata: {} } as any);
      vi.mocked(getDownloadURL).mockResolvedValue(mockDownloadURL);

      const mockAttachment = {
        id: 'attachment-uuid-222',
        ticket_id: 'ticket-uuid-123',
        filename: 'document.pdf',
        file_type: FileType.PDF,
        mime_type: 'application/pdf',
        file_size: 500000,
        storage_path: 'tickets/ticket-uuid-123/1234567890_document.pdf',
        storage_url: mockDownloadURL,
        uploaded_by: 'user-uuid-456',
        uploaded_at: new Date('2024-01-15T10:00:00Z'),
        verification_step_id: null,
        is_evidence: false
      };

      vi.mocked(queryOne).mockResolvedValue(mockAttachment);

      const result = await uploadAttachment(request);

      expect(result.attachment_id).toBe('attachment-uuid-222');
      expect(result.file_size).toBe(500000);
      expect(queryOne).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([
          'ticket-uuid-123',
          'document.pdf',
          FileType.PDF,
          'application/pdf',
          500000,
          expect.any(String),
          mockDownloadURL,
          'user-uuid-456',
          null, // verification_step_id
          false // is_evidence
        ])
      );
    });

    it('should reject invalid file during upload', async () => {
      const mockFile = {
        name: 'virus.exe',
        size: 1000,
        type: 'application/x-msdownload'
      } as File;

      const request: FileUploadRequest = {
        ticket_id: 'ticket-uuid-123',
        file: mockFile,
        filename: 'virus.exe',
        uploaded_by: 'user-uuid-456'
      };

      await expect(uploadAttachment(request)).rejects.toThrow('Invalid file type');
      expect(uploadBytes).not.toHaveBeenCalled();
      expect(queryOne).not.toHaveBeenCalled();
    });

    it('should handle Firebase Storage upload failure', async () => {
      const mockFile = {
        name: 'photo.jpg',
        size: 1024000,
        type: 'image/jpeg'
      } as File;

      const request: FileUploadRequest = {
        ticket_id: 'ticket-uuid-123',
        file: mockFile,
        filename: 'photo.jpg',
        uploaded_by: 'user-uuid-456'
      };

      const mockStorageRef = { fullPath: 'tickets/ticket-uuid-123/photo.jpg' };
      vi.mocked(ref).mockReturnValue(mockStorageRef as any);
      vi.mocked(uploadBytes).mockRejectedValue(new Error('Storage quota exceeded'));

      await expect(uploadAttachment(request)).rejects.toThrow('Failed to upload file to storage');
      expect(queryOne).not.toHaveBeenCalled();
    });

    it('should handle DB insert failure after successful upload', async () => {
      const mockFile = {
        name: 'photo.jpg',
        size: 1024000,
        type: 'image/jpeg'
      } as File;

      const request: FileUploadRequest = {
        ticket_id: 'ticket-uuid-123',
        file: mockFile,
        filename: 'photo.jpg',
        uploaded_by: 'user-uuid-456'
      };

      const mockStorageRef = { fullPath: 'tickets/ticket-uuid-123/photo.jpg' };
      const mockDownloadURL = 'https://storage.googleapis.com/bucket/photo.jpg';

      vi.mocked(ref).mockReturnValue(mockStorageRef as any);
      vi.mocked(uploadBytes).mockResolvedValue({ ref: mockStorageRef, metadata: {} } as any);
      vi.mocked(getDownloadURL).mockResolvedValue(mockDownloadURL);
      vi.mocked(queryOne).mockRejectedValue(new Error('Database error'));

      await expect(uploadAttachment(request)).rejects.toThrow('Failed to create attachment record');
    });
  });

  describe('createAttachment', () => {
    it('should create attachment record with all fields', async () => {
      // 🟢 WORKING: Test direct DB record creation
      const payload: CreateAttachmentPayload = {
        ticket_id: 'ticket-uuid-123',
        filename: 'photo.jpg',
        file_type: FileType.PHOTO,
        mime_type: 'image/jpeg',
        file_size: 1024000,
        storage_path: 'tickets/ticket-uuid-123/photo.jpg',
        storage_url: 'https://storage.googleapis.com/bucket/photo.jpg',
        uploaded_by: 'user-uuid-456',
        verification_step_id: 'step-uuid-789',
        is_evidence: true
      };

      const mockAttachment = {
        id: 'attachment-uuid-111',
        ...payload,
        uploaded_at: new Date('2024-01-15T10:00:00Z')
      };

      vi.mocked(queryOne).mockResolvedValue(mockAttachment);

      const result = await createAttachment(payload);

      expect(queryOne).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO ticket_attachments'),
        expect.arrayContaining([
          'ticket-uuid-123',
          'photo.jpg',
          FileType.PHOTO,
          'image/jpeg',
          1024000,
          'tickets/ticket-uuid-123/photo.jpg',
          'https://storage.googleapis.com/bucket/photo.jpg',
          'user-uuid-456',
          'step-uuid-789',
          true
        ])
      );

      expect(result).toMatchObject({
        id: 'attachment-uuid-111',
        ticket_id: 'ticket-uuid-123',
        filename: 'photo.jpg'
      });
    });

    it('should create attachment with minimal fields', async () => {
      const payload: CreateAttachmentPayload = {
        ticket_id: 'ticket-uuid-123',
        filename: 'document.pdf',
        storage_path: 'tickets/ticket-uuid-123/document.pdf'
      };

      const mockAttachment = {
        id: 'attachment-uuid-222',
        ticket_id: 'ticket-uuid-123',
        filename: 'document.pdf',
        file_type: null,
        mime_type: null,
        file_size: null,
        storage_path: 'tickets/ticket-uuid-123/document.pdf',
        storage_url: null,
        uploaded_by: null,
        uploaded_at: new Date('2024-01-15T10:00:00Z'),
        verification_step_id: null,
        is_evidence: false
      };

      vi.mocked(queryOne).mockResolvedValue(mockAttachment);

      const result = await createAttachment(payload);

      expect(result.id).toBe('attachment-uuid-222');
      expect(result.file_type).toBeNull();
    });

    it('should reject missing required fields', async () => {
      const payload = {
        filename: 'photo.jpg',
        storage_path: 'tickets/photo.jpg'
      } as CreateAttachmentPayload;

      await expect(createAttachment(payload)).rejects.toThrow('ticket_id is required');
    });

    it('should handle database errors', async () => {
      const payload: CreateAttachmentPayload = {
        ticket_id: 'ticket-uuid-123',
        filename: 'photo.jpg',
        storage_path: 'tickets/ticket-uuid-123/photo.jpg'
      };

      vi.mocked(queryOne).mockRejectedValue(new Error('Foreign key constraint violation'));

      await expect(createAttachment(payload)).rejects.toThrow('Failed to create attachment');
    });
  });

  describe('getAttachmentById', () => {
    it('should retrieve attachment by ID', async () => {
      // 🟢 WORKING: Test fetching attachment by UUID
      const attachmentId = '123e4567-e89b-12d3-a456-426614174001';

      const mockAttachment = {
        id: attachmentId,
        ticket_id: '123e4567-e89b-12d3-a456-426614174000',
        filename: 'photo.jpg',
        file_type: FileType.PHOTO,
        mime_type: 'image/jpeg',
        file_size: 1024000,
        storage_path: 'tickets/ticket-uuid-123/photo.jpg',
        storage_url: 'https://storage.googleapis.com/bucket/photo.jpg',
        uploaded_by: 'user-uuid-456',
        uploaded_at: new Date('2024-01-15T10:00:00Z'),
        verification_step_id: 'step-uuid-789',
        is_evidence: true
      };

      vi.mocked(queryOne).mockResolvedValue(mockAttachment);

      const result = await getAttachmentById(attachmentId);

      expect(queryOne).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM ticket_attachments'),
        [attachmentId]
      );

      expect(result).toMatchObject({
        id: attachmentId,
        filename: 'photo.jpg',
        file_size: 1024000
      });
    });

    it('should return null for non-existent attachment', async () => {
      vi.mocked(queryOne).mockResolvedValue(null);

      const result = await getAttachmentById('123e4567-e89b-12d3-a456-426614174999');

      expect(result).toBeNull();
    });

    it('should validate UUID format', async () => {
      await expect(getAttachmentById('invalid-uuid')).rejects.toThrow('Invalid attachment ID format');
      expect(queryOne).not.toHaveBeenCalled();
    });
  });

  describe('listAttachmentsForTicket', () => {
    it('should list all attachments for a ticket', async () => {
      // 🟢 WORKING: Test listing attachments with filters
      const ticketId = 'ticket-uuid-123';

      const mockAttachments = [
        {
          id: 'attachment-uuid-111',
          ticket_id: ticketId,
          filename: 'photo1.jpg',
          file_type: FileType.PHOTO,
          mime_type: 'image/jpeg',
          file_size: 1024000,
          storage_path: 'tickets/ticket-uuid-123/photo1.jpg',
          storage_url: 'https://storage.googleapis.com/bucket/photo1.jpg',
          uploaded_by: 'user-uuid-456',
          uploaded_at: new Date('2024-01-15T10:00:00Z'),
          verification_step_id: 'step-uuid-789',
          is_evidence: true
        },
        {
          id: 'attachment-uuid-222',
          ticket_id: ticketId,
          filename: 'photo2.jpg',
          file_type: FileType.PHOTO,
          mime_type: 'image/jpeg',
          file_size: 2048000,
          storage_path: 'tickets/ticket-uuid-123/photo2.jpg',
          storage_url: 'https://storage.googleapis.com/bucket/photo2.jpg',
          uploaded_by: 'user-uuid-456',
          uploaded_at: new Date('2024-01-15T11:00:00Z'),
          verification_step_id: null,
          is_evidence: false
        }
      ];

      vi.mocked(query).mockResolvedValue({ rows: mockAttachments, rowCount: 2 });

      const result = await listAttachmentsForTicket(ticketId);

      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM ticket_attachments'),
        [ticketId]
      );

      expect(result.attachments).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.total_size_bytes).toBe(3072000); // 1MB + 2MB
      expect(result.evidence_count).toBe(1);
    });

    it('should filter by file type', async () => {
      const ticketId = 'ticket-uuid-123';
      const filters: AttachmentFilters = {
        file_type: FileType.PHOTO
      };

      const mockAttachments = [
        {
          id: 'attachment-uuid-111',
          ticket_id: ticketId,
          filename: 'photo.jpg',
          file_type: FileType.PHOTO,
          mime_type: 'image/jpeg',
          file_size: 1024000,
          storage_path: 'tickets/ticket-uuid-123/photo.jpg',
          storage_url: 'https://storage.googleapis.com/bucket/photo.jpg',
          uploaded_by: 'user-uuid-456',
          uploaded_at: new Date('2024-01-15T10:00:00Z'),
          verification_step_id: null,
          is_evidence: false
        }
      ];

      vi.mocked(query).mockResolvedValue({ rows: mockAttachments, rowCount: 1 });

      const result = await listAttachmentsForTicket(ticketId, filters);

      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('file_type = $2'),
        [ticketId, FileType.PHOTO]
      );

      expect(result.attachments).toHaveLength(1);
      expect(result.by_file_type[FileType.PHOTO]).toBe(1);
    });

    it('should filter by evidence flag', async () => {
      const ticketId = 'ticket-uuid-123';
      const filters: AttachmentFilters = {
        is_evidence: true
      };

      vi.mocked(query).mockResolvedValue({ rows: [], rowCount: 0 });

      await listAttachmentsForTicket(ticketId, filters);

      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('is_evidence = $2'),
        [ticketId, true]
      );
    });

    it('should filter by verification step', async () => {
      const ticketId = 'ticket-uuid-123';
      const filters: AttachmentFilters = {
        verification_step_id: 'step-uuid-789'
      };

      vi.mocked(query).mockResolvedValue({ rows: [], rowCount: 0 });

      await listAttachmentsForTicket(ticketId, filters);

      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('verification_step_id = $2'),
        [ticketId, 'step-uuid-789']
      );
    });

    it('should return empty result for ticket with no attachments', async () => {
      vi.mocked(query).mockResolvedValue({ rows: [], rowCount: 0 });

      const result = await listAttachmentsForTicket('ticket-uuid-999');

      expect(result.attachments).toHaveLength(0);
      expect(result.total).toBe(0);
      expect(result.total_size_bytes).toBe(0);
      expect(result.evidence_count).toBe(0);
    });
  });

  describe('deleteAttachment', () => {
    it('should delete attachment from both Firebase Storage and DB', async () => {
      // 🟢 WORKING: Test cascade delete (Storage + DB)
      const attachmentId = '123e4567-e89b-12d3-a456-426614174001';

      const mockAttachment = {
        id: attachmentId,
        ticket_id: '123e4567-e89b-12d3-a456-426614174000',
        filename: 'photo.jpg',
        file_type: FileType.PHOTO,
        mime_type: 'image/jpeg',
        file_size: 1024000,
        storage_path: 'tickets/ticket-uuid-123/photo.jpg',
        storage_url: 'https://storage.googleapis.com/bucket/photo.jpg',
        uploaded_by: 'user-uuid-456',
        uploaded_at: new Date('2024-01-15T10:00:00Z'),
        verification_step_id: null,
        is_evidence: false
      };

      // Mock get attachment
      vi.mocked(queryOne).mockResolvedValueOnce(mockAttachment);

      // Mock delete from DB
      vi.mocked(query).mockResolvedValue({ rows: [], rowCount: 1 });

      // Mock delete from Firebase Storage
      vi.mocked(deleteObject).mockResolvedValue(undefined);

      await deleteAttachment(attachmentId);

      // Verify Storage deletion
      expect(deleteObject).toHaveBeenCalled();

      // Verify DB deletion
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM ticket_attachments'),
        [attachmentId]
      );
    });

    it('should throw error if attachment not found', async () => {
      vi.mocked(queryOne).mockResolvedValue(null);

      await expect(deleteAttachment('123e4567-e89b-12d3-a456-426614174999')).rejects.toThrow('Attachment not found');
      expect(deleteObject).not.toHaveBeenCalled();
      expect(query).not.toHaveBeenCalled();
    });

    it('should continue DB deletion even if Storage deletion fails', async () => {
      const attachmentId = '123e4567-e89b-12d3-a456-426614174001';

      const mockAttachment = {
        id: attachmentId,
        storage_path: 'tickets/123e4567-e89b-12d3-a456-426614174000/photo.jpg',
        ticket_id: '123e4567-e89b-12d3-a456-426614174000',
        filename: 'photo.jpg',
        file_type: FileType.PHOTO,
        mime_type: 'image/jpeg',
        file_size: 1024000,
        storage_url: 'https://storage.googleapis.com/bucket/photo.jpg',
        uploaded_by: 'user-uuid-456',
        uploaded_at: new Date('2024-01-15T10:00:00Z'),
        verification_step_id: null,
        is_evidence: false
      };

      vi.mocked(queryOne).mockResolvedValueOnce(mockAttachment);
      vi.mocked(deleteObject).mockRejectedValue(new Error('Storage error'));
      vi.mocked(query).mockResolvedValue({ rows: [], rowCount: 1 });

      // Should not throw - logs warning and continues
      await deleteAttachment(attachmentId);

      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM ticket_attachments'),
        [attachmentId]
      );
    });

    it('should validate UUID format before deletion', async () => {
      await expect(deleteAttachment('invalid-uuid')).rejects.toThrow('Invalid attachment ID format');
      expect(queryOne).not.toHaveBeenCalled();
      expect(deleteObject).not.toHaveBeenCalled();
    });
  });

  describe('getPhotoEvidenceSummary', () => {
    it('should generate photo evidence summary for ticket', async () => {
      // 🟢 WORKING: Test photo evidence summary generation
      const ticketId = 'ticket-uuid-123';

      const mockAttachments = [
        {
          id: 'att-1',
          ticket_id: ticketId,
          filename: 'photo1.jpg',
          file_type: FileType.PHOTO,
          mime_type: 'image/jpeg',
          file_size: 1024000,
          storage_path: 'tickets/ticket-uuid-123/photo1.jpg',
          storage_url: 'https://storage.googleapis.com/bucket/photo1.jpg',
          uploaded_by: 'user-uuid-456',
          uploaded_at: new Date('2024-01-15T10:00:00Z'),
          verification_step_id: 'step-1',
          is_evidence: true
        },
        {
          id: 'att-2',
          ticket_id: ticketId,
          filename: 'photo2.jpg',
          file_type: FileType.PHOTO,
          mime_type: 'image/jpeg',
          file_size: 2048000,
          storage_path: 'tickets/ticket-uuid-123/photo2.jpg',
          storage_url: 'https://storage.googleapis.com/bucket/photo2.jpg',
          uploaded_by: 'user-uuid-456',
          uploaded_at: new Date('2024-01-15T11:00:00Z'),
          verification_step_id: 'step-1',
          is_evidence: true
        }
      ];

      // Mock verification steps query
      const mockSteps = [
        { step_number: 1, verification_step_id: 'step-1', photo_verified: true },
        { step_number: 2, verification_step_id: 'step-2', photo_verified: false }
      ];

      vi.mocked(query)
        .mockResolvedValueOnce({ rows: mockAttachments, rowCount: 2 }) // attachments query
        .mockResolvedValueOnce({ rows: mockSteps, rowCount: 2 }); // verification steps query

      const result = await getPhotoEvidenceSummary(ticketId);

      expect(result.ticket_id).toBe(ticketId);
      expect(result.total_photos).toBe(2);
      expect(result.verified_photos).toBe(2); // Both linked to verified step
      expect(result.unverified_photos).toBe(0);
      expect(result.total_size_mb).toBeCloseTo(2.93, 0); // ~3MB total
    });

    it('should handle ticket with no photos', async () => {
      const ticketId = 'ticket-uuid-999';

      vi.mocked(query)
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // no attachments
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // no steps

      const result = await getPhotoEvidenceSummary(ticketId);

      expect(result.total_photos).toBe(0);
      expect(result.verified_photos).toBe(0);
      expect(result.total_size_mb).toBe(0);
    });
  });

  describe('getAttachmentStatistics', () => {
    it('should calculate attachment statistics across all tickets', async () => {
      // 🟢 WORKING: Test statistics aggregation
      const mockStats = {
        total_attachments: 150,
        total_size_bytes: 5368709120, // 5GB
        photo_count: 100,
        pdf_count: 30,
        document_count: 15,
        excel_count: 5,
        evidence_photos: 80,
        attachments_this_month: 25
      };

      vi.mocked(queryOne).mockResolvedValue(mockStats);

      const result = await getAttachmentStatistics();

      expect(queryOne).toHaveBeenCalledWith(
        expect.stringContaining('COUNT(*)::int as total_attachments'),
        expect.any(Array)
      );

      expect(result.total_attachments).toBe(150);
      expect(result.total_size_gb).toBeCloseTo(5, 1);
      expect(result.by_file_type[FileType.PHOTO]).toBe(100);
      expect(result.evidence_photos).toBe(80);
      expect(result.attachments_this_month).toBe(25);
    });

    it('should handle zero attachments', async () => {
      vi.mocked(queryOne).mockResolvedValue({
        total_attachments: 0,
        total_size_bytes: 0,
        photo_count: 0,
        pdf_count: 0,
        document_count: 0,
        excel_count: 0,
        evidence_photos: 0,
        attachments_this_month: 0
      });

      const result = await getAttachmentStatistics();

      expect(result.total_attachments).toBe(0);
      expect(result.total_size_gb).toBe(0);
      expect(result.avg_file_size_mb).toBe(0);
    });
  });
});

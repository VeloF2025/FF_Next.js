/**
 * Attachment API Endpoints Integration Tests
 * 🟢 WORKING: Tests written FIRST following TDD methodology
 *
 * Tests the attachment API endpoints:
 * - POST /api/ticketing/tickets/[id]/attachments (upload)
 * - GET /api/ticketing/tickets/[id]/attachments (list)
 *
 * These tests should initially FAIL (red phase)
 * Implementation comes AFTER tests pass (green phase)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import * as attachmentService from '../../services/attachmentService';
import type {
  TicketAttachment,
  FileUploadResult,
  AttachmentListResponse,
  FileType
} from '../../types/attachment';

// Mock the attachment service
vi.mock('../../services/attachmentService');

// Mock logger
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  }),
}));

// Mock data
const mockTicketId = '123e4567-e89b-12d3-a456-426614174000';
const mockUserId = '987fcdeb-51a2-43d7-b123-456789abcdef';
const mockAttachmentId = '111e2222-e89b-12d3-a456-426614174000';

const mockAttachment: TicketAttachment = {
  id: mockAttachmentId,
  ticket_id: mockTicketId,
  filename: 'photo.jpg',
  file_type: 'photo' as FileType,
  mime_type: 'image/jpeg',
  file_size: 1024000,
  storage_path: 'tickets/123e4567/photo.jpg',
  storage_url: 'https://storage.googleapis.com/bucket/photo.jpg',
  uploaded_by: mockUserId,
  uploaded_at: new Date('2024-01-15T10:00:00Z'),
  verification_step_id: null,
  is_evidence: false,
};

const mockUploadResult: FileUploadResult = {
  attachment_id: mockAttachmentId,
  ticket_id: mockTicketId,
  filename: 'photo.jpg',
  storage_url: 'https://storage.googleapis.com/bucket/photo.jpg',
  storage_path: 'tickets/123e4567/photo.jpg',
  file_size: 1024000,
  mime_type: 'image/jpeg',
  uploaded_at: new Date('2024-01-15T10:00:00Z'),
};

const mockAttachmentList: AttachmentListResponse = {
  attachments: [mockAttachment],
  total: 1,
  total_size_bytes: 1024000,
  by_file_type: {
    photo: 1,
    pdf: 0,
    document: 0,
    excel: 0
  },
  evidence_count: 0
};

describe('POST /api/ticketing/tickets/[id]/attachments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should upload attachment successfully', async () => {
    // 🟢 WORKING: Test successful file upload
    vi.mocked(attachmentService.uploadAttachment).mockResolvedValue(mockUploadResult);

    const { POST } = await import('@/app/api/ticketing/tickets/[id]/attachments/route');

    // Create form data
    const formData = new FormData();
    const file = new File(['test content'], 'photo.jpg', { type: 'image/jpeg' });
    formData.append('file', file);
    formData.append('uploaded_by', mockUserId);
    formData.append('is_evidence', 'false');

    const request = new NextRequest('http://localhost/api/ticketing/tickets/' + mockTicketId + '/attachments', {
      method: 'POST',
      body: formData,
    });

    const response = await POST(request, { params: Promise.resolve({ id: mockTicketId }) });
    const json = await response.json();

    expect(response.status).toBe(201);
    expect(json.success).toBe(true);
    expect(json.data).toMatchObject({
      attachment_id: mockAttachmentId,
      ticket_id: mockTicketId,
      filename: 'photo.jpg'
    });
    expect(attachmentService.uploadAttachment).toHaveBeenCalledWith(
      expect.objectContaining({
        ticket_id: mockTicketId,
        filename: 'photo.jpg',
        uploaded_by: mockUserId,
        is_evidence: false
      })
    );
  });

  it('should upload attachment as evidence for verification step', async () => {
    const evidenceResult = {
      ...mockUploadResult,
      verification_step_id: '111e2222-e89b-12d3-a456-426614174001'
    };

    vi.mocked(attachmentService.uploadAttachment).mockResolvedValue(evidenceResult);

    const { POST } = await import('@/app/api/ticketing/tickets/[id]/attachments/route');

    const formData = new FormData();
    const file = new File(['test content'], 'evidence.jpg', { type: 'image/jpeg' });
    formData.append('file', file);
    formData.append('uploaded_by', mockUserId);
    formData.append('is_evidence', 'true');
    formData.append('verification_step_id', '111e2222-e89b-12d3-a456-426614174001');

    const request = new NextRequest('http://localhost/api/ticketing/tickets/' + mockTicketId + '/attachments', {
      method: 'POST',
      body: formData,
    });

    const response = await POST(request, { params: Promise.resolve({ id: mockTicketId }) });
    const json = await response.json();

    expect(response.status).toBe(201);
    expect(json.success).toBe(true);
    expect(attachmentService.uploadAttachment).toHaveBeenCalledWith(
      expect.objectContaining({
        is_evidence: true,
        verification_step_id: '111e2222-e89b-12d3-a456-426614174001'
      })
    );
  });

  it('should return 422 if no file provided', async () => {
    const { POST } = await import('@/app/api/ticketing/tickets/[id]/attachments/route');

    const formData = new FormData();
    formData.append('uploaded_by', mockUserId);

    const request = new NextRequest('http://localhost/api/ticketing/tickets/' + mockTicketId + '/attachments', {
      method: 'POST',
      body: formData,
    });

    const response = await POST(request, { params: Promise.resolve({ id: mockTicketId }) });
    const json = await response.json();

    expect(response.status).toBe(422);
    expect(json.success).toBe(false);
    expect(json.error?.message).toContain('file is required');
    expect(attachmentService.uploadAttachment).not.toHaveBeenCalled();
  });

  it('should return 422 if uploaded_by is missing', async () => {
    const { POST } = await import('@/app/api/ticketing/tickets/[id]/attachments/route');

    const formData = new FormData();
    const file = new File(['test content'], 'photo.jpg', { type: 'image/jpeg' });
    formData.append('file', file);

    const request = new NextRequest('http://localhost/api/ticketing/tickets/' + mockTicketId + '/attachments', {
      method: 'POST',
      body: formData,
    });

    const response = await POST(request, { params: Promise.resolve({ id: mockTicketId }) });
    const json = await response.json();

    expect(response.status).toBe(422);
    expect(json.success).toBe(false);
    expect(json.error?.message).toContain('uploaded_by is required');
    expect(attachmentService.uploadAttachment).not.toHaveBeenCalled();
  });

  it('should return 422 for invalid ticket ID format', async () => {
    const { POST } = await import('@/app/api/ticketing/tickets/[id]/attachments/route');

    const formData = new FormData();
    const file = new File(['test content'], 'photo.jpg', { type: 'image/jpeg' });
    formData.append('file', file);
    formData.append('uploaded_by', mockUserId);

    const request = new NextRequest('http://localhost/api/ticketing/tickets/invalid-uuid/attachments', {
      method: 'POST',
      body: formData,
    });

    const response = await POST(request, { params: Promise.resolve({ id: 'invalid-uuid' }) });
    const json = await response.json();

    expect(response.status).toBe(422);
    expect(json.success).toBe(false);
    expect(json.error?.message).toContain('Invalid ticket ID format');
    expect(attachmentService.uploadAttachment).not.toHaveBeenCalled();
  });

  it('should return 500 on upload service failure', async () => {
    vi.mocked(attachmentService.uploadAttachment).mockRejectedValue(
      new Error('Storage quota exceeded')
    );

    const { POST } = await import('@/app/api/ticketing/tickets/[id]/attachments/route');

    const formData = new FormData();
    const file = new File(['test content'], 'photo.jpg', { type: 'image/jpeg' });
    formData.append('file', file);
    formData.append('uploaded_by', mockUserId);

    const request = new NextRequest('http://localhost/api/ticketing/tickets/' + mockTicketId + '/attachments', {
      method: 'POST',
      body: formData,
    });

    const response = await POST(request, { params: Promise.resolve({ id: mockTicketId }) });
    const json = await response.json();

    expect(response.status).toBe(500);
    expect(json.success).toBe(false);
    expect(json.error?.message).toContain('Failed to upload attachment');
  });
});

describe('GET /api/ticketing/tickets/[id]/attachments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should list all attachments for a ticket', async () => {
    // 🟢 WORKING: Test listing attachments
    vi.mocked(attachmentService.listAttachmentsForTicket).mockResolvedValue(mockAttachmentList);

    const { GET } = await import('@/app/api/ticketing/tickets/[id]/attachments/route');

    const request = new NextRequest('http://localhost/api/ticketing/tickets/' + mockTicketId + '/attachments', {
      method: 'GET',
    });

    const response = await GET(request, { params: Promise.resolve({ id: mockTicketId }) });
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.attachments).toHaveLength(1);
    expect(json.data.total).toBe(1);
    expect(json.data.total_size_bytes).toBe(1024000);
    expect(attachmentService.listAttachmentsForTicket).toHaveBeenCalledWith(
      mockTicketId,
      undefined
    );
  });

  it('should filter attachments by file type', async () => {
    vi.mocked(attachmentService.listAttachmentsForTicket).mockResolvedValue(mockAttachmentList);

    const { GET } = await import('@/app/api/ticketing/tickets/[id]/attachments/route');

    const request = new NextRequest(
      'http://localhost/api/ticketing/tickets/' + mockTicketId + '/attachments?file_type=photo',
      { method: 'GET' }
    );

    const response = await GET(request, { params: Promise.resolve({ id: mockTicketId }) });
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(attachmentService.listAttachmentsForTicket).toHaveBeenCalledWith(
      mockTicketId,
      expect.objectContaining({ file_type: 'photo' })
    );
  });

  it('should filter attachments by evidence flag', async () => {
    const evidenceList = {
      ...mockAttachmentList,
      evidence_count: 1
    };

    vi.mocked(attachmentService.listAttachmentsForTicket).mockResolvedValue(evidenceList);

    const { GET } = await import('@/app/api/ticketing/tickets/[id]/attachments/route');

    const request = new NextRequest(
      'http://localhost/api/ticketing/tickets/' + mockTicketId + '/attachments?is_evidence=true',
      { method: 'GET' }
    );

    const response = await GET(request, { params: Promise.resolve({ id: mockTicketId }) });
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(attachmentService.listAttachmentsForTicket).toHaveBeenCalledWith(
      mockTicketId,
      expect.objectContaining({ is_evidence: true })
    );
  });

  it('should filter attachments by verification step', async () => {
    vi.mocked(attachmentService.listAttachmentsForTicket).mockResolvedValue(mockAttachmentList);

    const { GET } = await import('@/app/api/ticketing/tickets/[id]/attachments/route');

    const stepId = '111e2222-e89b-12d3-a456-426614174001';
    const request = new NextRequest(
      'http://localhost/api/ticketing/tickets/' + mockTicketId + '/attachments?verification_step_id=' + stepId,
      { method: 'GET' }
    );

    const response = await GET(request, { params: Promise.resolve({ id: mockTicketId }) });
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(attachmentService.listAttachmentsForTicket).toHaveBeenCalledWith(
      mockTicketId,
      expect.objectContaining({ verification_step_id: stepId })
    );
  });

  it('should return empty list for ticket with no attachments', async () => {
    const emptyList: AttachmentListResponse = {
      attachments: [],
      total: 0,
      total_size_bytes: 0,
      by_file_type: { photo: 0, pdf: 0, document: 0, excel: 0 },
      evidence_count: 0
    };

    vi.mocked(attachmentService.listAttachmentsForTicket).mockResolvedValue(emptyList);

    const { GET } = await import('@/app/api/ticketing/tickets/[id]/attachments/route');

    const request = new NextRequest('http://localhost/api/ticketing/tickets/' + mockTicketId + '/attachments', {
      method: 'GET',
    });

    const response = await GET(request, { params: Promise.resolve({ id: mockTicketId }) });
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.attachments).toHaveLength(0);
    expect(json.data.total).toBe(0);
  });

  it('should return 422 for invalid ticket ID format', async () => {
    const { GET } = await import('@/app/api/ticketing/tickets/[id]/attachments/route');

    const request = new NextRequest('http://localhost/api/ticketing/tickets/invalid-uuid/attachments', {
      method: 'GET',
    });

    const response = await GET(request, { params: Promise.resolve({ id: 'invalid-uuid' }) });
    const json = await response.json();

    expect(response.status).toBe(422);
    expect(json.success).toBe(false);
    expect(json.error?.message).toContain('Invalid ticket ID format');
    expect(attachmentService.listAttachmentsForTicket).not.toHaveBeenCalled();
  });

  it('should return 500 on service failure', async () => {
    vi.mocked(attachmentService.listAttachmentsForTicket).mockRejectedValue(
      new Error('Database connection failed')
    );

    const { GET } = await import('@/app/api/ticketing/tickets/[id]/attachments/route');

    const request = new NextRequest('http://localhost/api/ticketing/tickets/' + mockTicketId + '/attachments', {
      method: 'GET',
    });

    const response = await GET(request, { params: Promise.resolve({ id: mockTicketId }) });
    const json = await response.json();

    expect(response.status).toBe(500);
    expect(json.success).toBe(false);
    expect(json.error?.message).toContain('Failed to list attachments');
  });
});

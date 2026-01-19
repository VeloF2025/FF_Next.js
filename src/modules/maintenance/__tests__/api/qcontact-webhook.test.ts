/**
 * QContact Webhook API Integration Tests
 *
 * 🟢 WORKING: Tests written FIRST following TDD methodology
 *
 * Tests webhook endpoint:
 * - POST /api/ticketing/webhooks/qcontact - Receive QContact webhooks
 *
 * Test Strategy:
 * - Mock service layer to isolate webhook handler logic
 * - Test webhook signature verification
 * - Test different event types (created, updated, closed, assigned)
 * - Test invalid webhook handling
 * - Test webhook receipt logging
 * - Verify proper HTTP status codes and response formats
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { createHmac } from 'crypto';
import type { QContactTicket, QContactWebhookPayload } from '../../types/qcontact';
import { SyncType, SyncStatus } from '../../types/qcontact';

// Mock environment variables
process.env.QCONTACT_WEBHOOK_SECRET = 'test-webhook-secret-key';

// Helper to create HMAC signature
function createWebhookSignature(payload: string, secret: string): string {
  const hmac = createHmac('sha256', secret);
  hmac.update(payload);
  return hmac.digest('hex');
}

// Helper to create mock QContact ticket
function createMockQContactTicket(
  overrides: Partial<QContactTicket> = {}
): QContactTicket {
  return {
    id: 'qc-12345',
    title: 'Test Ticket',
    description: 'Test ticket description',
    status: 'open',
    priority: 'normal',
    created_at: '2024-01-01T10:00:00Z',
    updated_at: '2024-01-01T10:00:00Z',
    customer_name: 'John Doe',
    customer_phone: '+27123456789',
    customer_email: 'john@example.com',
    address: '123 Test St',
    assigned_to: null,
    category: 'maintenance',
    subcategory: null,
    custom_fields: {
      dr_number: 'DR001',
      pole_number: 'P123',
      pon_number: 'PON456',
    },
    ...overrides,
  };
}

// Helper to create mock webhook payload
function createMockWebhookPayload(
  event: QContactWebhookPayload['event'],
  ticket: QContactTicket
): QContactWebhookPayload {
  return {
    event,
    ticket_id: ticket.id,
    timestamp: new Date(),
    data: ticket,
    signature: '', // Will be set by test
  };
}

// Mock the sync service
vi.mock('../../services/qcontactSyncInbound', () => ({
  syncSingleInboundTicket: vi.fn(),
  mapQContactTicketToFibreFlow: vi.fn(),
}));

// Mock the database utilities
vi.mock('../../utils/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
}));

// Mock logger
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  }),
}));

describe('QContact Webhook API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ============================================================================
  // POST /api/ticketing/webhooks/qcontact - Webhook Receipt
  // ============================================================================

  describe('POST /api/ticketing/webhooks/qcontact', () => {
    it('should receive and process ticket.created webhook successfully', async () => {
      const { syncSingleInboundTicket } = await import(
        '../../services/qcontactSyncInbound'
      );

      const mockTicket = createMockQContactTicket();
      const webhookPayload = createMockWebhookPayload('ticket.created', mockTicket);

      // Mock successful sync
      vi.mocked(syncSingleInboundTicket).mockResolvedValue({
        success: true,
        sync_log_id: 'log-123',
        ticket_id: 'ticket-123',
        qcontact_ticket_id: mockTicket.id,
        error_message: null,
        synced_at: new Date(),
      });

      const { POST } = await import('@/app/api/ticketing/webhooks/qcontact/route');

      const payloadString = JSON.stringify(webhookPayload);
      const signature = createWebhookSignature(
        payloadString,
        process.env.QCONTACT_WEBHOOK_SECRET!
      );

      const request = new Request('http://localhost/api/ticketing/webhooks/qcontact', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-QContact-Signature': signature,
        },
        body: payloadString,
      });

      const response = await POST(request as any);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.event).toBe('ticket.created');
      expect(data.data.ticket_id).toBe(mockTicket.id);
      expect(data.data.processed).toBe(true);
      expect(syncSingleInboundTicket).toHaveBeenCalledWith(mockTicket);
    });

    it('should receive and process ticket.updated webhook successfully', async () => {
      const { syncSingleInboundTicket } = await import(
        '../../services/qcontactSyncInbound'
      );

      const mockTicket = createMockQContactTicket({
        status: 'in_progress',
        updated_at: '2024-01-02T10:00:00Z',
      });
      const webhookPayload = createMockWebhookPayload('ticket.updated', mockTicket);

      vi.mocked(syncSingleInboundTicket).mockResolvedValue({
        success: true,
        sync_log_id: 'log-456',
        ticket_id: 'ticket-123',
        qcontact_ticket_id: mockTicket.id,
        error_message: null,
        synced_at: new Date(),
      });

      const { POST } = await import('@/app/api/ticketing/webhooks/qcontact/route');

      const payloadString = JSON.stringify(webhookPayload);
      const signature = createWebhookSignature(
        payloadString,
        process.env.QCONTACT_WEBHOOK_SECRET!
      );

      const request = new Request('http://localhost/api/ticketing/webhooks/qcontact', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-QContact-Signature': signature,
        },
        body: payloadString,
      });

      const response = await POST(request as any);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.event).toBe('ticket.updated');
      expect(syncSingleInboundTicket).toHaveBeenCalledWith(mockTicket);
    });

    it('should receive and process ticket.closed webhook successfully', async () => {
      const { syncSingleInboundTicket } = await import(
        '../../services/qcontactSyncInbound'
      );

      const mockTicket = createMockQContactTicket({
        status: 'closed',
        updated_at: '2024-01-03T10:00:00Z',
      });
      const webhookPayload = createMockWebhookPayload('ticket.closed', mockTicket);

      vi.mocked(syncSingleInboundTicket).mockResolvedValue({
        success: true,
        sync_log_id: 'log-789',
        ticket_id: 'ticket-123',
        qcontact_ticket_id: mockTicket.id,
        error_message: null,
        synced_at: new Date(),
      });

      const { POST } = await import('@/app/api/ticketing/webhooks/qcontact/route');

      const payloadString = JSON.stringify(webhookPayload);
      const signature = createWebhookSignature(
        payloadString,
        process.env.QCONTACT_WEBHOOK_SECRET!
      );

      const request = new Request('http://localhost/api/ticketing/webhooks/qcontact', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-QContact-Signature': signature,
        },
        body: payloadString,
      });

      const response = await POST(request as any);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.event).toBe('ticket.closed');
      expect(syncSingleInboundTicket).toHaveBeenCalledWith(mockTicket);
    });

    it('should reject webhook with invalid signature', async () => {
      const mockTicket = createMockQContactTicket();
      const webhookPayload = createMockWebhookPayload('ticket.created', mockTicket);

      const { POST } = await import('@/app/api/ticketing/webhooks/qcontact/route');

      const payloadString = JSON.stringify(webhookPayload);
      const invalidSignature = 'invalid-signature';

      const request = new Request('http://localhost/api/ticketing/webhooks/qcontact', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-QContact-Signature': invalidSignature,
        },
        body: payloadString,
      });

      const response = await POST(request as any);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.success).toBe(false);
      expect(data.error).toContain('Invalid webhook signature');
    });

    it('should reject webhook with missing signature header', async () => {
      const mockTicket = createMockQContactTicket();
      const webhookPayload = createMockWebhookPayload('ticket.created', mockTicket);

      const { POST } = await import('@/app/api/ticketing/webhooks/qcontact/route');

      const payloadString = JSON.stringify(webhookPayload);

      const request = new Request('http://localhost/api/ticketing/webhooks/qcontact', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Missing X-QContact-Signature header
        },
        body: payloadString,
      });

      const response = await POST(request as any);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.success).toBe(false);
      expect(data.error).toContain('Missing webhook signature');
    });

    it('should reject webhook with invalid JSON payload', async () => {
      const { POST } = await import('@/app/api/ticketing/webhooks/qcontact/route');

      const invalidPayload = 'not valid json{';
      const signature = createWebhookSignature(
        invalidPayload,
        process.env.QCONTACT_WEBHOOK_SECRET!
      );

      const request = new Request('http://localhost/api/ticketing/webhooks/qcontact', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-QContact-Signature': signature,
        },
        body: invalidPayload,
      });

      const response = await POST(request as any);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toContain('Invalid JSON');
    });

    it('should handle webhook processing errors gracefully', async () => {
      const { syncSingleInboundTicket } = await import(
        '../../services/qcontactSyncInbound'
      );

      const mockTicket = createMockQContactTicket();
      const webhookPayload = createMockWebhookPayload('ticket.created', mockTicket);

      // Mock sync failure
      vi.mocked(syncSingleInboundTicket).mockResolvedValue({
        success: false,
        sync_log_id: 'log-error',
        ticket_id: null,
        qcontact_ticket_id: mockTicket.id,
        error_message: 'Database connection failed',
        synced_at: new Date(),
      });

      const { POST } = await import('@/app/api/ticketing/webhooks/qcontact/route');

      const payloadString = JSON.stringify(webhookPayload);
      const signature = createWebhookSignature(
        payloadString,
        process.env.QCONTACT_WEBHOOK_SECRET!
      );

      const request = new Request('http://localhost/api/ticketing/webhooks/qcontact', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-QContact-Signature': signature,
        },
        body: payloadString,
      });

      const response = await POST(request as any);
      const data = await response.json();

      // Webhook should still return 200 to prevent retries for non-recoverable errors
      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.processed).toBe(false);
      expect(data.data.error).toBe('Database connection failed');
    });

    it('should log webhook receipt to database', async () => {
      const { syncSingleInboundTicket } = await import(
        '../../services/qcontactSyncInbound'
      );
      const { queryOne } = await import('../../utils/db');

      const mockTicket = createMockQContactTicket();
      const webhookPayload = createMockWebhookPayload('ticket.created', mockTicket);

      vi.mocked(syncSingleInboundTicket).mockResolvedValue({
        success: true,
        sync_log_id: 'log-123',
        ticket_id: 'ticket-123',
        qcontact_ticket_id: mockTicket.id,
        error_message: null,
        synced_at: new Date(),
      });

      vi.mocked(queryOne).mockResolvedValue({ id: 'webhook-log-123' });

      const { POST } = await import('@/app/api/ticketing/webhooks/qcontact/route');

      const payloadString = JSON.stringify(webhookPayload);
      const signature = createWebhookSignature(
        payloadString,
        process.env.QCONTACT_WEBHOOK_SECRET!
      );

      const request = new Request('http://localhost/api/ticketing/webhooks/qcontact', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-QContact-Signature': signature,
        },
        body: payloadString,
      });

      const response = await POST(request as any);

      expect(response.status).toBe(200);
      // Verify webhook receipt was logged
      expect(queryOne).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO qcontact_sync_log'),
        expect.arrayContaining([
          expect.stringContaining('qc-12345'), // qcontact_ticket_id
          expect.stringContaining('inbound'),
        ])
      );
    });

    it('should handle ticket.assigned webhook event', async () => {
      const { syncSingleInboundTicket } = await import(
        '../../services/qcontactSyncInbound'
      );

      const mockTicket = createMockQContactTicket({
        assigned_to: 'tech-123',
      });
      const webhookPayload = createMockWebhookPayload('ticket.assigned', mockTicket);

      vi.mocked(syncSingleInboundTicket).mockResolvedValue({
        success: true,
        sync_log_id: 'log-assigned',
        ticket_id: 'ticket-123',
        qcontact_ticket_id: mockTicket.id,
        error_message: null,
        synced_at: new Date(),
      });

      const { POST } = await import('@/app/api/ticketing/webhooks/qcontact/route');

      const payloadString = JSON.stringify(webhookPayload);
      const signature = createWebhookSignature(
        payloadString,
        process.env.QCONTACT_WEBHOOK_SECRET!
      );

      const request = new Request('http://localhost/api/ticketing/webhooks/qcontact', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-QContact-Signature': signature,
        },
        body: payloadString,
      });

      const response = await POST(request as any);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.event).toBe('ticket.assigned');
      expect(syncSingleInboundTicket).toHaveBeenCalledWith(mockTicket);
    });
  });
});

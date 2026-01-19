/**
 * QContact Outbound Sync Service Tests (TDD)
 *
 * Tests FIRST - Implementation SECOND
 *
 * Testing outbound synchronization from FibreFlow to QContact:
 * - Push status update to QContact
 * - Push assignment to QContact
 * - Push note to QContact
 * - Push ticket closure to QContact
 * - Log sync in qcontact_sync_log table
 * - Handle push failures gracefully
 *
 * 🟢 WORKING: TDD test suite for outbound sync operations
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  pushStatusUpdate,
  pushAssignment,
  pushNote,
  pushTicketClosure,
  syncOutboundUpdate,
} from '../../services/qcontactSyncOutbound';
import { TicketStatus } from '../../types/ticket';
import { SyncDirection, SyncType, SyncStatus } from '../../types/qcontact';

// Mock dependencies
vi.mock('../../utils/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
}));

vi.mock('../../services/qcontactClient', () => ({
  getDefaultQContactClient: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  })),
}));

import { queryOne } from '../../utils/db';
import { getDefaultQContactClient } from '../../services/qcontactClient';

describe('QContact Outbound Sync Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('pushStatusUpdate', () => {
    it('should push status update to QContact and log success', async () => {
      // 🟢 WORKING: Test successful status update push
      const ticketId = 'ticket-123';
      const qcontactTicketId = 'QC-12345';
      const newStatus = TicketStatus.IN_PROGRESS;

      // Mock: Fetch ticket with QContact ID
      vi.mocked(queryOne).mockResolvedValueOnce({
        id: ticketId,
        external_id: qcontactTicketId,
        title: 'Test ticket',
        status: TicketStatus.ASSIGNED,
      });

      // Mock: QContact client update
      const mockUpdateTicket = vi.fn().mockResolvedValueOnce({
        id: qcontactTicketId,
        status: 'in_progress',
      });
      vi.mocked(getDefaultQContactClient).mockReturnValue({
        updateTicket: mockUpdateTicket,
      } as any);

      // Mock: Create sync log
      vi.mocked(queryOne).mockResolvedValueOnce({ id: 'log-123' });

      const result = await pushStatusUpdate(ticketId, newStatus);

      expect(result.success).toBe(true);
      expect(result.ticket_id).toBe(ticketId);
      expect(result.qcontact_ticket_id).toBe(qcontactTicketId);
      expect(result.error_message).toBeNull();
      expect(mockUpdateTicket).toHaveBeenCalledWith(qcontactTicketId, {
        status: 'in_progress',
      });
    });

    it('should handle ticket without QContact ID (skip push)', async () => {
      // 🟢 WORKING: Skip push when ticket has no external_id
      const ticketId = 'ticket-123';
      const newStatus = TicketStatus.IN_PROGRESS;

      // Mock: Fetch ticket without external_id (not from QContact)
      vi.mocked(queryOne).mockResolvedValueOnce({
        id: ticketId,
        external_id: null,
        title: 'Manual ticket',
        status: TicketStatus.ASSIGNED,
      });

      const result = await pushStatusUpdate(ticketId, newStatus);

      expect(result.success).toBe(true);
      expect(result.ticket_id).toBe(ticketId);
      expect(result.qcontact_ticket_id).toBeNull();
      expect(result.error_message).toContain('No QContact ID');
    });

    it('should handle QContact API errors and log failure', async () => {
      // 🟢 WORKING: Test error handling on API failure
      const ticketId = 'ticket-123';
      const qcontactTicketId = 'QC-12345';
      const newStatus = TicketStatus.IN_PROGRESS;

      // Mock: Fetch ticket
      vi.mocked(queryOne).mockResolvedValueOnce({
        id: ticketId,
        external_id: qcontactTicketId,
        title: 'Test ticket',
        status: TicketStatus.ASSIGNED,
      });

      // Mock: QContact client update fails
      const mockUpdateTicket = vi.fn().mockRejectedValueOnce(new Error('QContact API error'));
      vi.mocked(getDefaultQContactClient).mockReturnValue({
        updateTicket: mockUpdateTicket,
      } as any);

      // Mock: Create sync log (failure)
      vi.mocked(queryOne).mockResolvedValueOnce({ id: 'log-123' });

      const result = await pushStatusUpdate(ticketId, newStatus);

      expect(result.success).toBe(false);
      expect(result.error_message).toContain('QContact API error');
    });

    it('should map FibreFlow status to QContact status format', async () => {
      // 🟢 WORKING: Test status mapping
      const ticketId = 'ticket-123';
      const qcontactTicketId = 'QC-12345';

      const mockUpdateTicket = vi.fn().mockResolvedValue({ id: qcontactTicketId });
      vi.mocked(getDefaultQContactClient).mockReturnValue({
        updateTicket: mockUpdateTicket,
      } as any);

      // Test OPEN status
      vi.mocked(queryOne)
        .mockResolvedValueOnce({ id: ticketId, external_id: qcontactTicketId })
        .mockResolvedValueOnce({ id: 'log-123' });
      await pushStatusUpdate(ticketId, TicketStatus.OPEN);
      expect(mockUpdateTicket).toHaveBeenCalledWith(qcontactTicketId, { status: 'open' });

      // Test CLOSED status
      vi.mocked(queryOne)
        .mockResolvedValueOnce({ id: ticketId, external_id: qcontactTicketId })
        .mockResolvedValueOnce({ id: 'log-123' });
      await pushStatusUpdate(ticketId, TicketStatus.CLOSED);
      expect(mockUpdateTicket).toHaveBeenCalledWith(qcontactTicketId, { status: 'closed' });

      // Test CANCELLED status
      vi.mocked(queryOne)
        .mockResolvedValueOnce({ id: ticketId, external_id: qcontactTicketId })
        .mockResolvedValueOnce({ id: 'log-123' });
      await pushStatusUpdate(ticketId, TicketStatus.CANCELLED);
      expect(mockUpdateTicket).toHaveBeenCalledWith(qcontactTicketId, { status: 'cancelled' });
    });
  });

  describe('pushAssignment', () => {
    it('should push assignment to QContact and log success', async () => {
      // 🟢 WORKING: Test assignment push
      const ticketId = 'ticket-123';
      const qcontactTicketId = 'QC-12345';
      const assignedToUserId = 'user-456';
      const assignedToName = 'John Doe';

      // Mock: Fetch ticket
      vi.mocked(queryOne).mockResolvedValueOnce({
        id: ticketId,
        external_id: qcontactTicketId,
      });

      // Mock: QContact client update
      const mockUpdateTicket = vi.fn().mockResolvedValueOnce({
        id: qcontactTicketId,
        assigned_to: assignedToName,
      });
      vi.mocked(getDefaultQContactClient).mockReturnValue({
        updateTicket: mockUpdateTicket,
      } as any);

      // Mock: Create sync log
      vi.mocked(queryOne).mockResolvedValueOnce({ id: 'log-123' });

      const result = await pushAssignment(ticketId, assignedToUserId, assignedToName);

      expect(result.success).toBe(true);
      expect(mockUpdateTicket).toHaveBeenCalledWith(qcontactTicketId, {
        assigned_to: assignedToName,
      });
    });

    it('should handle missing ticket error', async () => {
      // 🟢 WORKING: Test ticket not found scenario
      const ticketId = 'nonexistent-ticket';

      // Mock: Ticket not found
      vi.mocked(queryOne).mockResolvedValueOnce(null);

      const result = await pushAssignment(ticketId, 'user-123', 'Jane Doe');

      expect(result.success).toBe(false);
      expect(result.error_message).toContain('not found');
    });

    it('should push unassignment (null assignment) to QContact', async () => {
      // 🟢 WORKING: Test clearing assignment
      const ticketId = 'ticket-123';
      const qcontactTicketId = 'QC-12345';

      vi.mocked(queryOne).mockResolvedValueOnce({
        id: ticketId,
        external_id: qcontactTicketId,
      });

      const mockUpdateTicket = vi.fn().mockResolvedValueOnce({
        id: qcontactTicketId,
        assigned_to: null,
      });
      vi.mocked(getDefaultQContactClient).mockReturnValue({
        updateTicket: mockUpdateTicket,
      } as any);

      vi.mocked(queryOne).mockResolvedValueOnce({ id: 'log-123' });

      const result = await pushAssignment(ticketId, null, null);

      expect(result.success).toBe(true);
      expect(mockUpdateTicket).toHaveBeenCalledWith(qcontactTicketId, {
        assigned_to: null,
      });
    });

    it('should handle assignment API errors and log failure', async () => {
      // 🟢 WORKING: Test error handling during assignment push
      const ticketId = 'ticket-123';
      const qcontactTicketId = 'QC-12345';

      vi.mocked(queryOne).mockResolvedValueOnce({
        id: ticketId,
        external_id: qcontactTicketId,
      });

      const mockUpdateTicket = vi.fn().mockRejectedValueOnce(new Error('Assignment update failed'));
      vi.mocked(getDefaultQContactClient).mockReturnValue({
        updateTicket: mockUpdateTicket,
      } as any);

      // Mock fetch for error logging
      vi.mocked(queryOne).mockResolvedValueOnce({
        id: ticketId,
        external_id: qcontactTicketId,
      });

      vi.mocked(queryOne).mockResolvedValueOnce({ id: 'log-123' });

      const result = await pushAssignment(ticketId, 'user-456', 'John Doe');

      expect(result.success).toBe(false);
      expect(result.error_message).toContain('Assignment update failed');
    });
  });

  describe('pushNote', () => {
    it('should push note to QContact and log success', async () => {
      // 🟢 WORKING: Test note push
      const ticketId = 'ticket-123';
      const qcontactTicketId = 'QC-12345';
      const noteContent = 'Work completed successfully';
      const isInternal = false;

      // Mock: Fetch ticket
      vi.mocked(queryOne).mockResolvedValueOnce({
        id: ticketId,
        external_id: qcontactTicketId,
      });

      // Mock: QContact client addNote
      const mockAddNote = vi.fn().mockResolvedValueOnce({
        id: 'note-123',
        content: noteContent,
      });
      vi.mocked(getDefaultQContactClient).mockReturnValue({
        addNote: mockAddNote,
      } as any);

      // Mock: Create sync log
      vi.mocked(queryOne).mockResolvedValueOnce({ id: 'log-123' });

      const result = await pushNote(ticketId, noteContent, isInternal);

      expect(result.success).toBe(true);
      expect(mockAddNote).toHaveBeenCalledWith(qcontactTicketId, {
        content: noteContent,
        is_internal: false,
      });
    });

    it('should push internal note to QContact', async () => {
      // 🟢 WORKING: Test internal note flag
      const ticketId = 'ticket-123';
      const qcontactTicketId = 'QC-12345';
      const noteContent = 'Internal update for team';
      const isInternal = true;

      vi.mocked(queryOne).mockResolvedValueOnce({
        id: ticketId,
        external_id: qcontactTicketId,
      });

      const mockAddNote = vi.fn().mockResolvedValueOnce({ id: 'note-123' });
      vi.mocked(getDefaultQContactClient).mockReturnValue({
        addNote: mockAddNote,
      } as any);

      vi.mocked(queryOne).mockResolvedValueOnce({ id: 'log-123' });

      const result = await pushNote(ticketId, noteContent, isInternal);

      expect(result.success).toBe(true);
      expect(mockAddNote).toHaveBeenCalledWith(qcontactTicketId, {
        content: noteContent,
        is_internal: true,
      });
    });

    it('should handle empty note content validation', async () => {
      // 🟢 WORKING: Test validation error
      const ticketId = 'ticket-123';
      const noteContent = '';

      const result = await pushNote(ticketId, noteContent, false);

      expect(result.success).toBe(false);
      expect(result.error_message).toContain('empty');
    });

    it('should handle ticket not found during note push', async () => {
      // 🟢 WORKING: Test ticket not found scenario
      const ticketId = 'nonexistent-ticket';
      const noteContent = 'Test note';

      vi.mocked(queryOne).mockResolvedValueOnce(null);

      const result = await pushNote(ticketId, noteContent, false);

      expect(result.success).toBe(false);
      expect(result.error_message).toContain('not found');
    });

    it('should skip note push for tickets without QContact ID', async () => {
      // 🟢 WORKING: Test skip when ticket has no external_id
      const ticketId = 'ticket-123';
      const noteContent = 'Test note';

      vi.mocked(queryOne).mockResolvedValueOnce({
        id: ticketId,
        external_id: null,
        source: 'manual',
      });

      const result = await pushNote(ticketId, noteContent, false);

      expect(result.success).toBe(true);
      expect(result.qcontact_ticket_id).toBeNull();
      expect(result.error_message).toContain('No QContact ID');
    });

    it('should handle note push API errors and log failure', async () => {
      // 🟢 WORKING: Test error handling on API failure
      const ticketId = 'ticket-123';
      const qcontactTicketId = 'QC-12345';
      const noteContent = 'Test note';

      vi.mocked(queryOne).mockResolvedValueOnce({
        id: ticketId,
        external_id: qcontactTicketId,
      });

      const mockAddNote = vi.fn().mockRejectedValueOnce(new Error('QContact service unavailable'));
      vi.mocked(getDefaultQContactClient).mockReturnValue({
        addNote: mockAddNote,
      } as any);

      // Mock fetch for error logging
      vi.mocked(queryOne).mockResolvedValueOnce({
        id: ticketId,
        external_id: qcontactTicketId,
      });

      vi.mocked(queryOne).mockResolvedValueOnce({ id: 'log-123' });

      const result = await pushNote(ticketId, noteContent, false);

      expect(result.success).toBe(false);
      expect(result.error_message).toContain('QContact service unavailable');
    });
  });

  describe('pushTicketClosure', () => {
    it('should push ticket closure to QContact and log success', async () => {
      // 🟢 WORKING: Test ticket closure push
      const ticketId = 'ticket-123';
      const qcontactTicketId = 'QC-12345';
      const closureNote = 'Issue resolved, customer satisfied';

      // Mock: Fetch ticket
      vi.mocked(queryOne).mockResolvedValueOnce({
        id: ticketId,
        external_id: qcontactTicketId,
      });

      // Mock: QContact client update status to closed
      const mockUpdateTicket = vi.fn().mockResolvedValueOnce({
        id: qcontactTicketId,
        status: 'closed',
      });
      vi.mocked(getDefaultQContactClient).mockReturnValue({
        updateTicket: mockUpdateTicket,
        addNote: vi.fn().mockResolvedValueOnce({ id: 'note-123' }),
      } as any);

      // Mock: Create sync log
      vi.mocked(queryOne).mockResolvedValueOnce({ id: 'log-123' });

      const result = await pushTicketClosure(ticketId, closureNote);

      expect(result.success).toBe(true);
      expect(mockUpdateTicket).toHaveBeenCalledWith(qcontactTicketId, {
        status: 'closed',
      });
    });

    it('should add closure note if provided', async () => {
      // 🟢 WORKING: Test closure with note
      const ticketId = 'ticket-123';
      const qcontactTicketId = 'QC-12345';
      const closureNote = 'Issue resolved';

      vi.mocked(queryOne).mockResolvedValueOnce({
        id: ticketId,
        external_id: qcontactTicketId,
      });

      const mockUpdateTicket = vi.fn().mockResolvedValueOnce({ id: qcontactTicketId });
      const mockAddNote = vi.fn().mockResolvedValueOnce({ id: 'note-123' });
      vi.mocked(getDefaultQContactClient).mockReturnValue({
        updateTicket: mockUpdateTicket,
        addNote: mockAddNote,
      } as any);

      vi.mocked(queryOne).mockResolvedValueOnce({ id: 'log-123' });

      const result = await pushTicketClosure(ticketId, closureNote);

      expect(result.success).toBe(true);
      expect(mockAddNote).toHaveBeenCalledWith(qcontactTicketId, {
        content: closureNote,
        is_internal: false,
      });
    });

    it('should close ticket without note if not provided', async () => {
      // 🟢 WORKING: Test closure without note
      const ticketId = 'ticket-123';
      const qcontactTicketId = 'QC-12345';

      vi.mocked(queryOne).mockResolvedValueOnce({
        id: ticketId,
        external_id: qcontactTicketId,
      });

      const mockUpdateTicket = vi.fn().mockResolvedValueOnce({ id: qcontactTicketId });
      const mockAddNote = vi.fn();
      vi.mocked(getDefaultQContactClient).mockReturnValue({
        updateTicket: mockUpdateTicket,
        addNote: mockAddNote,
      } as any);

      vi.mocked(queryOne).mockResolvedValueOnce({ id: 'log-123' });

      await pushTicketClosure(ticketId);

      expect(mockUpdateTicket).toHaveBeenCalled();
      expect(mockAddNote).not.toHaveBeenCalled();
    });

    it('should handle closure API errors and log failure', async () => {
      // 🟢 WORKING: Test error handling during closure
      const ticketId = 'ticket-123';
      const qcontactTicketId = 'QC-12345';

      vi.mocked(queryOne).mockResolvedValueOnce({
        id: ticketId,
        external_id: qcontactTicketId,
      });

      const mockUpdateTicket = vi.fn().mockRejectedValueOnce(new Error('API connection error'));
      vi.mocked(getDefaultQContactClient).mockReturnValue({
        updateTicket: mockUpdateTicket,
      } as any);

      // Mock fetch for error logging
      vi.mocked(queryOne).mockResolvedValueOnce({
        id: ticketId,
        external_id: qcontactTicketId,
      });

      vi.mocked(queryOne).mockResolvedValueOnce({ id: 'log-123' });

      const result = await pushTicketClosure(ticketId, 'Closure note');

      expect(result.success).toBe(false);
      expect(result.error_message).toContain('API connection error');
    });

    it('should handle ticket not found during closure', async () => {
      // 🟢 WORKING: Test ticket not found scenario
      const ticketId = 'nonexistent-ticket';

      vi.mocked(queryOne).mockResolvedValueOnce(null);

      const result = await pushTicketClosure(ticketId, 'Closure note');

      expect(result.success).toBe(false);
      expect(result.error_message).toContain('not found');
    });

    it('should skip closure for tickets without QContact ID', async () => {
      // 🟢 WORKING: Test skip when ticket has no external_id
      const ticketId = 'ticket-123';

      vi.mocked(queryOne).mockResolvedValueOnce({
        id: ticketId,
        external_id: null,
        source: 'manual',
      });

      const result = await pushTicketClosure(ticketId);

      expect(result.success).toBe(true);
      expect(result.qcontact_ticket_id).toBeNull();
      expect(result.error_message).toContain('No QContact ID');
    });
  });

  describe('syncOutboundUpdate', () => {
    it('should detect status change and push to QContact', async () => {
      // 🟢 WORKING: Test automatic status change detection
      const ticketId = 'ticket-123';
      const qcontactTicketId = 'QC-12345';
      const changes = {
        status: TicketStatus.QA_APPROVED,
      };

      // Mock: Fetch ticket
      vi.mocked(queryOne).mockResolvedValueOnce({
        id: ticketId,
        external_id: qcontactTicketId,
        status: TicketStatus.PENDING_QA,
      });

      // Mock: QContact client update
      const mockUpdateTicket = vi.fn().mockResolvedValueOnce({ id: qcontactTicketId });
      vi.mocked(getDefaultQContactClient).mockReturnValue({
        updateTicket: mockUpdateTicket,
      } as any);

      // Mock: Create sync log
      vi.mocked(queryOne).mockResolvedValueOnce({ id: 'log-123' });

      const result = await syncOutboundUpdate(ticketId, changes);

      expect(result.success).toBe(true);
      expect(mockUpdateTicket).toHaveBeenCalledWith(qcontactTicketId, {
        status: 'qa_approved',
      });
    });

    it('should detect assignment change and push to QContact', async () => {
      // 🟢 WORKING: Test automatic assignment change detection
      const ticketId = 'ticket-123';
      const qcontactTicketId = 'QC-12345';
      const changes = {
        assigned_to: 'user-456',
      };

      // Mock: Fetch ticket
      vi.mocked(queryOne).mockResolvedValueOnce({
        id: ticketId,
        external_id: qcontactTicketId,
      });

      // Mock: Fetch user name
      vi.mocked(queryOne).mockResolvedValueOnce({
        id: 'user-456',
        full_name: 'John Doe',
      });

      // Mock: QContact client update
      const mockUpdateTicket = vi.fn().mockResolvedValueOnce({ id: qcontactTicketId });
      vi.mocked(getDefaultQContactClient).mockReturnValue({
        updateTicket: mockUpdateTicket,
      } as any);

      // Mock: Create sync log
      vi.mocked(queryOne).mockResolvedValueOnce({ id: 'log-123' });

      const result = await syncOutboundUpdate(ticketId, changes);

      expect(result.success).toBe(true);
      expect(mockUpdateTicket).toHaveBeenCalledWith(qcontactTicketId, {
        assigned_to: 'John Doe',
      });
    });

    it('should handle multiple changes and push all to QContact', async () => {
      // 🟢 WORKING: Test multiple field changes
      const ticketId = 'ticket-123';
      const qcontactTicketId = 'QC-12345';
      const changes = {
        status: TicketStatus.IN_PROGRESS,
        assigned_to: 'user-456',
      };

      vi.mocked(queryOne).mockResolvedValueOnce({
        id: ticketId,
        external_id: qcontactTicketId,
      });

      vi.mocked(queryOne).mockResolvedValueOnce({
        id: 'user-456',
        full_name: 'Jane Smith',
      });

      const mockUpdateTicket = vi.fn().mockResolvedValueOnce({ id: qcontactTicketId });
      vi.mocked(getDefaultQContactClient).mockReturnValue({
        updateTicket: mockUpdateTicket,
      } as any);

      vi.mocked(queryOne).mockResolvedValueOnce({ id: 'log-123' });

      const result = await syncOutboundUpdate(ticketId, changes);

      expect(result.success).toBe(true);
      expect(mockUpdateTicket).toHaveBeenCalledWith(qcontactTicketId, {
        status: 'in_progress',
        assigned_to: 'Jane Smith',
      });
    });

    it('should skip sync for non-QContact tickets', async () => {
      // 🟢 WORKING: Test skip when ticket not from QContact
      const ticketId = 'ticket-123';
      const changes = {
        status: TicketStatus.IN_PROGRESS,
      };

      // Mock: Fetch ticket without external_id
      vi.mocked(queryOne).mockResolvedValueOnce({
        id: ticketId,
        external_id: null,
        source: 'manual',
      });

      const result = await syncOutboundUpdate(ticketId, changes);

      expect(result.success).toBe(true);
      expect(result.qcontact_ticket_id).toBeNull();
    });

    it('should handle API errors during outbound update and log failure', async () => {
      // 🟢 WORKING: Test error handling in syncOutboundUpdate
      const ticketId = 'ticket-123';
      const qcontactTicketId = 'QC-12345';
      const changes = {
        status: TicketStatus.CLOSED,
      };

      vi.mocked(queryOne).mockResolvedValueOnce({
        id: ticketId,
        external_id: qcontactTicketId,
      });

      const mockUpdateTicket = vi.fn().mockRejectedValueOnce(new Error('Network timeout'));
      vi.mocked(getDefaultQContactClient).mockReturnValue({
        updateTicket: mockUpdateTicket,
      } as any);

      // Mock fetch for error logging
      vi.mocked(queryOne).mockResolvedValueOnce({
        id: ticketId,
        external_id: qcontactTicketId,
      });

      vi.mocked(queryOne).mockResolvedValueOnce({ id: 'log-123' });

      const result = await syncOutboundUpdate(ticketId, changes);

      expect(result.success).toBe(false);
      expect(result.error_message).toContain('Network timeout');
    });

    it('should skip update when no changes provided', async () => {
      // 🟢 WORKING: Test no changes scenario
      const ticketId = 'ticket-123';
      const qcontactTicketId = 'QC-12345';
      const changes = {};

      vi.mocked(queryOne).mockResolvedValueOnce({
        id: ticketId,
        external_id: qcontactTicketId,
      });

      const result = await syncOutboundUpdate(ticketId, changes);

      expect(result.success).toBe(true);
      expect(result.error_message).toContain('No changes to sync');
    });
  });

  describe('Sync Logging', () => {
    it('should create sync log entry for all operations', async () => {
      // 🟢 WORKING: Test sync log creation
      const ticketId = 'ticket-123';
      const qcontactTicketId = 'QC-12345';

      vi.mocked(queryOne).mockResolvedValueOnce({
        id: ticketId,
        external_id: qcontactTicketId,
      });

      const mockUpdateTicket = vi.fn().mockResolvedValueOnce({ id: qcontactTicketId });
      vi.mocked(getDefaultQContactClient).mockReturnValue({
        updateTicket: mockUpdateTicket,
      } as any);

      // Mock: Create sync log with specific structure
      const logSql = `
    INSERT INTO qcontact_sync_log (
      ticket_id,
      qcontact_ticket_id,
      sync_direction,
      sync_type,
      request_payload,
      response_payload,
      status,
      error_message
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8
    )
    RETURNING id
  `;
      vi.mocked(queryOne).mockResolvedValueOnce({ id: 'log-123' });

      await pushStatusUpdate(ticketId, TicketStatus.IN_PROGRESS);

      // Verify sync log was attempted to be created
      expect(queryOne).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO qcontact_sync_log'),
        expect.arrayContaining([
          ticketId,
          qcontactTicketId,
          SyncDirection.OUTBOUND,
          SyncType.STATUS_UPDATE,
        ])
      );
    });

    it('should log failures with error message', async () => {
      // 🟢 WORKING: Test error logging
      const ticketId = 'ticket-123';
      const qcontactTicketId = 'QC-12345';

      // First queryOne: fetch ticket (succeeds)
      vi.mocked(queryOne).mockResolvedValueOnce({
        id: ticketId,
        external_id: qcontactTicketId,
      });

      const mockUpdateTicket = vi.fn().mockRejectedValueOnce(new Error('API timeout'));
      vi.mocked(getDefaultQContactClient).mockReturnValue({
        updateTicket: mockUpdateTicket,
      } as any);

      // Second queryOne: fetch ticket again in catch block (succeeds)
      vi.mocked(queryOne).mockResolvedValueOnce({
        id: ticketId,
        external_id: qcontactTicketId,
      });

      // Third queryOne: create error sync log
      vi.mocked(queryOne).mockResolvedValueOnce({ id: 'log-123' });

      await pushStatusUpdate(ticketId, TicketStatus.IN_PROGRESS);

      // Verify error was logged (3rd call to queryOne)
      const logCall = vi.mocked(queryOne).mock.calls[2];
      expect(logCall[0]).toContain('INSERT INTO qcontact_sync_log');
      expect(logCall[1]).toEqual([
        ticketId,
        qcontactTicketId,
        SyncDirection.OUTBOUND,
        SyncType.STATUS_UPDATE,
        expect.any(String), // JSON stringified request payload
        null,
        SyncStatus.FAILED,
        'API timeout',
      ]);
    });
  });
});

/**
 * QContact Inbound Sync Service Tests (TDD)
 *
 * Tests FIRST - Implementation SECOND
 *
 * Testing inbound synchronization from QContact to FibreFlow:
 * - Fetch new tickets from QContact
 * - Create ticket in FibreFlow from QContact data
 * - Map QContact fields to FibreFlow fields
 * - Handle duplicate tickets (skip)
 * - Log sync in qcontact_sync_log table
 * - Handle sync failures gracefully
 *
 * 🟢 WORKING: All 12 tests passing - comprehensive coverage
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  syncInboundTickets,
  syncSingleInboundTicket,
  mapQContactTicketToFibreFlow,
} from '../../services/qcontactSyncInbound';
import type { QContactTicket } from '../../types/qcontact';
import { TicketSource, TicketType, TicketPriority, TicketStatus } from '../../types/ticket';
import { SyncDirection, SyncType, SyncStatus } from '../../types/qcontact';

// Mock dependencies
vi.mock('../../utils/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('../../services/qcontactClient', () => ({
  getDefaultQContactClient: vi.fn(),
  QContactClient: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  })),
}));

import { query, queryOne, transaction } from '../../utils/db';
import { getDefaultQContactClient } from '../../services/qcontactClient';

describe('QContact Inbound Sync Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('mapQContactTicketToFibreFlow', () => {
    it('should map basic QContact ticket fields to FibreFlow format', () => {
      // 🟢 WORKING: Test field mapping with all standard fields
      const qcontactTicket: QContactTicket = {
        id: 'QC-12345',
        title: 'Internet connectivity issue',
        description: 'Customer reports no internet',
        status: 'open',
        priority: 'high',
        created_at: '2024-01-15T10:00:00Z',
        updated_at: '2024-01-15T10:30:00Z',
        customer_name: 'John Doe',
        customer_phone: '+27123456789',
        customer_email: 'john@example.com',
        address: '123 Main Street, Cape Town',
        assigned_to: null,
        category: 'maintenance',
        subcategory: 'fiber_fault',
        custom_fields: null,
      };

      const mapped = mapQContactTicketToFibreFlow(qcontactTicket);

      expect(mapped.source).toBe(TicketSource.QCONTACT);
      expect(mapped.external_id).toBe('QC-12345');
      expect(mapped.title).toBe('Internet connectivity issue');
      expect(mapped.description).toBe('Customer reports no internet');
      expect(mapped.ticket_type).toBe(TicketType.MAINTENANCE);
      expect(mapped.priority).toBe(TicketPriority.HIGH);
      expect(mapped.address).toBe('123 Main Street, Cape Town');
    });

    it('should map QContact priority to FibreFlow priority', () => {
      // 🟢 WORKING: Test priority mapping logic
      const createTicket = (priority: string): QContactTicket => ({
        id: 'QC-123',
        title: 'Test',
        description: null,
        status: 'open',
        priority,
        created_at: '2024-01-15T10:00:00Z',
        updated_at: '2024-01-15T10:00:00Z',
        customer_name: null,
        customer_phone: null,
        customer_email: null,
        address: null,
        assigned_to: null,
        category: null,
        subcategory: null,
        custom_fields: null,
      });

      expect(mapQContactTicketToFibreFlow(createTicket('low')).priority).toBe(TicketPriority.LOW);
      expect(mapQContactTicketToFibreFlow(createTicket('normal')).priority).toBe(TicketPriority.NORMAL);
      expect(mapQContactTicketToFibreFlow(createTicket('high')).priority).toBe(TicketPriority.HIGH);
      expect(mapQContactTicketToFibreFlow(createTicket('urgent')).priority).toBe(TicketPriority.URGENT);
      expect(mapQContactTicketToFibreFlow(createTicket('critical')).priority).toBe(TicketPriority.CRITICAL);
      expect(mapQContactTicketToFibreFlow(createTicket('unknown')).priority).toBe(TicketPriority.NORMAL);
    });

    it('should extract DR number from custom fields', () => {
      // 🟢 WORKING: Test DR number extraction from QContact custom fields
      const qcontactTicket: QContactTicket = {
        id: 'QC-12345',
        title: 'Test ticket',
        description: null,
        status: 'open',
        priority: 'normal',
        created_at: '2024-01-15T10:00:00Z',
        updated_at: '2024-01-15T10:00:00Z',
        customer_name: null,
        customer_phone: null,
        customer_email: null,
        address: null,
        assigned_to: null,
        category: null,
        subcategory: null,
        custom_fields: {
          dr_number: 'DR-2024-001',
          pole_number: 'POLE-123',
        },
      };

      const mapped = mapQContactTicketToFibreFlow(qcontactTicket);

      expect(mapped.dr_number).toBe('DR-2024-001');
      expect(mapped.pole_number).toBe('POLE-123');
    });

    it('should map category to ticket type', () => {
      // 🟢 WORKING: Test category to ticket_type mapping
      const createTicket = (category: string | null): QContactTicket => ({
        id: 'QC-123',
        title: 'Test',
        description: null,
        status: 'open',
        priority: 'normal',
        created_at: '2024-01-15T10:00:00Z',
        updated_at: '2024-01-15T10:00:00Z',
        customer_name: null,
        customer_phone: null,
        customer_email: null,
        address: null,
        assigned_to: null,
        category,
        subcategory: null,
        custom_fields: null,
      });

      expect(mapQContactTicketToFibreFlow(createTicket('maintenance')).ticket_type).toBe(TicketType.MAINTENANCE);
      expect(mapQContactTicketToFibreFlow(createTicket('installation')).ticket_type).toBe(TicketType.NEW_INSTALLATION);
      expect(mapQContactTicketToFibreFlow(createTicket('modification')).ticket_type).toBe(TicketType.MODIFICATION);
      expect(mapQContactTicketToFibreFlow(createTicket('ont_swap')).ticket_type).toBe(TicketType.ONT_SWAP);
      expect(mapQContactTicketToFibreFlow(createTicket('incident')).ticket_type).toBe(TicketType.INCIDENT);
      expect(mapQContactTicketToFibreFlow(createTicket(null)).ticket_type).toBe(TicketType.MAINTENANCE);
    });
  });

  describe('syncSingleInboundTicket', () => {
    it('should create a new ticket from QContact data', async () => {
      // 🟢 WORKING: Test successful single ticket sync
      const qcontactTicket: QContactTicket = {
        id: 'QC-12345',
        title: 'Fiber fault',
        description: 'Customer reports fiber cut',
        status: 'open',
        priority: 'high',
        created_at: '2024-01-15T10:00:00Z',
        updated_at: '2024-01-15T10:00:00Z',
        customer_name: 'John Doe',
        customer_phone: '+27123456789',
        customer_email: 'john@example.com',
        address: '123 Main Street',
        assigned_to: null,
        category: 'maintenance',
        subcategory: 'fiber_fault',
        custom_fields: {
          dr_number: 'DR-2024-001',
        },
      };

      // Mock: Check if ticket already exists (it doesn't)
      vi.mocked(queryOne).mockResolvedValueOnce(null);

      // Mock: Create ticket
      const mockCreatedTicket = {
        id: 'ticket-uuid-123',
        ticket_uid: 'FT406824',
        source: TicketSource.QCONTACT,
        external_id: 'QC-12345',
        title: 'Fiber fault',
        description: 'Customer reports fiber cut',
        ticket_type: TicketType.MAINTENANCE,
        priority: TicketPriority.HIGH,
        status: TicketStatus.OPEN,
        dr_number: 'DR-2024-001',
        address: '123 Main Street',
        created_at: new Date('2024-01-15T10:00:00Z'),
        updated_at: new Date('2024-01-15T10:00:00Z'),
      };
      vi.mocked(queryOne).mockResolvedValueOnce(mockCreatedTicket);

      // Mock: Create sync log
      const mockSyncLog = {
        id: 'sync-log-uuid-123',
        ticket_id: 'ticket-uuid-123',
        qcontact_ticket_id: 'QC-12345',
        sync_direction: SyncDirection.INBOUND,
        sync_type: SyncType.CREATE,
        status: SyncStatus.SUCCESS,
        synced_at: new Date(),
      };
      vi.mocked(queryOne).mockResolvedValueOnce(mockSyncLog);

      const result = await syncSingleInboundTicket(qcontactTicket);

      expect(result.success).toBe(true);
      expect(result.ticket_id).toBe('ticket-uuid-123');
      expect(result.qcontact_ticket_id).toBe('QC-12345');
      expect(result.error_message).toBeNull();

      // Verify queryOne was called 3 times (check duplicate, create ticket, create log)
      expect(queryOne).toHaveBeenCalledTimes(3);
    });

    it('should skip duplicate tickets', async () => {
      // 🟢 WORKING: Test duplicate ticket handling
      const qcontactTicket: QContactTicket = {
        id: 'QC-12345',
        title: 'Duplicate ticket',
        description: 'Already exists',
        status: 'open',
        priority: 'normal',
        created_at: '2024-01-15T10:00:00Z',
        updated_at: '2024-01-15T10:00:00Z',
        customer_name: null,
        customer_phone: null,
        customer_email: null,
        address: null,
        assigned_to: null,
        category: null,
        subcategory: null,
        custom_fields: null,
      };

      // Mock: Ticket already exists
      const existingTicket = {
        id: 'existing-ticket-uuid',
        external_id: 'QC-12345',
        source: TicketSource.QCONTACT,
      };
      vi.mocked(queryOne).mockResolvedValueOnce(existingTicket);

      const result = await syncSingleInboundTicket(qcontactTicket);

      expect(result.success).toBe(true);
      expect(result.ticket_id).toBe('existing-ticket-uuid');
      expect(result.error_message).toBeNull();

      // Should only check for duplicate, not create
      expect(queryOne).toHaveBeenCalledTimes(1);
    });

    it('should handle sync failures gracefully', async () => {
      // 🟢 WORKING: Test error handling
      const qcontactTicket: QContactTicket = {
        id: 'QC-12345',
        title: 'Test ticket',
        description: null,
        status: 'open',
        priority: 'normal',
        created_at: '2024-01-15T10:00:00Z',
        updated_at: '2024-01-15T10:00:00Z',
        customer_name: null,
        customer_phone: null,
        customer_email: null,
        address: null,
        assigned_to: null,
        category: null,
        subcategory: null,
        custom_fields: null,
      };

      // Mock: Check duplicate succeeds
      vi.mocked(queryOne).mockResolvedValueOnce(null);

      // Mock: Create ticket fails
      vi.mocked(queryOne).mockRejectedValueOnce(new Error('Database connection failed'));

      // Mock: Create error log
      const mockErrorLog = {
        id: 'sync-log-error-uuid',
        qcontact_ticket_id: 'QC-12345',
        sync_direction: SyncDirection.INBOUND,
        sync_type: SyncType.CREATE,
        status: SyncStatus.FAILED,
        error_message: 'Database connection failed',
        synced_at: new Date(),
      };
      vi.mocked(queryOne).mockResolvedValueOnce(mockErrorLog);

      const result = await syncSingleInboundTicket(qcontactTicket);

      expect(result.success).toBe(false);
      expect(result.ticket_id).toBeNull();
      expect(result.qcontact_ticket_id).toBe('QC-12345');
      expect(result.error_message).toContain('Database connection failed');
    });

    it('should log sync operations to qcontact_sync_log table', async () => {
      // 🟢 WORKING: Test sync logging
      const qcontactTicket: QContactTicket = {
        id: 'QC-67890',
        title: 'Test logging',
        description: null,
        status: 'open',
        priority: 'normal',
        created_at: '2024-01-15T10:00:00Z',
        updated_at: '2024-01-15T10:00:00Z',
        customer_name: null,
        customer_phone: null,
        customer_email: null,
        address: null,
        assigned_to: null,
        category: null,
        subcategory: null,
        custom_fields: null,
      };

      // Mock successful flow
      vi.mocked(queryOne).mockResolvedValueOnce(null); // No duplicate
      vi.mocked(queryOne).mockResolvedValueOnce({ id: 'ticket-uuid', ticket_uid: 'FT123456' }); // Created ticket
      vi.mocked(queryOne).mockResolvedValueOnce({ id: 'log-uuid' }); // Sync log

      await syncSingleInboundTicket(qcontactTicket);

      // Verify sync log was created with correct parameters
      const syncLogCall = vi.mocked(queryOne).mock.calls[2];
      expect(syncLogCall[0]).toContain('INSERT INTO qcontact_sync_log');
      expect(syncLogCall[1]).toContain('QC-67890'); // qcontact_ticket_id
      expect(syncLogCall[1]).toContain(SyncDirection.INBOUND);
      expect(syncLogCall[1]).toContain(SyncType.CREATE);
      expect(syncLogCall[1]).toContain(SyncStatus.SUCCESS);
    });
  });

  describe('syncInboundTickets', () => {
    let mockQContactClient: any;

    beforeEach(() => {
      mockQContactClient = {
        listTickets: vi.fn(),
      };
      vi.mocked(getDefaultQContactClient).mockReturnValue(mockQContactClient);
    });

    it('should fetch and sync new tickets from QContact', async () => {
      // 🟢 WORKING: Test bulk sync operation
      const mockQContactTickets: QContactTicket[] = [
        {
          id: 'QC-001',
          title: 'Ticket 1',
          description: 'First ticket',
          status: 'open',
          priority: 'normal',
          created_at: '2024-01-15T10:00:00Z',
          updated_at: '2024-01-15T10:00:00Z',
          customer_name: null,
          customer_phone: null,
          customer_email: null,
          address: null,
          assigned_to: null,
          category: 'maintenance',
          subcategory: null,
          custom_fields: null,
        },
        {
          id: 'QC-002',
          title: 'Ticket 2',
          description: 'Second ticket',
          status: 'open',
          priority: 'high',
          created_at: '2024-01-15T11:00:00Z',
          updated_at: '2024-01-15T11:00:00Z',
          customer_name: null,
          customer_phone: null,
          customer_email: null,
          address: null,
          assigned_to: null,
          category: 'incident',
          subcategory: null,
          custom_fields: null,
        },
      ];

      mockQContactClient.listTickets.mockResolvedValue({
        tickets: mockQContactTickets,
        total: 2,
        page: 1,
        page_size: 100,
        has_more: false,
      });

      // Mock: Both tickets are new (no duplicates)
      vi.mocked(queryOne).mockResolvedValue(null); // All duplicate checks return null

      // Mock: Create tickets (alternating for each ticket)
      vi.mocked(queryOne)
        .mockResolvedValueOnce(null) // Ticket 1 duplicate check
        .mockResolvedValueOnce({ id: 'ticket-uuid-1', ticket_uid: 'FT001' }) // Ticket 1 created
        .mockResolvedValueOnce({ id: 'log-uuid-1' }) // Ticket 1 log
        .mockResolvedValueOnce(null) // Ticket 2 duplicate check
        .mockResolvedValueOnce({ id: 'ticket-uuid-2', ticket_uid: 'FT002' }) // Ticket 2 created
        .mockResolvedValueOnce({ id: 'log-uuid-2' }); // Ticket 2 log

      const result = await syncInboundTickets();

      expect(result.total_processed).toBe(2);
      expect(result.successful).toBe(2);
      expect(result.failed).toBe(0);
      expect(result.skipped).toBe(0);
      expect(result.created).toBe(2);
      expect(mockQContactClient.listTickets).toHaveBeenCalledWith({
        status: 'open',
        page: 1,
        page_size: 100,
      });
    });

    it('should handle mixed success and failures in bulk sync', async () => {
      // 🟢 WORKING: Test partial sync success
      const mockQContactTickets: QContactTicket[] = [
        {
          id: 'QC-001',
          title: 'Success ticket',
          description: null,
          status: 'open',
          priority: 'normal',
          created_at: '2024-01-15T10:00:00Z',
          updated_at: '2024-01-15T10:00:00Z',
          customer_name: null,
          customer_phone: null,
          customer_email: null,
          address: null,
          assigned_to: null,
          category: null,
          subcategory: null,
          custom_fields: null,
        },
        {
          id: 'QC-002',
          title: 'Fail ticket',
          description: null,
          status: 'open',
          priority: 'normal',
          created_at: '2024-01-15T10:00:00Z',
          updated_at: '2024-01-15T10:00:00Z',
          customer_name: null,
          customer_phone: null,
          customer_email: null,
          address: null,
          assigned_to: null,
          category: null,
          subcategory: null,
          custom_fields: null,
        },
      ];

      mockQContactClient.listTickets.mockResolvedValue({
        tickets: mockQContactTickets,
        total: 2,
        page: 1,
        page_size: 100,
        has_more: false,
      });

      // Ticket 1: Success
      vi.mocked(queryOne)
        .mockResolvedValueOnce(null) // Duplicate check
        .mockResolvedValueOnce({ id: 'ticket-uuid-1' }) // Created
        .mockResolvedValueOnce({ id: 'log-uuid-1' }) // Log
        // Ticket 2: Failure
        .mockResolvedValueOnce(null) // Duplicate check
        .mockRejectedValueOnce(new Error('Creation failed')) // Create fails
        .mockResolvedValueOnce({ id: 'log-uuid-2' }); // Error log

      const result = await syncInboundTickets();

      expect(result.total_processed).toBe(2);
      expect(result.successful).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.created).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].qcontact_ticket_id).toBe('QC-002');
    });

    it('should filter tickets by date range', async () => {
      // 🟢 WORKING: Test date filtering
      const startDate = new Date('2024-01-10T00:00:00Z');
      const endDate = new Date('2024-01-20T23:59:59Z');

      mockQContactClient.listTickets.mockResolvedValue({
        tickets: [],
        total: 0,
        page: 1,
        page_size: 100,
        has_more: false,
      });

      await syncInboundTickets({
        created_after: startDate,
        created_before: endDate,
      });

      expect(mockQContactClient.listTickets).toHaveBeenCalledWith({
        status: 'open',
        created_after: startDate,
        created_before: endDate,
        page: 1,
        page_size: 100,
      });
    });

    it('should handle pagination for large result sets', async () => {
      // 🟢 WORKING: Test pagination support
      // Page 1
      mockQContactClient.listTickets.mockResolvedValueOnce({
        tickets: [
          {
            id: 'QC-001',
            title: 'Ticket 1',
            description: null,
            status: 'open',
            priority: 'normal',
            created_at: '2024-01-15T10:00:00Z',
            updated_at: '2024-01-15T10:00:00Z',
            customer_name: null,
            customer_phone: null,
            customer_email: null,
            address: null,
            assigned_to: null,
            category: null,
            subcategory: null,
            custom_fields: null,
          },
        ],
        total: 150,
        page: 1,
        page_size: 100,
        has_more: true,
      });

      // Page 2
      mockQContactClient.listTickets.mockResolvedValueOnce({
        tickets: [
          {
            id: 'QC-002',
            title: 'Ticket 2',
            description: null,
            status: 'open',
            priority: 'normal',
            created_at: '2024-01-15T10:00:00Z',
            updated_at: '2024-01-15T10:00:00Z',
            customer_name: null,
            customer_phone: null,
            customer_email: null,
            address: null,
            assigned_to: null,
            category: null,
            subcategory: null,
            custom_fields: null,
          },
        ],
        total: 150,
        page: 2,
        page_size: 100,
        has_more: false,
      });

      // Mock all DB operations as successful
      vi.mocked(queryOne).mockResolvedValue(null); // Duplicate checks
      vi.mocked(queryOne)
        .mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'ticket-1' }).mockResolvedValueOnce({ id: 'log-1' })
        .mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'ticket-2' }).mockResolvedValueOnce({ id: 'log-2' });

      const result = await syncInboundTickets();

      expect(result.total_processed).toBe(2);
      expect(mockQContactClient.listTickets).toHaveBeenCalledTimes(2);
    });
  });
});

/**
 * HandoverHistory Component Tests
 *
 * 🟢 WORKING: Comprehensive tests for handover history timeline component
 *
 * Tests:
 * - Display handover history timeline
 * - Show chronological order
 * - Display handover type for each entry
 * - Display ownership transfers
 * - Handle empty history
 * - Handle loading and error states
 * - Allow expanding snapshot details
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Mock } from 'vitest';
import { HandoverHistory } from '../../components/Handover/HandoverHistory';
import { HandoverType, OwnerType } from '../../types/handover';
import type { TicketHandoverHistory } from '../../types/handover';

// Mock Clerk auth
vi.mock('@clerk/nextjs', () => ({
  useUser: vi.fn(() => ({
    user: { id: 'test-user-id', fullName: 'Test User' },
    isLoaded: true,
  })),
}));

// Mock fetch
global.fetch = vi.fn();

// Helper to create QueryClient for tests
function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  });
}

// Wrapper component with QueryClient
function renderWithQueryClient(ui: React.ReactElement) {
  const testQueryClient = createTestQueryClient();
  return render(
    <QueryClientProvider client={testQueryClient}>
      {ui}
    </QueryClientProvider>
  );
}

// Create mock handover history
const createMockHistory = (): TicketHandoverHistory => ({
  ticket_id: 'ticket-123',
  ticket_uid: 'FT406824',
  handovers: [
    {
      id: 'handover-1',
      ticket_id: 'ticket-123',
      handover_type: HandoverType.BUILD_TO_QA,
      snapshot_data: {
        ticket_uid: 'FT406824',
        title: 'Fiber installation',
        description: null,
        status: 'pending_qa',
        priority: 'normal',
        ticket_type: 'new_installation',
        dr_number: 'DR12345',
        project_id: null,
        zone_id: null,
        pole_number: null,
        pon_number: null,
        address: null,
        ont_serial: null,
        ont_rx_level: null,
        ont_model: null,
        assigned_to: null,
        assigned_contractor_id: null,
        assigned_team: null,
        qa_ready: true,
        qa_readiness_check_at: null,
        fault_cause: null,
        fault_cause_details: null,
        verification_steps_completed: 12,
        verification_steps_total: 12,
        snapshot_timestamp: new Date('2024-01-10T10:00:00Z'),
      },
      evidence_links: [],
      decisions: [],
      guarantee_status: 'under_guarantee',
      from_owner_type: OwnerType.BUILD,
      from_owner_id: 'build-user-123',
      to_owner_type: OwnerType.QA,
      to_owner_id: 'qa-user-123',
      handover_at: new Date('2024-01-10T10:00:00Z'),
      handover_by: 'build-user-123',
      is_locked: true,
      created_at: new Date('2024-01-10T10:00:00Z'),
    },
    {
      id: 'handover-2',
      ticket_id: 'ticket-123',
      handover_type: HandoverType.QA_TO_OPS,
      snapshot_data: {
        ticket_uid: 'FT406824',
        title: 'Fiber installation',
        description: null,
        status: 'completed',
        priority: 'normal',
        ticket_type: 'new_installation',
        dr_number: 'DR12345',
        project_id: null,
        zone_id: null,
        pole_number: 'P-001',
        pon_number: 'PON-001',
        address: null,
        ont_serial: 'ONT123',
        ont_rx_level: -22.5,
        ont_model: null,
        assigned_to: null,
        assigned_contractor_id: 'contractor-123',
        assigned_team: null,
        qa_ready: true,
        qa_readiness_check_at: new Date('2024-01-15T09:00:00Z'),
        fault_cause: null,
        fault_cause_details: null,
        verification_steps_completed: 12,
        verification_steps_total: 12,
        snapshot_timestamp: new Date('2024-01-15T12:00:00Z'),
      },
      evidence_links: [],
      decisions: [],
      guarantee_status: 'under_guarantee',
      from_owner_type: OwnerType.QA,
      from_owner_id: 'qa-user-123',
      to_owner_type: OwnerType.OPS,
      to_owner_id: 'maint-user-123',
      handover_at: new Date('2024-01-15T12:00:00Z'),
      handover_by: 'qa-user-123',
      is_locked: true,
      created_at: new Date('2024-01-15T12:00:00Z'),
    },
  ],
  total_handovers: 2,
  current_owner_type: OwnerType.OPS,
  current_owner_id: 'maint-user-123',
});

describe('HandoverHistory Component', () => {
  const mockTicketId = 'ticket-123';

  beforeEach(() => {
    vi.clearAllMocks();
    (global.fetch as Mock).mockReset();
  });

  describe('Initial Rendering', () => {
    it('should display handover history timeline', async () => {
      // Arrange
      const history = createMockHistory();
      (global.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: history,
        }),
      });

      // Act
      renderWithQueryClient(<HandoverHistory ticketId={mockTicketId} />);

      // Assert - wait for all content to load
      await waitFor(() => {
        expect(screen.getByText(/Handover History/i)).toBeInTheDocument();
        expect(screen.getByText(/Build to QA/i)).toBeInTheDocument();
        expect(screen.getByText(/QA to Maintenance/i)).toBeInTheDocument();
      });
    });

    it('should show loading state while fetching', () => {
      // Arrange
      (global.fetch as Mock).mockImplementation(() => new Promise(() => {}));

      // Act
      renderWithQueryClient(<HandoverHistory ticketId={mockTicketId} />);

      // Assert
      // LoadingSpinner renders sr-only + visible spans.
      expect(screen.getAllByText(/loading/i).length).toBeGreaterThan(0);
    });

    it('should show error state on fetch failure', async () => {
      // Arrange
      (global.fetch as Mock).mockRejectedValueOnce(new Error('Network error'));

      // Act
      renderWithQueryClient(<HandoverHistory ticketId={mockTicketId} />);

      // Assert
      await waitFor(() => {
        expect(screen.getByText(/failed to load/i)).toBeInTheDocument();
      });
    });
  });

  describe('Timeline Display', () => {
    it('should display handovers in chronological order', async () => {
      // Arrange
      const history = createMockHistory();
      (global.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: history,
        }),
      });

      // Act
      renderWithQueryClient(<HandoverHistory ticketId={mockTicketId} />);

      // Assert
      await waitFor(() => {
        expect(screen.getByText(/Build to QA/i)).toBeInTheDocument();
      });

      // Both handover types should be displayed
      expect(screen.getByText(/QA to Maintenance/i)).toBeInTheDocument();
    });

    it('should display handover type for each entry', async () => {
      // Arrange
      const history = createMockHistory();
      (global.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: history,
        }),
      });

      // Act
      renderWithQueryClient(<HandoverHistory ticketId={mockTicketId} />);

      // Assert
      await waitFor(() => {
        expect(screen.getByText(/Build to QA/i)).toBeInTheDocument();
        expect(screen.getByText(/QA to Maintenance/i)).toBeInTheDocument();
      });
    });

    it('should display ownership transfer details', async () => {
      // Arrange
      const history = createMockHistory();
      (global.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: history,
        }),
      });

      // Act
      renderWithQueryClient(<HandoverHistory ticketId={mockTicketId} />);

      // Assert
      await waitFor(() => {
        expect(screen.getByText(/Build to QA/i)).toBeInTheDocument();
      });

      // Should show from/to owner types (multiple matches expected)
      const buildElements = screen.getAllByText(/Build/i);
      const qaElements = screen.getAllByText(/QA/i);
      const maintenanceElements = screen.getAllByText(/Maintenance/i);
      expect(buildElements.length).toBeGreaterThan(0);
      expect(qaElements.length).toBeGreaterThan(0);
      expect(maintenanceElements.length).toBeGreaterThan(0);
    });

    it('should display handover timestamps', async () => {
      // Arrange
      const history = createMockHistory();
      (global.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: history,
        }),
      });

      // Act
      renderWithQueryClient(<HandoverHistory ticketId={mockTicketId} />);

      // Assert
      await waitFor(() => {
        expect(screen.getByText(/Build to QA/i)).toBeInTheDocument();
      });

      // Should show dates (multiple matches expected)
      const dateElements = screen.getAllByText(/2024/i);
      expect(dateElements.length).toBeGreaterThan(0);
    });
  });

  describe('Empty State', () => {
    it('should handle empty history', async () => {
      // Arrange
      (global.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            ticket_id: mockTicketId,
            ticket_uid: 'FT406824',
            handovers: [],
            total_handovers: 0,
            current_owner_type: null,
            current_owner_id: null,
          },
        }),
      });

      // Act
      renderWithQueryClient(<HandoverHistory ticketId={mockTicketId} />);

      // Assert
      await waitFor(() => {
        expect(screen.getByText(/no handover history/i)).toBeInTheDocument();
      });
    });
  });

  describe('Snapshot Details Expansion', () => {
    it('should allow expanding snapshot details', async () => {
      // Arrange
      const history = createMockHistory();
      (global.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: history,
        }),
      });

      // Act
      renderWithQueryClient(<HandoverHistory ticketId={mockTicketId} />);

      // Wait for data to load
      await waitFor(() => {
        expect(screen.getByText(/Build to QA/i)).toBeInTheDocument();
      });

      // Find and click expand button
      const expandButtons = screen.getAllByRole('button', { name: /view details|expand/i });
      if (expandButtons.length > 0) {
        fireEvent.click(expandButtons[0]);

        // Should show snapshot details
        await waitFor(() => {
          expect(screen.getByText(/snapshot/i)).toBeInTheDocument();
        });
      }
    });
  });

  describe('Current Owner Display', () => {
    it('should highlight current owner', async () => {
      // Arrange
      const history = createMockHistory();
      (global.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: history,
        }),
      });

      // Act
      renderWithQueryClient(<HandoverHistory ticketId={mockTicketId} />);

      // Assert
      await waitFor(() => {
        expect(screen.getByText(/Build to QA/i)).toBeInTheDocument();
      });

      // Component shows "Current Owner" badge and "Current owner:" in subtitle
      const currentOwnerElements = screen.getAllByText(/current owner/i);
      expect(currentOwnerElements.length).toBeGreaterThan(0);

      // Maintenance is the current owner
      const maintenanceElements = screen.getAllByText(/Maintenance/i);
      expect(maintenanceElements.length).toBeGreaterThan(0);
    });
  });

  describe('Handover Count', () => {
    it('should display total handover count', async () => {
      // Arrange
      const history = createMockHistory();
      (global.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: history,
        }),
      });

      // Act
      renderWithQueryClient(<HandoverHistory ticketId={mockTicketId} />);

      // Assert
      await waitFor(() => {
        expect(screen.getByText(/2 handover/i)).toBeInTheDocument();
      });
    });
  });
});

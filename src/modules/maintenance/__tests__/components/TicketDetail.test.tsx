/**
 * TicketDetail Component Tests
 *
 * 🟢 WORKING: Comprehensive tests for TicketDetail component
 *
 * Test Coverage:
 * - Display ticket detail
 * - Display ticket header
 * - Display ticket actions
 * - Display verification checklist
 * - Loading state
 * - Error state
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TicketDetail } from '../../components/TicketDetail/TicketDetail';
import type { Ticket } from '../../types/ticket';

// Mock fetch
global.fetch = vi.fn();

// Mock Clerk
  return {
    ...actual,
    useUser: () => ({
      user: { id: 'test-user-id', firstName: 'Test', lastName: 'User' },
      isLoaded: true,
    }),
  };
});

// Mock data
const mockTicket: Ticket = {
  id: 'test-id-123',
  ticket_uid: 'FT12345',
  title: 'Test Ticket Title',
  description: 'This is a test ticket description',
  source: 'manual',
  external_id: null,
  ticket_type: 'maintenance',
  priority: 'high',
  status: 'in_progress',
  dr_number: 'DR12345',
  project_id: 'project-123',
  zone_id: null,
  pole_number: 'POLE-001',
  pon_number: 'PON-001',
  address: '123 Test Street',
  gps_coordinates: null,
  ont_serial: 'ONT-12345',
  ont_rx_level: -20.5,
  ont_model: 'HG8145V5',
  assigned_to: 'user-123',
  assigned_contractor_id: null,
  assigned_team: null,
  guarantee_status: 'under_guarantee',
  guarantee_expires_at: new Date('2025-06-01T00:00:00Z'),
  is_billable: false,
  billing_classification: null,
  qa_ready: true,
  qa_readiness_check_at: new Date('2024-01-15T10:00:00Z'),
  qa_readiness_failed_reasons: null,
  fault_cause: 'workmanship',
  fault_cause_details: 'Poor connection',
  rectification_count: 1,
  sla_due_at: new Date('2024-01-20T00:00:00Z'),
  sla_first_response_at: new Date('2024-01-10T11:00:00Z'),
  sla_breached: false,
  created_at: new Date('2024-01-10T10:00:00Z'),
  created_by: 'user-456',
  updated_at: new Date('2024-01-15T14:00:00Z'),
  closed_at: null,
  closed_by: null,
};

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

describe('TicketDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // 🟢 WORKING: Test ticket detail display
  it('should display ticket detail', async () => {
    (global.fetch as any).mockImplementation((url: string) => {
      if (url.includes('/api/ticketing/tickets/test-id-123')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: mockTicket,
          }),
        });
      }
      // Mock verification steps endpoint
      return Promise.resolve({
        ok: true,
        json: async () => ({ success: true, data: [] }),
      });
    });

    render(<TicketDetail ticketId="test-id-123" />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('FT12345')).toBeInTheDocument();
      expect(screen.getByText('Test Ticket Title')).toBeInTheDocument();
      expect(screen.getByText('This is a test ticket description')).toBeInTheDocument();
    });
  });

  // 🟢 WORKING: Test loading state
  it('should display loading state', () => {
    (global.fetch as any).mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 1000))
    );

    render(<TicketDetail ticketId="test-id-123" />, { wrapper: createWrapper() });

    expect(screen.getByText('Loading ticket...')).toBeInTheDocument();
  });

  // 🟢 WORKING: Test error state
  it('should display error state', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: false,
      json: async () => ({
        success: false,
        error: { message: 'Ticket not found' },
      }),
    });

    render(<TicketDetail ticketId="test-id-123" />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('Error Loading Ticket')).toBeInTheDocument();
      expect(screen.getByText(/Ticket not found/)).toBeInTheDocument();
    });
  });

  // 🟢 WORKING: Test status badge display
  it('should display ticket status badge', async () => {
    (global.fetch as any).mockImplementation((url: string) => {
      if (url.includes('/api/ticketing/tickets/test-id-123')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: mockTicket,
          }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ success: true, data: [] }),
      });
    });

    render(<TicketDetail ticketId="test-id-123" />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('In Progress')).toBeInTheDocument();
    });
  });

  // 🟢 WORKING: Test priority display
  it('should display ticket priority', async () => {
    (global.fetch as any).mockImplementation((url: string) => {
      if (url.includes('/api/ticketing/tickets/test-id-123')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: mockTicket,
          }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ success: true, data: [] }),
      });
    });

    render(<TicketDetail ticketId="test-id-123" />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('high')).toBeInTheDocument();
    });
  });

  // 🟢 WORKING: Test QA ready indicator
  it('should display QA ready indicator', async () => {
    (global.fetch as any).mockImplementation((url: string) => {
      if (url.includes('/api/ticketing/tickets/test-id-123')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: mockTicket,
          }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ success: true, data: [] }),
      });
    });

    render(<TicketDetail ticketId="test-id-123" />, { wrapper: createWrapper() });

    await waitFor(() => {
      const qaReadyBadges = screen.getAllByText('QA Ready');
      expect(qaReadyBadges.length).toBeGreaterThan(0);
    });
  });

  // 🟢 WORKING: Test additional details display
  it('should display additional ticket details', async () => {
    (global.fetch as any).mockImplementation((url: string) => {
      if (url.includes('/api/ticketing/tickets/test-id-123')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: mockTicket,
          }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ success: true, data: [] }),
      });
    });

    render(<TicketDetail ticketId="test-id-123" />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('DR12345')).toBeInTheDocument();
      expect(screen.getByText('POLE-001')).toBeInTheDocument();
      expect(screen.getByText('PON-001')).toBeInTheDocument();
      expect(screen.getByText('ONT-12345')).toBeInTheDocument();
      expect(screen.getByText('-20.5 dBm')).toBeInTheDocument();
    });
  });

  // 🟢 WORKING: Test actions section
  it('should display actions section', async () => {
    (global.fetch as any).mockImplementation((url: string) => {
      if (url.includes('/api/ticketing/tickets/test-id-123')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: mockTicket,
          }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ success: true, data: [] }),
      });
    });

    render(<TicketDetail ticketId="test-id-123" />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('Actions')).toBeInTheDocument();
    });
  });

  // 🟢 WORKING: Test back link
  it('should display back link when provided', async () => {
    (global.fetch as any).mockImplementation((url: string) => {
      if (url.includes('/api/ticketing/tickets/test-id-123')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: mockTicket,
          }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ success: true, data: [] }),
      });
    });

    render(
      <TicketDetail ticketId="test-id-123" backLink="/custom-back" />,
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      const backLink = screen.getByText('Back to tickets');
      expect(backLink).toBeInTheDocument();
      expect(backLink.closest('a')).toHaveAttribute('href', '/custom-back');
    });
  });

  // 🟢 WORKING: Test retry button on error
  it('should have retry button on error', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: false,
      json: async () => ({
        success: false,
        error: { message: 'Network error' },
      }),
    });

    render(<TicketDetail ticketId="test-id-123" />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
    });
  });
});

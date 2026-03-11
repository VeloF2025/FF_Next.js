/**
 * QAReadinessCheck Component Tests
 *
 * 🟢 WORKING: Comprehensive tests for QA readiness check components
 *
 * Tests:
 * - Display readiness status (ready/not ready)
 * - Show failed checks clearly
 * - Run readiness check button functionality
 * - Block QA when not ready
 * - Allow QA when ready
 * - Loading and error states
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { QAReadinessCheck } from '../../components/QAReadiness/QAReadinessCheck';
import { ReadinessResults } from '../../components/QAReadiness/ReadinessResults';
import { ReadinessBlocker } from '../../components/QAReadiness/ReadinessBlocker';
import type { QAReadinessCheck as QAReadinessCheckType, QAReadinessFailedCheck } from '../../types/verification';

// Mock Clerk auth
vi.mock('@clerk/nextjs', () => ({
  useUser: vi.fn(() => ({
    user: { id: 'test-user-id' },
    isLoaded: true,
  })),
}));

// Mock fetch for API calls
global.fetch = vi.fn();

// Helper to create mock readiness check results
const createMockReadinessCheck = (passed: boolean, failedChecks?: QAReadinessFailedCheck[]): QAReadinessCheckType => ({
  id: 'check-123',
  ticket_id: 'ticket-456',
  passed,
  checked_at: new Date('2024-01-15T10:30:00Z'),
  checked_by: 'user-789',
  photos_exist: passed || !failedChecks?.some(c => c.check_name === 'photos_exist'),
  photos_count: passed ? 5 : 1,
  photos_required_count: 3,
  dr_populated: passed || !failedChecks?.some(c => c.check_name === 'dr_populated'),
  pole_populated: passed || !failedChecks?.some(c => c.check_name === 'pole_populated'),
  pon_populated: passed || !failedChecks?.some(c => c.check_name === 'pon_populated'),
  zone_populated: passed || !failedChecks?.some(c => c.check_name === 'zone_populated'),
  ont_serial_recorded: passed || !failedChecks?.some(c => c.check_name === 'ont_serial_recorded'),
  ont_rx_recorded: passed || !failedChecks?.some(c => c.check_name === 'ont_rx_recorded'),
  platforms_aligned: passed || !failedChecks?.some(c => c.check_name === 'platforms_aligned'),
  failed_checks: failedChecks || null,
  created_at: new Date('2024-01-15T10:30:00Z'),
});

// Helper to wrap component with QueryClient
const renderWithQueryClient = (ui: React.ReactElement) => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      {ui}
    </QueryClientProvider>
  );
};

describe('QAReadinessCheck Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Initial Rendering', () => {
    it('should display "Run Check" button when no status loaded', async () => {
      // Arrange
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            ticket_id: 'ticket-456',
            is_ready: false,
            last_check: null,
            last_check_at: null,
            failed_reasons: null,
            next_action: 'Run readiness check first',
          },
        }),
      });

      // Act
      renderWithQueryClient(<QAReadinessCheck ticketId="ticket-456" />);

      // Assert
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /run readiness check/i })).toBeInTheDocument();
      });
    });

    it('should show loading state while fetching status', async () => {
      // Arrange
      (global.fetch as any).mockImplementation(() => new Promise(() => {})); // Never resolves

      // Act
      renderWithQueryClient(<QAReadinessCheck ticketId="ticket-456" />);

      // Assert
      expect(screen.getByText(/loading/i)).toBeInTheDocument();
    });

    it('should show error state on fetch failure', async () => {
      // Arrange
      (global.fetch as any).mockRejectedValue(new Error('Network error'));

      // Act
      renderWithQueryClient(<QAReadinessCheck ticketId="ticket-456" />);

      // Assert
      await waitFor(() => {
        expect(screen.getByText(/failed to load/i)).toBeInTheDocument();
      });
    });
  });

  describe('Readiness Status Display', () => {
    it('should display "Ready for QA" when check passed', async () => {
      // Arrange
      const passedCheck = createMockReadinessCheck(true);
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            ticket_id: 'ticket-456',
            is_ready: true,
            last_check: passedCheck,
            last_check_at: passedCheck.checked_at,
            failed_reasons: null,
            next_action: 'Ticket is ready for QA',
          },
        }),
      });

      // Act
      renderWithQueryClient(<QAReadinessCheck ticketId="ticket-456" />);

      // Assert
      await waitFor(() => {
        expect(screen.getByText('✓ Ready for QA')).toBeInTheDocument();
      });
    });

    it('should display "Not Ready" when check failed', async () => {
      // Arrange
      const failedCheck = createMockReadinessCheck(false, [
        { check_name: 'photos_exist', reason: 'Not enough photos uploaded', expected: 3, actual: 1 },
      ]);
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            ticket_id: 'ticket-456',
            is_ready: false,
            last_check: failedCheck,
            last_check_at: failedCheck.checked_at,
            failed_reasons: ['Not enough photos uploaded'],
            next_action: 'Fix failed checks before QA',
          },
        }),
      });

      // Act
      renderWithQueryClient(<QAReadinessCheck ticketId="ticket-456" />);

      // Assert
      await waitFor(() => {
        expect(screen.getByText('✗ Not Ready')).toBeInTheDocument();
      });
    });
  });

  describe('Run Check Button', () => {
    it('should call API when "Run Check" button clicked', async () => {
      // Arrange
      const mockFetch = vi.fn()
        .mockResolvedValueOnce({
          // First call - get status
          ok: true,
          json: async () => ({
            success: true,
            data: {
              ticket_id: 'ticket-456',
              is_ready: false,
              last_check: null,
              last_check_at: null,
              failed_reasons: null,
              next_action: 'Run readiness check first',
            },
          }),
        })
        .mockResolvedValueOnce({
          // Second call - run check
          ok: true,
          json: async () => ({
            success: true,
            data: createMockReadinessCheck(true),
          }),
        })
        .mockResolvedValueOnce({
          // Third call - refetch status
          ok: true,
          json: async () => ({
            success: true,
            data: {
              ticket_id: 'ticket-456',
              is_ready: true,
              last_check: createMockReadinessCheck(true),
              last_check_at: new Date(),
              failed_reasons: null,
              next_action: 'Ticket is ready for QA',
            },
          }),
        });

      (global.fetch as any) = mockFetch;

      // Act
      renderWithQueryClient(<QAReadinessCheck ticketId="ticket-456" />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /run readiness check/i })).toBeInTheDocument();
      });

      const runButton = screen.getByRole('button', { name: /run readiness check/i });
      fireEvent.click(runButton);

      // Assert
      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining('/api/noc/tickets/ticket-456/qa-readiness-check'),
          expect.objectContaining({ method: 'POST' })
        );
      });
    });

    it('should disable button while check is running', async () => {
      // Arrange
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            ticket_id: 'ticket-456',
            is_ready: false,
            last_check: null,
            last_check_at: null,
            failed_reasons: null,
            next_action: 'Run readiness check first',
          },
        }),
      }).mockImplementation(() => new Promise(() => {})); // Second call never resolves

      // Act
      renderWithQueryClient(<QAReadinessCheck ticketId="ticket-456" />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /run readiness check/i })).toBeInTheDocument();
      });

      const runButton = screen.getByRole('button', { name: /run readiness check/i });
      fireEvent.click(runButton);

      // Assert
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /running check/i })).toBeInTheDocument();
      });
    });
  });
});

describe('ReadinessResults Component', () => {
  it('should display all passed checks in green', () => {
    // Arrange
    const passedCheck = createMockReadinessCheck(true);

    // Act
    render(<ReadinessResults check={passedCheck} />);

    // Assert
    expect(screen.getByText(/all checks passed/i)).toBeInTheDocument();
    expect(screen.getByText(/photos uploaded/i)).toBeInTheDocument();
    expect(screen.getByText(/dr number recorded/i)).toBeInTheDocument();
    expect(screen.getByText(/ont details recorded/i)).toBeInTheDocument();
  });

  it('should display failed checks in red with reasons', () => {
    // Arrange
    const failedCheck = createMockReadinessCheck(false, [
      { check_name: 'photos_exist', reason: 'Not enough photos uploaded', expected: 3, actual: 1 },
      { check_name: 'ont_serial_recorded', reason: 'ONT serial number not recorded', expected: 'populated', actual: 'empty' },
    ]);

    // Act
    render(<ReadinessResults check={failedCheck} />);

    // Assert
    expect(screen.getByText(/not enough photos uploaded/i)).toBeInTheDocument();
    expect(screen.getByText(/ont serial number not recorded/i)).toBeInTheDocument();
  });

  it('should show expected vs actual values for failed checks', () => {
    // Arrange
    const failedCheck = createMockReadinessCheck(false, [
      { check_name: 'photos_exist', reason: 'Not enough photos', expected: 3, actual: 1 },
    ]);

    // Act
    render(<ReadinessResults check={failedCheck} />);

    // Assert
    // Text is split across elements, so check for both parts
    expect(screen.getByText(/expected:/i)).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText(/actual:/i)).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('should display check timestamp', () => {
    // Arrange
    const check = createMockReadinessCheck(true);

    // Act
    render(<ReadinessResults check={check} />);

    // Assert
    expect(screen.getByText(/checked on/i)).toBeInTheDocument();
    expect(screen.getByText(/jan 15, 2024/i)).toBeInTheDocument();
  });

  it('should display progress bar for passed checks', () => {
    // Arrange
    const partiallyPassedCheck = createMockReadinessCheck(false, [
      { check_name: 'photos_exist', reason: 'Not enough photos', expected: 3, actual: 1 },
    ]);

    // Act
    render(<ReadinessResults check={partiallyPassedCheck} />);

    // Assert
    // Progress bar should show 7/8 checks passed (87.5%)
    expect(screen.getByText(/7 of 8 checks passed/i)).toBeInTheDocument();
  });
});

describe('ReadinessBlocker Component', () => {
  it('should block QA button when not ready', () => {
    // Arrange
    const failedCheck = createMockReadinessCheck(false, [
      { check_name: 'photos_exist', reason: 'Not enough photos', expected: 3, actual: 1 },
    ]);

    // Act
    render(
      <ReadinessBlocker
        isReady={false}
        lastCheck={failedCheck}
        failedReasons={['Not enough photos']}
        onStartQA={vi.fn()}
      />
    );

    // Assert
    const qaButton = screen.getByText(/start qa \(blocked\)/i);
    expect(qaButton).toBeDisabled();
  });

  it('should enable QA button when ready', () => {
    // Arrange
    const passedCheck = createMockReadinessCheck(true);

    // Act
    render(
      <ReadinessBlocker
        isReady={true}
        lastCheck={passedCheck}
        failedReasons={null}
        onStartQA={vi.fn()}
      />
    );

    // Assert
    const qaButton = screen.getByRole('button', { name: /start qa/i });
    expect(qaButton).not.toBeDisabled();
  });

  it('should call onStartQA when button clicked and ready', () => {
    // Arrange
    const passedCheck = createMockReadinessCheck(true);
    const mockOnStartQA = vi.fn();

    // Act
    render(
      <ReadinessBlocker
        isReady={true}
        lastCheck={passedCheck}
        failedReasons={null}
        onStartQA={mockOnStartQA}
      />
    );

    const qaButton = screen.getByRole('button', { name: /start qa/i });
    fireEvent.click(qaButton);

    // Assert
    expect(mockOnStartQA).toHaveBeenCalledTimes(1);
  });

  it('should display blocking reasons when not ready', () => {
    // Arrange
    const failedCheck = createMockReadinessCheck(false, [
      { check_name: 'photos_exist', reason: 'Not enough photos', expected: 3, actual: 1 },
      { check_name: 'dr_populated', reason: 'DR number missing', expected: 'populated', actual: 'empty' },
    ]);

    // Act
    render(
      <ReadinessBlocker
        isReady={false}
        lastCheck={failedCheck}
        failedReasons={['Not enough photos', 'DR number missing']}
        onStartQA={vi.fn()}
      />
    );

    // Assert
    expect(screen.getByText(/cannot start qa/i)).toBeInTheDocument();
    expect(screen.getByText(/not enough photos/i)).toBeInTheDocument();
    expect(screen.getByText(/dr number missing/i)).toBeInTheDocument();
  });

  it('should show "Run check first" message when no checks run', () => {
    // Arrange & Act
    render(
      <ReadinessBlocker
        isReady={false}
        lastCheck={null}
        failedReasons={null}
        onStartQA={vi.fn()}
      />
    );

    // Assert
    expect(screen.getByText(/run readiness check first/i)).toBeInTheDocument();
  });

  it('should show success message when ready', () => {
    // Arrange
    const passedCheck = createMockReadinessCheck(true);

    // Act
    render(
      <ReadinessBlocker
        isReady={true}
        lastCheck={passedCheck}
        failedReasons={null}
        onStartQA={vi.fn()}
      />
    );

    // Assert
    expect(screen.getByText(/ready for qa/i)).toBeInTheDocument();
    expect(screen.getByText(/all requirements met/i)).toBeInTheDocument();
  });
});

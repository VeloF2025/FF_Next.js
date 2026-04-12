/**
 * HandoverWizard Component Tests
 *
 * 🟢 WORKING: Comprehensive tests for handover wizard component
 *
 * Tests:
 * - Display handover gate checklist
 * - Validate all gates before handover
 * - Show gate failures clearly
 * - Create handover on submit
 * - Block handover when gates fail
 * - Allow handover when all gates pass
 * - Loading and error states
 * - Ownership transfer selection
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Mock } from 'vitest';
import { HandoverWizard } from '../../components/Handover/HandoverWizard';
import { HandoverType, OwnerType } from '../../types/handover';
import type { HandoverGateValidation } from '../../types/handover';

// Mock Clerk auth
vi.mock('@clerk/nextjs', () => ({
  useUser: vi.fn(() => ({
    user: { id: 'test-user-id', fullName: 'Test User' },
    isLoaded: true,
  })),
}));

// Mock fetch for API calls
global.fetch = vi.fn();

// Helper to create mock gate validation result
const createMockGateValidation = (canHandover: boolean): HandoverGateValidation => ({
  can_handover: canHandover,
  blocking_issues: canHandover ? [] : [
    {
      gate_name: 'photos_archived',
      severity: 'critical',
      message: 'At least one photo must be uploaded',
      resolution_hint: 'Upload photo evidence to ticket attachments',
    },
  ],
  warnings: canHandover ? [] : ['Pole number not populated - should be completed before QA handover'],
  gates_passed: [
    {
      gate_name: 'as_built_confirmed',
      passed: true,
      required: true,
      message: 'As-built data confirmed (DR, zone, pole, PON populated)',
    },
  ],
  gates_failed: canHandover ? [] : [
    {
      gate_name: 'photos_archived',
      passed: false,
      required: true,
      message: 'No photos archived',
    },
  ],
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

describe('HandoverWizard Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Initial Rendering', () => {
    it('should display handover gate checklist', async () => {
      // Arrange
      const validation = createMockGateValidation(true);
      (global.fetch as Mock).mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: validation,
        }),
      });

      // Act
      renderWithQueryClient(
        <HandoverWizard
          ticketId="ticket-123"
          handoverType={HandoverType.BUILD_TO_QA}
        />
      );

      // Assert
      await waitFor(() => {
        expect(screen.getByText(/handover checklist/i)).toBeInTheDocument();
      });
    });

    it('should show loading state while fetching gates', () => {
      // Arrange
      (global.fetch as Mock).mockImplementation(() => new Promise(() => {}));

      // Act
      renderWithQueryClient(
        <HandoverWizard
          ticketId="ticket-123"
          handoverType={HandoverType.BUILD_TO_QA}
        />
      );

      // Assert
      expect(screen.getByText(/validating handover gates/i)).toBeInTheDocument();
    });

    it('should show error state on fetch failure', async () => {
      // Arrange
      (global.fetch as Mock).mockRejectedValue(new Error('Network error'));

      // Act
      renderWithQueryClient(
        <HandoverWizard
          ticketId="ticket-123"
          handoverType={HandoverType.BUILD_TO_QA}
        />
      );

      // Assert
      await waitFor(() => {
        expect(screen.getByText(/failed to validate handover gates/i)).toBeInTheDocument();
      });
    });
  });

  describe('Gate Validation Display', () => {
    it('should display gates passed with success indicator', async () => {
      // Arrange
      const validation = createMockGateValidation(true);
      (global.fetch as Mock).mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: validation,
        }),
      });

      // Act
      renderWithQueryClient(
        <HandoverWizard
          ticketId="ticket-123"
          handoverType={HandoverType.BUILD_TO_QA}
        />
      );

      // Assert
      await waitFor(() => {
        expect(screen.getByText(/as-built data confirmed/i)).toBeInTheDocument();
      });
    });

    it('should display gates failed with error indicator', async () => {
      // Arrange
      const validation = createMockGateValidation(false);
      (global.fetch as Mock).mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: validation,
        }),
      });

      // Act
      renderWithQueryClient(
        <HandoverWizard
          ticketId="ticket-123"
          handoverType={HandoverType.BUILD_TO_QA}
        />
      );

      // Assert
      await waitFor(() => {
        expect(screen.getByText(/no photos archived/i)).toBeInTheDocument();
      });
    });

    it('should show blocking issues when gates fail', async () => {
      // Arrange
      const validation = createMockGateValidation(false);
      (global.fetch as Mock).mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: validation,
        }),
      });

      // Act
      renderWithQueryClient(
        <HandoverWizard
          ticketId="ticket-123"
          handoverType={HandoverType.BUILD_TO_QA}
        />
      );

      // Assert
      await waitFor(() => {
        expect(screen.getByText(/at least one photo must be uploaded/i)).toBeInTheDocument();
        expect(screen.getByText(/upload photo evidence/i)).toBeInTheDocument();
      });
    });

    it('should show warnings when present', async () => {
      // Arrange
      const validation = createMockGateValidation(false);
      (global.fetch as Mock).mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: validation,
        }),
      });

      // Act
      renderWithQueryClient(
        <HandoverWizard
          ticketId="ticket-123"
          handoverType={HandoverType.BUILD_TO_QA}
        />
      );

      // Assert
      await waitFor(() => {
        expect(screen.getByText(/pole number not populated/i)).toBeInTheDocument();
      });
    });
  });

  describe('Handover Submission', () => {
    it('should enable submit button when all gates pass', async () => {
      // Arrange
      const validation = createMockGateValidation(true);
      (global.fetch as Mock).mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: validation,
        }),
      });

      // Act
      renderWithQueryClient(
        <HandoverWizard
          ticketId="ticket-123"
          handoverType={HandoverType.BUILD_TO_QA}
        />
      );

      // Assert
      await waitFor(() => {
        const submitButton = screen.getByRole('button', { name: /complete handover/i });
        expect(submitButton).toBeEnabled();
      });
    });

    it('should disable submit button when gates fail', async () => {
      // Arrange
      const validation = createMockGateValidation(false);
      (global.fetch as Mock).mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: validation,
        }),
      });

      // Act
      renderWithQueryClient(
        <HandoverWizard
          ticketId="ticket-123"
          handoverType={HandoverType.BUILD_TO_QA}
        />
      );

      // Assert
      await waitFor(() => {
        const submitButton = screen.getByRole('button', { name: /complete handover/i });
        expect(submitButton).toBeDisabled();
      });
    });

    it('should create handover on submit', async () => {
      // Arrange
      const validation = createMockGateValidation(true);
      let fetchCallCount = 0;
      (global.fetch as Mock).mockImplementation((url: string) => {
        fetchCallCount++;
        // First call: gate validation
        if (fetchCallCount === 1) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              success: true,
              data: validation,
            }),
          });
        }
        // Second call: create handover
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: {
              id: 'handover-123',
              ticket_id: 'ticket-123',
              handover_type: HandoverType.BUILD_TO_QA,
            },
          }),
        });
      });

      const onComplete = vi.fn();

      // Act
      renderWithQueryClient(
        <HandoverWizard
          ticketId="ticket-123"
          handoverType={HandoverType.BUILD_TO_QA}
          onComplete={onComplete}
        />
      );

      // Assert
      await waitFor(() => {
        const submitButton = screen.getByRole('button', { name: /complete handover/i });
        expect(submitButton).toBeEnabled();
      });

      // Act - submit
      const submitButton = screen.getByRole('button', { name: /complete handover/i });
      fireEvent.click(submitButton);

      // Assert
      await waitFor(() => {
        expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({
          id: 'handover-123',
          ticket_id: 'ticket-123',
        }));
      });
    });

    it('should show error on handover creation failure', async () => {
      // Arrange
      const validation = createMockGateValidation(true);
      let fetchCallCount = 0;
      (global.fetch as Mock).mockImplementation(() => {
        fetchCallCount++;
        // First call: gate validation succeeds
        if (fetchCallCount === 1) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              success: true,
              data: validation,
            }),
          });
        }
        // Second call: handover creation fails
        return Promise.resolve({
          ok: false,
          json: async () => ({
            success: false,
            error: 'Failed to create handover',
          }),
        });
      });

      // Act
      renderWithQueryClient(
        <HandoverWizard
          ticketId="ticket-123"
          handoverType={HandoverType.BUILD_TO_QA}
        />
      );

      await waitFor(() => {
        const submitButton = screen.getByRole('button', { name: /complete handover/i });
        expect(submitButton).toBeEnabled();
      });

      // Act - submit
      const submitButton = screen.getByRole('button', { name: /complete handover/i });
      fireEvent.click(submitButton);

      // Assert
      await waitFor(() => {
        expect(screen.getByText(/failed to create handover/i)).toBeInTheDocument();
      });
    });
  });

  describe('Ownership Transfer', () => {
    it('should display ownership transfer fields for QA to Maintenance', async () => {
      // Arrange
      const validation = createMockGateValidation(true);
      (global.fetch as Mock).mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: validation,
        }),
      });

      // Act
      renderWithQueryClient(
        <HandoverWizard
          ticketId="ticket-123"
          handoverType={HandoverType.QA_TO_OPS}
          fromOwnerType={OwnerType.QA}
          toOwnerType={OwnerType.OPS}
        />
      );

      // Assert
      await waitFor(() => {
        expect(screen.getByText(/ownership transfer/i)).toBeInTheDocument();
      });
    });
  });
});

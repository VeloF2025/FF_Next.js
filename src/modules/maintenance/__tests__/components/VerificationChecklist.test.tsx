/**
 * VerificationChecklist Component Tests
 *
 * 🟢 WORKING: Comprehensive tests for 12-step verification checklist
 *
 * Tests:
 * - Display 12 verification steps
 * - Mark step complete on click
 * - Upload photo for step
 * - Show progress (7/12)
 * - Disable when not editable
 * - Handle loading and error states
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { VerificationChecklist } from '../../components/Verification/VerificationChecklist';
import { VerificationStep } from '../../types/verification';
import * as useVerificationHook from '../../hooks/useVerification';

// Mock the useVerification hook
vi.mock('../../hooks/useVerification', () => ({
  useVerification: vi.fn(),
  useUpdateVerificationStep: vi.fn(),
}));

// Mock Clerk auth
vi.mock('@clerk/nextjs', () => ({
  useUser: vi.fn(() => ({
    user: { id: 'test-user-id' },
    isLoaded: true,
  })),
}));

// Helper to create mock verification steps
const createMockSteps = (completedCount: number): VerificationStep[] => {
  return Array.from({ length: 12 }, (_, index) => ({
    id: `step-${index + 1}`,
    ticket_id: 'test-ticket-id',
    step_number: (index + 1) as any,
    step_name: `Step ${index + 1}`,
    step_description: `Description for step ${index + 1}`,
    is_complete: index < completedCount,
    completed_at: index < completedCount ? new Date() : null,
    completed_by: index < completedCount ? 'test-user-id' : null,
    photo_required: index !== 8, // Step 9 doesn't require photo
    photo_url: index < completedCount && index !== 8 ? `https://example.com/photo-${index + 1}.jpg` : null,
    photo_verified: index < completedCount,
    notes: null,
    created_at: new Date(),
  }));
};

// Helper to create mock progress
const createMockProgress = (completedSteps: number) => ({
  ticket_id: 'test-ticket-id',
  total_steps: 12,
  completed_steps: completedSteps,
  pending_steps: 12 - completedSteps,
  progress_percentage: Math.round((completedSteps / 12) * 100),
  all_steps_complete: completedSteps === 12,
  steps: createMockSteps(completedSteps),
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

describe('VerificationChecklist Component', () => {
  const mockMutate = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock for useUpdateVerificationStep
    (useVerificationHook.useUpdateVerificationStep as any) = vi.fn(() => ({
      mutate: mockMutate,
      isPending: false,
      isError: false,
      error: null,
    }));
  });

  describe('Initial Rendering', () => {
    it('should display 12 verification steps', () => {
      // Arrange
      const mockSteps = createMockSteps(0);
      const mockProgress = createMockProgress(0);

      (useVerificationHook.useVerification as any) = vi.fn(() => ({
        steps: mockSteps,
        progress: mockProgress,
        isLoading: false,
        isError: false,
        error: null,
      }));

      // Act
      renderWithQueryClient(<VerificationChecklist ticketId="test-ticket-id" />);

      // Assert
      const stepItems = screen.getAllByRole('listitem');
      expect(stepItems).toHaveLength(12);
    });

    it('should show progress indicator (0/12)', () => {
      // Arrange
      const mockSteps = createMockSteps(0);
      const mockProgress = createMockProgress(0);

      (useVerificationHook.useVerification as any) = vi.fn(() => ({
        steps: mockSteps,
        progress: mockProgress,
        isLoading: false,
        isError: false,
        error: null,
      }));

      // Act
      renderWithQueryClient(<VerificationChecklist ticketId="test-ticket-id" />);

      // Assert
      expect(screen.getByText(/0\/12/i)).toBeInTheDocument();
      expect(screen.getByText(/0%/i)).toBeInTheDocument();
    });

    it('should show progress indicator (7/12)', () => {
      // Arrange
      const mockSteps = createMockSteps(7);
      const mockProgress = createMockProgress(7);

      (useVerificationHook.useVerification as any) = vi.fn(() => ({
        steps: mockSteps,
        progress: mockProgress,
        isLoading: false,
        isError: false,
        error: null,
      }));

      // Act
      renderWithQueryClient(<VerificationChecklist ticketId="test-ticket-id" />);

      // Assert
      expect(screen.getByText(/7\/12/i)).toBeInTheDocument();
      expect(screen.getByText(/58%/i)).toBeInTheDocument();
    });

    it('should show loading state', () => {
      // Arrange
      (useVerificationHook.useVerification as any) = vi.fn(() => ({
        steps: undefined,
        progress: undefined,
        isLoading: true,
        isError: false,
        error: null,
      }));

      // Act
      renderWithQueryClient(<VerificationChecklist ticketId="test-ticket-id" />);

      // Assert
      expect(screen.getByText(/loading/i)).toBeInTheDocument();
    });

    it('should show error state', () => {
      // Arrange
      (useVerificationHook.useVerification as any) = vi.fn(() => ({
        steps: undefined,
        progress: undefined,
        isLoading: false,
        isError: true,
        error: new Error('Failed to load verification steps'),
      }));

      // Act
      renderWithQueryClient(<VerificationChecklist ticketId="test-ticket-id" />);

      // Assert
      expect(screen.getByText(/failed to load/i)).toBeInTheDocument();
    });
  });

  describe('Step Completion', () => {
    it('should mark step as complete when checkbox clicked', async () => {
      // Arrange
      const mockSteps = createMockSteps(0);
      const mockProgress = createMockProgress(0);

      (useVerificationHook.useVerification as any) = vi.fn(() => ({
        steps: mockSteps,
        progress: mockProgress,
        isLoading: false,
        isError: false,
        error: null,
      }));

      // Act
      renderWithQueryClient(<VerificationChecklist ticketId="test-ticket-id" editable={true} />);

      const checkboxes = screen.getAllByRole('checkbox');
      fireEvent.click(checkboxes[0]);

      // Assert
      await waitFor(() => {
        expect(mockMutate).toHaveBeenCalledWith({
          ticketId: 'test-ticket-id',
          stepNumber: 1,
          payload: expect.objectContaining({
            is_complete: true,
            completed_by: 'test-user-id',
          }),
        });
      });
    });

    it('should unmark step when unchecking checkbox', async () => {
      // Arrange
      const mockSteps = createMockSteps(3);
      const mockProgress = createMockProgress(3);

      (useVerificationHook.useVerification as any) = vi.fn(() => ({
        steps: mockSteps,
        progress: mockProgress,
        isLoading: false,
        isError: false,
        error: null,
      }));

      // Act
      renderWithQueryClient(<VerificationChecklist ticketId="test-ticket-id" editable={true} />);

      const checkboxes = screen.getAllByRole('checkbox');
      fireEvent.click(checkboxes[0]); // Uncheck first step

      // Assert
      await waitFor(() => {
        expect(mockMutate).toHaveBeenCalledWith({
          ticketId: 'test-ticket-id',
          stepNumber: 1,
          payload: expect.objectContaining({
            is_complete: false,
          }),
        });
      });
    });

    it('should disable checkboxes when not editable', () => {
      // Arrange
      const mockSteps = createMockSteps(0);
      const mockProgress = createMockProgress(0);

      (useVerificationHook.useVerification as any) = vi.fn(() => ({
        steps: mockSteps,
        progress: mockProgress,
        isLoading: false,
        isError: false,
        error: null,
      }));

      // Act
      renderWithQueryClient(<VerificationChecklist ticketId="test-ticket-id" editable={false} />);

      // Assert
      const checkboxes = screen.getAllByRole('checkbox');
      checkboxes.forEach(checkbox => {
        expect(checkbox).toBeDisabled();
      });
    });
  });

  describe('Photo Upload', () => {
    it('should show photo upload button for steps requiring photos', () => {
      // Arrange
      const mockSteps = createMockSteps(0);
      const mockProgress = createMockProgress(0);

      (useVerificationHook.useVerification as any) = vi.fn(() => ({
        steps: mockSteps,
        progress: mockProgress,
        isLoading: false,
        isError: false,
        error: null,
      }));

      // Act
      renderWithQueryClient(<VerificationChecklist ticketId="test-ticket-id" editable={true} />);

      // Assert - Should have 11 photo upload buttons (step 9 doesn't require photo)
      const uploadButtons = screen.getAllByText(/upload photo/i);
      expect(uploadButtons).toHaveLength(11);
    });

    it('should not show photo upload for step 9', () => {
      // Arrange
      const mockSteps = createMockSteps(0);
      const mockProgress = createMockProgress(0);

      (useVerificationHook.useVerification as any) = vi.fn(() => ({
        steps: mockSteps,
        progress: mockProgress,
        isLoading: false,
        isError: false,
        error: null,
      }));

      // Act
      renderWithQueryClient(<VerificationChecklist ticketId="test-ticket-id" editable={true} />);

      // Assert - Step 9 should not have photo upload (photo_required = false for step 9)
      const stepItems = screen.getAllByRole('listitem');
      const step9 = stepItems[8]; // 0-indexed

      // Step 9 should not contain "Photo Required" text
      expect(step9.textContent).not.toMatch(/photo required/i);
    });

    it('should display photo thumbnail when photo is uploaded', () => {
      // Arrange
      const mockSteps = createMockSteps(3);
      const mockProgress = createMockProgress(3);

      (useVerificationHook.useVerification as any) = vi.fn(() => ({
        steps: mockSteps,
        progress: mockProgress,
        isLoading: false,
        isError: false,
        error: null,
      }));

      // Act
      renderWithQueryClient(<VerificationChecklist ticketId="test-ticket-id" />);

      // Assert - Should have photo thumbnails for completed steps
      const photoThumbnails = screen.getAllByAltText(/photo for step/i);
      expect(photoThumbnails.length).toBeGreaterThan(0);
    });

    it('should disable photo upload when not editable', () => {
      // Arrange
      const mockSteps = createMockSteps(0);
      const mockProgress = createMockProgress(0);

      (useVerificationHook.useVerification as any) = vi.fn(() => ({
        steps: mockSteps,
        progress: mockProgress,
        isLoading: false,
        isError: false,
        error: null,
      }));

      // Act
      renderWithQueryClient(<VerificationChecklist ticketId="test-ticket-id" editable={false} />);

      // Assert
      // Photo upload components should still be rendered but disabled
      const fileInputs = screen.getAllByLabelText(/upload photo/i);
      fileInputs.forEach(input => {
        expect(input).toBeDisabled();
      });
    });
  });

  describe('Progress Display', () => {
    it('should show correct progress percentage', () => {
      // Arrange
      const mockSteps = createMockSteps(6);
      const mockProgress = createMockProgress(6);

      (useVerificationHook.useVerification as any) = vi.fn(() => ({
        steps: mockSteps,
        progress: mockProgress,
        isLoading: false,
        isError: false,
        error: null,
      }));

      // Act
      renderWithQueryClient(<VerificationChecklist ticketId="test-ticket-id" />);

      // Assert
      expect(screen.getByText(/6\/12/i)).toBeInTheDocument();
      expect(screen.getByText(/50%/i)).toBeInTheDocument();
    });

    it('should show completion message when all steps complete', () => {
      // Arrange
      const mockSteps = createMockSteps(12);
      const mockProgress = createMockProgress(12);

      (useVerificationHook.useVerification as any) = vi.fn(() => ({
        steps: mockSteps,
        progress: mockProgress,
        isLoading: false,
        isError: false,
        error: null,
      }));

      // Act
      renderWithQueryClient(<VerificationChecklist ticketId="test-ticket-id" />);

      // Assert
      expect(screen.getByText(/12\/12/i)).toBeInTheDocument();
      expect(screen.getByText(/complete!/i)).toBeInTheDocument();
    });
  });

  describe('Step Categories', () => {
    it('should group steps by category', () => {
      // Arrange
      const mockSteps = createMockSteps(0);
      const mockProgress = createMockProgress(0);

      (useVerificationHook.useVerification as any) = vi.fn(() => ({
        steps: mockSteps,
        progress: mockProgress,
        isLoading: false,
        isError: false,
        error: null,
      }));

      // Act
      renderWithQueryClient(<VerificationChecklist ticketId="test-ticket-id" groupByCategory={true} />);

      // Assert - Look for category headers (h4 elements)
      const categoryHeaders = screen.getAllByRole('heading', { level: 4 });
      const headerTexts = categoryHeaders.map(h => h.textContent?.toLowerCase());

      expect(headerTexts).toContain('preparation');
      expect(headerTexts).toContain('installation');
      expect(headerTexts).toContain('testing');
      expect(headerTexts).toContain('documentation');
    });

    it('should show steps in linear order when not grouped', () => {
      // Arrange
      const mockSteps = createMockSteps(0);
      const mockProgress = createMockProgress(0);

      (useVerificationHook.useVerification as any) = vi.fn(() => ({
        steps: mockSteps,
        progress: mockProgress,
        isLoading: false,
        isError: false,
        error: null,
      }));

      // Act
      renderWithQueryClient(<VerificationChecklist ticketId="test-ticket-id" groupByCategory={false} />);

      // Assert
      const stepItems = screen.getAllByRole('listitem');
      expect(stepItems).toHaveLength(12);

      // Should not show category headers as uppercase heading (but category badges will still exist in steps)
      const categoryHeaders = screen.queryAllByText(/preparation/i, {
        selector: 'h4'
      });
      expect(categoryHeaders).toHaveLength(0);
    });
  });
});

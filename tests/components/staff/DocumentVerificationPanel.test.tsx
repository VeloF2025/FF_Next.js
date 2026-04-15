/**
 * Tests for DocumentVerificationPanel component (TDD)
 * Admin-only component for document verification workflow
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DocumentVerificationPanel } from '../../../src/components/staff/DocumentVerificationPanel';
import type { StaffDocument } from '../../../src/types/staff-document.types';

// Mock logger
vi.mock('@/lib/logger', () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), getLogs: vi.fn(() => []), clearLogs: vi.fn() },
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe('DocumentVerificationPanel', () => {
  const mockDocument: StaffDocument = {
    id: 'doc-123',
    staffId: 'staff-456',
    documentType: 'sa_id',
    documentName: 'South African ID Card',
    fileUrl: 'https://storage.example.com/documents/id-card.pdf',
    fileSize: 2048000,
    mimeType: 'application/pdf',
    expiryDate: '2028-06-15',
    issuedDate: '2018-06-15',
    issuingAuthority: 'Department of Home Affairs',
    documentNumber: '9812015012085',
    verificationStatus: 'pending',
    createdAt: '2024-01-15T10:30:00Z',
    updatedAt: '2024-01-15T10:30:00Z',
    staff: {
      id: 'staff-456',
      name: 'John Doe',
    },
  };

  const mockVerifiedDocument: StaffDocument = {
    ...mockDocument,
    id: 'doc-verified',
    verificationStatus: 'verified',
    verifiedBy: 'admin-789',
    verifiedAt: '2024-01-16T14:00:00Z',
    verificationNotes: 'Document appears genuine. ID number verified.',
    verifier: {
      id: 'admin-789',
      name: 'Jane Admin',
    },
  };

  const mockRejectedDocument: StaffDocument = {
    ...mockDocument,
    id: 'doc-rejected',
    verificationStatus: 'rejected',
    verifiedBy: 'admin-789',
    verifiedAt: '2024-01-16T14:00:00Z',
    verificationNotes: 'Document is blurry and unreadable. Please upload a clearer copy.',
    verifier: {
      id: 'admin-789',
      name: 'Jane Admin',
    },
  };

  const defaultProps = {
    document: mockDocument,
    onVerify: vi.fn(),
    onClose: vi.fn(),
    isAdmin: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Document Details Display', () => {
    it('should display document name', () => {
      render(<DocumentVerificationPanel {...defaultProps} />);
      expect(screen.getByText('South African ID Card')).toBeInTheDocument();
    });

    it('should display document type label', () => {
      render(<DocumentVerificationPanel {...defaultProps} />);
      expect(screen.getByText('SA ID Document')).toBeInTheDocument();
    });

    it('should display staff name', () => {
      render(<DocumentVerificationPanel {...defaultProps} />);
      expect(screen.getByText('John Doe')).toBeInTheDocument();
    });

    it('should display document number when available', () => {
      render(<DocumentVerificationPanel {...defaultProps} />);
      expect(screen.getByText('9812015012085')).toBeInTheDocument();
    });

    it('should display issuing authority when available', () => {
      render(<DocumentVerificationPanel {...defaultProps} />);
      expect(screen.getByText('Department of Home Affairs')).toBeInTheDocument();
    });

    it('should display issued date when available', () => {
      render(<DocumentVerificationPanel {...defaultProps} />);
      expect(screen.getByText(/2018/)).toBeInTheDocument();
    });

    it('should display expiry date when available', () => {
      render(<DocumentVerificationPanel {...defaultProps} />);
      expect(screen.getByText(/2028/)).toBeInTheDocument();
    });

    it('should display current verification status', () => {
      render(<DocumentVerificationPanel {...defaultProps} />);
      expect(screen.getByText('Pending Review')).toBeInTheDocument();
    });

    it('should display file size in human-readable format', () => {
      render(<DocumentVerificationPanel {...defaultProps} />);
      expect(screen.getByText(/2.*MB|2,048.*KB/i)).toBeInTheDocument();
    });

    it('should display upload date', () => {
      render(<DocumentVerificationPanel {...defaultProps} />);
      expect(screen.getByText(/Jan.*15.*2024|15.*Jan.*2024/i)).toBeInTheDocument();
    });
  });

  describe('Document Preview', () => {
    it('should display download/view link', () => {
      render(<DocumentVerificationPanel {...defaultProps} />);
      const link = screen.getByRole('link', { name: /view|download|open/i });
      expect(link).toHaveAttribute('href', mockDocument.fileUrl);
    });

    it('should open link in new tab', () => {
      render(<DocumentVerificationPanel {...defaultProps} />);
      const link = screen.getByRole('link', { name: /view|download|open/i });
      expect(link).toHaveAttribute('target', '_blank');
    });

    it('should show PDF preview placeholder for PDF documents', () => {
      render(<DocumentVerificationPanel {...defaultProps} />);
      expect(screen.getByText(/pdf|document preview/i)).toBeInTheDocument();
    });

    it('should show image preview for image documents', () => {
      const imageDoc = {
        ...mockDocument,
        mimeType: 'image/jpeg',
        fileUrl: 'https://storage.example.com/documents/id-scan.jpg',
      };
      render(<DocumentVerificationPanel {...defaultProps} document={imageDoc} />);
      const img = screen.getByRole('img');
      expect(img).toHaveAttribute('src', imageDoc.fileUrl);
    });
  });

  describe('Verification Actions (Admin Only)', () => {
    it('should show Verify button for admin users', () => {
      render(<DocumentVerificationPanel {...defaultProps} />);
      expect(screen.getByRole('button', { name: /verify/i })).toBeInTheDocument();
    });

    it('should show Reject button for admin users', () => {
      render(<DocumentVerificationPanel {...defaultProps} />);
      expect(screen.getByRole('button', { name: /reject/i })).toBeInTheDocument();
    });

    it('should not show verification buttons for non-admin users', () => {
      render(<DocumentVerificationPanel {...defaultProps} isAdmin={false} />);
      expect(screen.queryByRole('button', { name: /verify/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /reject/i })).not.toBeInTheDocument();
    });

    it('should show notes textarea for admin users', () => {
      render(<DocumentVerificationPanel {...defaultProps} />);
      expect(screen.getByRole('textbox', { name: /notes/i })).toBeInTheDocument();
    });

    it('should not show notes textarea for non-admin users', () => {
      render(<DocumentVerificationPanel {...defaultProps} isAdmin={false} />);
      expect(screen.queryByRole('textbox', { name: /notes/i })).not.toBeInTheDocument();
    });

    it('should disable actions for already verified documents', () => {
      render(<DocumentVerificationPanel {...defaultProps} document={mockVerifiedDocument} />);
      expect(screen.queryByRole('button', { name: /^verify$/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^reject$/i })).not.toBeInTheDocument();
    });

    it('should disable actions for already rejected documents', () => {
      render(<DocumentVerificationPanel {...defaultProps} document={mockRejectedDocument} />);
      expect(screen.queryByRole('button', { name: /^verify$/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^reject$/i })).not.toBeInTheDocument();
    });
  });

  describe('Verification Submission', () => {
    it('should call onVerify with "verified" status when Verify is clicked', async () => {
      const onVerify = vi.fn().mockResolvedValue({ success: true });
      const user = userEvent.setup();

      render(<DocumentVerificationPanel {...defaultProps} onVerify={onVerify} />);

      await user.click(screen.getByRole('button', { name: /verify/i }));

      expect(onVerify).toHaveBeenCalledWith(
        mockDocument.id,
        expect.objectContaining({
          status: 'verified',
        })
      );
    });

    it('should call onVerify with "rejected" status when Reject is clicked', async () => {
      const onVerify = vi.fn().mockResolvedValue({ success: true });
      const user = userEvent.setup();

      render(<DocumentVerificationPanel {...defaultProps} onVerify={onVerify} />);

      // Add required notes for rejection
      const notesInput = screen.getByRole('textbox', { name: /notes/i });
      await user.type(notesInput, 'Document quality is poor');

      await user.click(screen.getByRole('button', { name: /reject/i }));

      expect(onVerify).toHaveBeenCalledWith(
        mockDocument.id,
        expect.objectContaining({
          status: 'rejected',
          notes: 'Document quality is poor',
        })
      );
    });

    it('should include notes in verification submission', async () => {
      const onVerify = vi.fn().mockResolvedValue({ success: true });
      const user = userEvent.setup();

      render(<DocumentVerificationPanel {...defaultProps} onVerify={onVerify} />);

      const notesInput = screen.getByRole('textbox', { name: /notes/i });
      await user.type(notesInput, 'Document verified successfully');
      await user.click(screen.getByRole('button', { name: /verify/i }));

      expect(onVerify).toHaveBeenCalledWith(
        mockDocument.id,
        expect.objectContaining({
          status: 'verified',
          notes: 'Document verified successfully',
        })
      );
    });

    it('should require notes when rejecting', async () => {
      const onVerify = vi.fn().mockResolvedValue({ success: true });
      const user = userEvent.setup();

      render(<DocumentVerificationPanel {...defaultProps} onVerify={onVerify} />);

      await user.click(screen.getByRole('button', { name: /reject/i }));

      // Should show error or prevent submission
      expect(screen.getByText(/notes.*required|provide.*reason/i)).toBeInTheDocument();
      expect(onVerify).not.toHaveBeenCalled();
    });

    it('should show loading state during submission', async () => {
      let resolveVerify: (value: unknown) => void;
      const onVerify = vi.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveVerify = resolve;
          })
      );
      const user = userEvent.setup();

      render(<DocumentVerificationPanel {...defaultProps} onVerify={onVerify} />);

      await user.click(screen.getByRole('button', { name: /verify/i }));

      expect(screen.getByText(/verifying|submitting|loading/i)).toBeInTheDocument();

      resolveVerify!({ success: true });
    });

    it('should disable buttons during submission', async () => {
      let resolveVerify: (value: unknown) => void;
      const onVerify = vi.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveVerify = resolve;
          })
      );
      const user = userEvent.setup();

      render(<DocumentVerificationPanel {...defaultProps} onVerify={onVerify} />);

      await user.click(screen.getByRole('button', { name: /verify/i }));

      await waitFor(() => {
        const verifyButton = screen.queryByRole('button', { name: /verify/i });
        const rejectButton = screen.queryByRole('button', { name: /reject/i });
        // Buttons should be disabled or not present
        expect(verifyButton?.hasAttribute('disabled') || !verifyButton).toBe(true);
      });

      resolveVerify!({ success: true });
    });

    it('should show success message after verification', async () => {
      const onVerify = vi.fn().mockResolvedValue({ success: true });
      const user = userEvent.setup();

      render(<DocumentVerificationPanel {...defaultProps} onVerify={onVerify} />);

      await user.click(screen.getByRole('button', { name: /verify/i }));

      await waitFor(() => {
        expect(screen.getByText(/verified|success/i)).toBeInTheDocument();
      });
    });

    it('should show error message on verification failure', async () => {
      const onVerify = vi.fn().mockRejectedValue(new Error('Verification failed'));
      const user = userEvent.setup();

      render(<DocumentVerificationPanel {...defaultProps} onVerify={onVerify} />);

      await user.click(screen.getByRole('button', { name: /verify/i }));

      await waitFor(() => {
        expect(screen.getByText(/failed|error/i)).toBeInTheDocument();
      });
    });

    it('should call onClose after successful verification', async () => {
      vi.useFakeTimers();
      const onVerify = vi.fn().mockResolvedValue({ success: true });
      const onClose = vi.fn();
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

      render(
        <DocumentVerificationPanel {...defaultProps} onVerify={onVerify} onClose={onClose} />
      );

      await user.click(screen.getByRole('button', { name: /verify/i }));

      // Wait for success state
      await waitFor(() => {
        expect(screen.getByText(/verified|success/i)).toBeInTheDocument();
      });

      // Advance timer past the 1500ms delay
      vi.advanceTimersByTime(2000);

      expect(onClose).toHaveBeenCalled();

      vi.useRealTimers();
    });
  });

  describe('Verification History', () => {
    it('should show verifier name for verified documents', () => {
      render(<DocumentVerificationPanel {...defaultProps} document={mockVerifiedDocument} />);
      expect(screen.getByText('Jane Admin')).toBeInTheDocument();
    });

    it('should show verification date for verified documents', () => {
      render(<DocumentVerificationPanel {...defaultProps} document={mockVerifiedDocument} />);
      expect(screen.getByText(/Jan.*16.*2024|16.*Jan.*2024/i)).toBeInTheDocument();
    });

    it('should show verification notes for verified documents', () => {
      render(<DocumentVerificationPanel {...defaultProps} document={mockVerifiedDocument} />);
      expect(screen.getByText('Document appears genuine. ID number verified.')).toBeInTheDocument();
    });

    it('should show rejection reason for rejected documents', () => {
      render(<DocumentVerificationPanel {...defaultProps} document={mockRejectedDocument} />);
      expect(
        screen.getByText('Document is blurry and unreadable. Please upload a clearer copy.')
      ).toBeInTheDocument();
    });

    it('should show "Verified" status badge for verified documents', () => {
      render(<DocumentVerificationPanel {...defaultProps} document={mockVerifiedDocument} />);
      expect(screen.getByText('Verified')).toBeInTheDocument();
    });

    it('should show "Rejected" status badge for rejected documents', () => {
      render(<DocumentVerificationPanel {...defaultProps} document={mockRejectedDocument} />);
      expect(screen.getByText('Rejected')).toBeInTheDocument();
    });
  });

  describe('Close Button', () => {
    it('should show close button', () => {
      render(<DocumentVerificationPanel {...defaultProps} />);
      // Check for footer close button (there's also header X button)
      const closeButtons = screen.getAllByRole('button', { name: /close/i });
      expect(closeButtons.length).toBeGreaterThanOrEqual(1);
    });

    it('should call onClose when close button is clicked', async () => {
      const onClose = vi.fn();
      const user = userEvent.setup();

      render(<DocumentVerificationPanel {...defaultProps} onClose={onClose} />);

      // Click the footer Close button (full text "Close")
      const closeButtons = screen.getAllByRole('button', { name: /close/i });
      await user.click(closeButtons[closeButtons.length - 1]); // Footer button is last

      expect(onClose).toHaveBeenCalled();
    });
  });

  describe('Status Styling', () => {
    it('should show pending status with yellow/warning styling', () => {
      const { container } = render(<DocumentVerificationPanel {...defaultProps} />);
      // Look for yellow/amber badge styling
      expect(
        container.querySelector('.bg-yellow-100, .bg-amber-100, [class*="yellow"], [class*="amber"]')
      ).toBeTruthy();
    });

    it('should show verified status with green styling', () => {
      const { container } = render(
        <DocumentVerificationPanel {...defaultProps} document={mockVerifiedDocument} />
      );
      expect(container.querySelector('[class*="green"]')).toBeTruthy();
    });

    it('should show rejected status with red styling', () => {
      const { container } = render(
        <DocumentVerificationPanel {...defaultProps} document={mockRejectedDocument} />
      );
      expect(container.querySelector('[class*="red"]')).toBeTruthy();
    });
  });

  describe('Accessibility', () => {
    it('should have proper aria labels on action buttons', () => {
      render(<DocumentVerificationPanel {...defaultProps} />);
      expect(
        screen.getByRole('button', { name: /verify/i }).getAttribute('aria-label') ||
          screen.getByRole('button', { name: /verify/i }).textContent
      ).toBeTruthy();
    });

    it('should have proper label for notes textarea', () => {
      render(<DocumentVerificationPanel {...defaultProps} />);
      const textarea = screen.getByRole('textbox', { name: /notes/i });
      expect(textarea).toBeInTheDocument();
    });
  });

  describe('Document Without Optional Fields', () => {
    it('should handle document without expiry date', () => {
      const docWithoutExpiry = { ...mockDocument, expiryDate: undefined };
      render(<DocumentVerificationPanel {...defaultProps} document={docWithoutExpiry} />);
      expect(screen.queryByText(/expiry/i)).not.toBeInTheDocument();
    });

    it('should handle document without issuing authority', () => {
      const docWithoutAuthority = { ...mockDocument, issuingAuthority: undefined };
      render(<DocumentVerificationPanel {...defaultProps} document={docWithoutAuthority} />);
      expect(screen.queryByText('Department of Home Affairs')).not.toBeInTheDocument();
    });

    it('should handle document without document number', () => {
      const docWithoutNumber = { ...mockDocument, documentNumber: undefined };
      render(<DocumentVerificationPanel {...defaultProps} document={docWithoutNumber} />);
      expect(screen.queryByText('9812015012085')).not.toBeInTheDocument();
    });

    it('should handle document without staff data', () => {
      const docWithoutStaff = { ...mockDocument, staff: undefined };
      render(<DocumentVerificationPanel {...defaultProps} document={docWithoutStaff} />);
      // Should not crash and should show some fallback
      expect(screen.getByText('South African ID Card')).toBeInTheDocument();
    });
  });
});

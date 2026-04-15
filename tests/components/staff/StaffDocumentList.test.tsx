/**
 * Tests for StaffDocumentList component
 * Tests rendering, filtering, actions, and interactions
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StaffDocumentList } from '@/components/staff/StaffDocumentList';
import { StaffDocument, VerificationStatus } from '@/types/staff-document.types';

// Mock the logger
vi.mock('@/lib/logger', () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), getLogs: vi.fn(() => []), clearLogs: vi.fn() },
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock the upload form component
vi.mock('@/components/staff/StaffDocumentUploadForm', () => ({
  StaffDocumentUploadForm: ({ onCancel, onSuccess }: { onCancel: () => void; onSuccess: () => void }) => (
    <div data-testid="upload-form-modal">
      <button onClick={onCancel}>Cancel Upload</button>
      <button onClick={onSuccess}>Complete Upload</button>
    </div>
  ),
}));

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock confirm dialog
const mockConfirm = vi.fn(() => true);
global.confirm = mockConfirm;

describe('StaffDocumentList', () => {
  const staffId = 'staff-123';
  const mockOnVerify = vi.fn();

  // Sample documents for testing
  const createMockDocuments = (overrides: Partial<StaffDocument>[] = []): StaffDocument[] => {
    const baseDocuments: StaffDocument[] = [
      {
        id: 'doc-1',
        staffId: 'staff-123',
        documentType: 'sa_id',
        documentName: 'SA ID Card',
        fileUrl: 'https://example.com/doc1.pdf',
        fileSize: 1024,
        mimeType: 'application/pdf',
        verificationStatus: 'verified',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'doc-2',
        staffId: 'staff-123',
        documentType: 'drivers_license',
        documentName: 'Driving License',
        fileUrl: 'https://example.com/doc2.pdf',
        fileSize: 2048,
        mimeType: 'application/pdf',
        verificationStatus: 'pending',
        expiryDate: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // 15 days from now
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'doc-3',
        staffId: 'staff-123',
        documentType: 'certification',
        documentName: 'Fiber Certification',
        fileUrl: 'https://example.com/doc3.pdf',
        fileSize: 512,
        mimeType: 'application/pdf',
        verificationStatus: 'rejected',
        documentNumber: 'CERT-12345',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];

    return baseDocuments.map((doc, index) => ({
      ...doc,
      ...overrides[index],
    }));
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockConfirm.mockReturnValue(true);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  const setupFetchMock = (documents: StaffDocument[] = createMockDocuments()) => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ documents, count: documents.length }),
    });
  };

  describe('Loading State', () => {
    it('should show loading spinner while fetching documents', async () => {
      // Don't resolve the fetch immediately
      mockFetch.mockImplementation(() => new Promise(() => {}));

      render(<StaffDocumentList staffId={staffId} />);

      // Should show loading spinner
      expect(document.querySelector('.animate-spin')).toBeInTheDocument();
    });
  });

  describe('Empty State', () => {
    it('should show empty state when no documents exist', async () => {
      setupFetchMock([]);

      render(<StaffDocumentList staffId={staffId} />);

      await waitFor(() => {
        expect(screen.getByText('No documents found')).toBeInTheDocument();
      });
    });

    it('should show filter hint when documents exist but filters hide all', async () => {
      setupFetchMock();

      render(<StaffDocumentList staffId={staffId} />);

      await waitFor(() => {
        expect(screen.getByText('SA ID Card')).toBeInTheDocument();
      });

      // Filter to show only expired status (none exist)
      const statusFilter = screen.getAllByRole('combobox')[1]; // Second select is status
      fireEvent.change(statusFilter, { target: { value: 'expired' } });

      await waitFor(() => {
        expect(screen.getByText('No documents found')).toBeInTheDocument();
        expect(screen.getByText('Try adjusting your filters')).toBeInTheDocument();
      });
    });
  });

  describe('Document Rendering', () => {
    it('should render all documents', async () => {
      setupFetchMock();

      render(<StaffDocumentList staffId={staffId} />);

      await waitFor(() => {
        expect(screen.getByText('SA ID Card')).toBeInTheDocument();
        expect(screen.getByText('Driving License')).toBeInTheDocument();
        expect(screen.getByText('Fiber Certification')).toBeInTheDocument();
      });
    });

    it('should show document type labels', async () => {
      setupFetchMock();

      render(<StaffDocumentList staffId={staffId} />);

      await waitFor(() => {
        expect(screen.getByText('SA ID Document')).toBeInTheDocument();
        expect(screen.getByText("Driver's License")).toBeInTheDocument();
        expect(screen.getByText('Industry Certification')).toBeInTheDocument();
      });
    });

    it('should show document numbers when present', async () => {
      setupFetchMock();

      render(<StaffDocumentList staffId={staffId} />);

      await waitFor(() => {
        expect(screen.getByText('#CERT-12345')).toBeInTheDocument();
      });
    });

    it('should show verification status badges', async () => {
      setupFetchMock();

      render(<StaffDocumentList staffId={staffId} />);

      await waitFor(() => {
        // Look for badge elements specifically (they have specific classes)
        const verifiedBadges = document.querySelectorAll('.bg-green-100');
        const pendingBadges = document.querySelectorAll('.bg-yellow-100');
        const rejectedBadges = document.querySelectorAll('.bg-red-100');

        expect(verifiedBadges.length).toBeGreaterThan(0);
        expect(pendingBadges.length).toBeGreaterThan(0);
        expect(rejectedBadges.length).toBeGreaterThan(0);
      });
    });
  });

  describe('Expiry Warnings', () => {
    it('should show warning for documents expiring within 30 days', async () => {
      const docs = createMockDocuments();
      docs[1].expiryDate = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      setupFetchMock(docs);

      render(<StaffDocumentList staffId={staffId} />);

      await waitFor(() => {
        expect(screen.getByText(/expires in 15 days/i)).toBeInTheDocument();
      });
    });

    it('should show urgent warning for documents expiring within 7 days', async () => {
      const docs = createMockDocuments();
      docs[1].expiryDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      setupFetchMock(docs);

      render(<StaffDocumentList staffId={staffId} />);

      await waitFor(() => {
        expect(screen.getByText(/expires in 5 days/i)).toBeInTheDocument();
      });
    });

    it('should show expired warning for expired documents', async () => {
      const docs = createMockDocuments();
      docs[1].expiryDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      setupFetchMock(docs);

      render(<StaffDocumentList staffId={staffId} />);

      await waitFor(() => {
        expect(screen.getByText(/expired 10 days ago/i)).toBeInTheDocument();
      });
    });
  });

  describe('Category Filtering', () => {
    it('should filter documents by category', async () => {
      setupFetchMock();

      render(<StaffDocumentList staffId={staffId} />);

      await waitFor(() => {
        expect(screen.getByText('SA ID Card')).toBeInTheDocument();
      });

      // Filter to identity category
      const categoryFilter = screen.getAllByRole('combobox')[0]; // First select is category
      fireEvent.change(categoryFilter, { target: { value: 'identity' } });

      await waitFor(() => {
        expect(screen.getByText('SA ID Card')).toBeInTheDocument();
        expect(screen.getByText('Driving License')).toBeInTheDocument();
        expect(screen.queryByText('Fiber Certification')).not.toBeInTheDocument();
      });
    });

    it('should show all documents when "All Categories" is selected', async () => {
      setupFetchMock();

      render(<StaffDocumentList staffId={staffId} />);

      await waitFor(() => {
        expect(screen.getByText('SA ID Card')).toBeInTheDocument();
      });

      // Select qualifications first
      const categoryFilter = screen.getAllByRole('combobox')[0];
      fireEvent.change(categoryFilter, { target: { value: 'qualifications' } });

      await waitFor(() => {
        expect(screen.queryByText('SA ID Card')).not.toBeInTheDocument();
      });

      // Then select all
      fireEvent.change(categoryFilter, { target: { value: 'all' } });

      await waitFor(() => {
        expect(screen.getByText('SA ID Card')).toBeInTheDocument();
        expect(screen.getByText('Driving License')).toBeInTheDocument();
        expect(screen.getByText('Fiber Certification')).toBeInTheDocument();
      });
    });
  });

  describe('Status Filtering', () => {
    it('should filter documents by verification status', async () => {
      setupFetchMock();

      render(<StaffDocumentList staffId={staffId} />);

      await waitFor(() => {
        expect(screen.getByText('SA ID Card')).toBeInTheDocument();
      });

      // Filter to pending only
      const statusFilter = screen.getAllByRole('combobox')[1];
      fireEvent.change(statusFilter, { target: { value: 'pending' } });

      await waitFor(() => {
        expect(screen.queryByText('SA ID Card')).not.toBeInTheDocument();
        expect(screen.getByText('Driving License')).toBeInTheDocument();
        expect(screen.queryByText('Fiber Certification')).not.toBeInTheDocument();
      });
    });
  });

  describe('Search Filtering', () => {
    it('should filter documents by name search', async () => {
      setupFetchMock();

      render(<StaffDocumentList staffId={staffId} />);

      await waitFor(() => {
        expect(screen.getByText('SA ID Card')).toBeInTheDocument();
      });

      // Search for "license"
      const searchInput = screen.getByPlaceholderText('Search documents...');
      fireEvent.change(searchInput, { target: { value: 'license' } });

      await waitFor(() => {
        expect(screen.queryByText('SA ID Card')).not.toBeInTheDocument();
        expect(screen.getByText('Driving License')).toBeInTheDocument();
        expect(screen.queryByText('Fiber Certification')).not.toBeInTheDocument();
      });
    });

    it('should filter documents by document number search', async () => {
      setupFetchMock();

      render(<StaffDocumentList staffId={staffId} />);

      await waitFor(() => {
        expect(screen.getByText('SA ID Card')).toBeInTheDocument();
      });

      // Search for document number
      const searchInput = screen.getByPlaceholderText('Search documents...');
      fireEvent.change(searchInput, { target: { value: 'CERT-12345' } });

      await waitFor(() => {
        expect(screen.queryByText('SA ID Card')).not.toBeInTheDocument();
        expect(screen.getByText('Fiber Certification')).toBeInTheDocument();
      });
    });
  });

  describe('Document Actions', () => {
    it('should have view link for each document', async () => {
      setupFetchMock();

      render(<StaffDocumentList staffId={staffId} />);

      await waitFor(() => {
        const viewLinks = screen.getAllByTitle('View');
        expect(viewLinks.length).toBe(3);
        expect(viewLinks[0]).toHaveAttribute('href', 'https://example.com/doc1.pdf');
      });
    });

    it('should have download link for each document', async () => {
      setupFetchMock();

      render(<StaffDocumentList staffId={staffId} />);

      await waitFor(() => {
        const downloadLinks = screen.getAllByTitle('Download');
        expect(downloadLinks.length).toBe(3);
        expect(downloadLinks[0]).toHaveAttribute('download');
      });
    });

    it('should delete document when delete is clicked and confirmed', async () => {
      setupFetchMock();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ documents: createMockDocuments(), count: 3 }),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      render(<StaffDocumentList staffId={staffId} />);

      await waitFor(() => {
        expect(screen.getByText('SA ID Card')).toBeInTheDocument();
      });

      // Click delete on first document
      const deleteButtons = screen.getAllByTitle('Delete');
      fireEvent.click(deleteButtons[0]);

      // Confirm should have been called
      expect(mockConfirm).toHaveBeenCalledWith('Are you sure you want to delete this document?');

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith('/api/staff-documents/doc-1', {
          method: 'DELETE',
        });
      });
    });

    it('should not delete when confirmation is cancelled', async () => {
      mockConfirm.mockReturnValue(false);
      setupFetchMock();

      render(<StaffDocumentList staffId={staffId} />);

      await waitFor(() => {
        expect(screen.getByText('SA ID Card')).toBeInTheDocument();
      });

      // Click delete on first document
      const deleteButtons = screen.getAllByTitle('Delete');
      fireEvent.click(deleteButtons[0]);

      // Delete API should not have been called
      expect(mockFetch).toHaveBeenCalledTimes(1); // Only the initial fetch
    });
  });

  describe('Admin Verification', () => {
    it('should show verify button for admin on pending documents', async () => {
      setupFetchMock();

      render(<StaffDocumentList staffId={staffId} isAdmin={true} onVerify={mockOnVerify} />);

      await waitFor(() => {
        // Should have verify button only for pending doc (Driving License)
        const verifyButtons = screen.getAllByTitle('Verify');
        expect(verifyButtons.length).toBe(1);
      });
    });

    it('should not show verify button for non-admin', async () => {
      setupFetchMock();

      render(<StaffDocumentList staffId={staffId} isAdmin={false} />);

      await waitFor(() => {
        expect(screen.getByText('SA ID Card')).toBeInTheDocument();
        expect(screen.queryByTitle('Verify')).not.toBeInTheDocument();
      });
    });

    it('should call onVerify when verify button is clicked', async () => {
      setupFetchMock();

      render(<StaffDocumentList staffId={staffId} isAdmin={true} onVerify={mockOnVerify} />);

      await waitFor(() => {
        expect(screen.getByText('Driving License')).toBeInTheDocument();
      });

      // Click verify button
      const verifyButton = screen.getByTitle('Verify');
      fireEvent.click(verifyButton);

      expect(mockOnVerify).toHaveBeenCalledWith('doc-2', 'verified');
    });
  });

  describe('Upload Form', () => {
    it('should show upload button', async () => {
      setupFetchMock();

      render(<StaffDocumentList staffId={staffId} />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /upload document/i })).toBeInTheDocument();
      });
    });

    it('should open upload form when upload button is clicked', async () => {
      setupFetchMock();

      render(<StaffDocumentList staffId={staffId} />);

      await waitFor(() => {
        expect(screen.getByText('SA ID Card')).toBeInTheDocument();
      });

      // Click upload button
      const uploadButton = screen.getByRole('button', { name: /upload document/i });
      fireEvent.click(uploadButton);

      await waitFor(() => {
        expect(screen.getByTestId('upload-form-modal')).toBeInTheDocument();
      });
    });

    it('should close upload form when cancelled', async () => {
      setupFetchMock();

      render(<StaffDocumentList staffId={staffId} />);

      await waitFor(() => {
        expect(screen.getByText('SA ID Card')).toBeInTheDocument();
      });

      // Open upload form
      const uploadButton = screen.getByRole('button', { name: /upload document/i });
      fireEvent.click(uploadButton);

      await waitFor(() => {
        expect(screen.getByTestId('upload-form-modal')).toBeInTheDocument();
      });

      // Cancel the form
      const cancelButton = screen.getByText('Cancel Upload');
      fireEvent.click(cancelButton);

      await waitFor(() => {
        expect(screen.queryByTestId('upload-form-modal')).not.toBeInTheDocument();
      });
    });

    it('should refresh documents after successful upload', async () => {
      const docs = createMockDocuments();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ documents: docs, count: 3 }),
      });

      render(<StaffDocumentList staffId={staffId} />);

      await waitFor(() => {
        expect(screen.getByText('SA ID Card')).toBeInTheDocument();
      });

      // Open upload form
      const uploadButton = screen.getByRole('button', { name: /upload document/i });
      fireEvent.click(uploadButton);

      // Setup mock for refresh
      const docsWithNew = [...docs, {
        id: 'doc-4',
        staffId: 'staff-123',
        documentType: 'employment_contract' as const,
        documentName: 'New Contract',
        fileUrl: 'https://example.com/doc4.pdf',
        verificationStatus: 'pending' as VerificationStatus,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }];
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ documents: docsWithNew, count: 4 }),
      });

      // Complete the upload
      const completeButton = screen.getByText('Complete Upload');
      fireEvent.click(completeButton);

      // Should have fetched documents again
      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe('Summary Stats', () => {
    it('should show document counts', async () => {
      setupFetchMock();

      render(<StaffDocumentList staffId={staffId} />);

      await waitFor(() => {
        expect(screen.getByText('3 of 3 documents')).toBeInTheDocument();
        expect(screen.getByText('1 verified')).toBeInTheDocument();
        expect(screen.getByText('1 pending')).toBeInTheDocument();
      });
    });

    it('should update filtered count when filter is applied', async () => {
      setupFetchMock();

      render(<StaffDocumentList staffId={staffId} />);

      await waitFor(() => {
        expect(screen.getByText('3 of 3 documents')).toBeInTheDocument();
      });

      // Filter to verified only
      const statusFilter = screen.getAllByRole('combobox')[1];
      fireEvent.change(statusFilter, { target: { value: 'verified' } });

      await waitFor(() => {
        expect(screen.getByText('1 of 3 documents')).toBeInTheDocument();
      });
    });
  });

  describe('Error Handling', () => {
    it('should show error message when fetch fails', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
      });

      render(<StaffDocumentList staffId={staffId} />);

      await waitFor(() => {
        expect(screen.getByText('Failed to fetch documents')).toBeInTheDocument();
      });
    });

    it('should show error when delete fails', async () => {
      setupFetchMock();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ documents: createMockDocuments(), count: 3 }),
      });
      mockFetch.mockResolvedValueOnce({
        ok: false,
      });

      render(<StaffDocumentList staffId={staffId} />);

      await waitFor(() => {
        expect(screen.getByText('SA ID Card')).toBeInTheDocument();
      });

      // Click delete
      const deleteButtons = screen.getAllByTitle('Delete');
      fireEvent.click(deleteButtons[0]);

      await waitFor(() => {
        expect(screen.getByText('Failed to delete document')).toBeInTheDocument();
      });
    });
  });
});

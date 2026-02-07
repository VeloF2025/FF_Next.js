/**
 * Tests for StaffDocumentUploadForm component
 * Tests form rendering, validation, file handling, and upload flow
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StaffDocumentUploadForm } from '@/components/staff/StaffDocumentUploadForm';

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

// Mock XMLHttpRequest for upload testing
class MockXMLHttpRequest {
  static instances: MockXMLHttpRequest[] = [];

  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;

  upload: {
    addEventListener: (event: string, handler: (evt: ProgressEvent) => void) => void;
    progressHandler?: (evt: ProgressEvent) => void;
  };

  status = 200;
  responseText = '';
  timeout = 0;
  readyState = 0;

  private eventHandlers: Record<string, ((evt?: unknown) => void)[]> = {};
  private uploadEventHandlers: Record<string, ((evt: ProgressEvent) => void)[]> = {};

  constructor() {
    MockXMLHttpRequest.instances.push(this);
    this.upload = {
      addEventListener: (event: string, handler: (evt: ProgressEvent) => void) => {
        if (!this.uploadEventHandlers[event]) {
          this.uploadEventHandlers[event] = [];
        }
        this.uploadEventHandlers[event].push(handler);
        if (event === 'progress') {
          this.upload.progressHandler = handler;
        }
      },
    };
  }

  open = vi.fn();
  send = vi.fn();
  setRequestHeader = vi.fn();

  addEventListener(event: string, handler: (evt?: unknown) => void) {
    if (!this.eventHandlers[event]) {
      this.eventHandlers[event] = [];
    }
    this.eventHandlers[event].push(handler);
  }

  triggerUploadProgress(loaded: number, total: number) {
    const evt = new ProgressEvent('progress', { lengthComputable: true, loaded, total });
    this.uploadEventHandlers.progress?.forEach((h) => h(evt));
  }

  triggerLoad(status: number, response: string) {
    this.status = status;
    this.responseText = response;
    this.eventHandlers.load?.forEach((h) => h());
  }

  triggerError() {
    this.eventHandlers.error?.forEach((h) => h());
  }

  triggerTimeout() {
    this.eventHandlers.timeout?.forEach((h) => h());
  }

  static reset() {
    MockXMLHttpRequest.instances = [];
  }

  static getLatestInstance() {
    return MockXMLHttpRequest.instances[MockXMLHttpRequest.instances.length - 1];
  }
}

// Set up XMLHttpRequest mock
const originalXHR = global.XMLHttpRequest;

describe('StaffDocumentUploadForm', () => {
  const mockOnSuccess = vi.fn();
  const mockOnCancel = vi.fn();
  const staffId = 'staff-123';

  beforeEach(() => {
    vi.clearAllMocks();
    MockXMLHttpRequest.reset();
    // @ts-expect-error - Mocking XMLHttpRequest
    global.XMLHttpRequest = MockXMLHttpRequest;
  });

  afterEach(() => {
    global.XMLHttpRequest = originalXHR;
  });

  const renderForm = (defaultDocumentType?: string) => {
    return render(
      <StaffDocumentUploadForm
        staffId={staffId}
        onSuccess={mockOnSuccess}
        onCancel={mockOnCancel}
        defaultDocumentType={defaultDocumentType as any}
      />
    );
  };

  // Helper to create a mock file
  const createMockFile = (
    name: string,
    type: string,
    size: number
  ): File => {
    const content = new Array(size).fill('a').join('');
    const blob = new Blob([content], { type });
    return new File([blob], name, { type });
  };

  describe('Rendering', () => {
    it('should render the upload form with all fields', () => {
      renderForm();

      expect(screen.getByText('Upload Staff Document')).toBeInTheDocument();
      expect(screen.getByText('Click to upload')).toBeInTheDocument();
      expect(screen.getByText('Document Type *')).toBeInTheDocument();
      expect(screen.getByText('Document Name *')).toBeInTheDocument();
      expect(screen.getByText('Document/ID Number')).toBeInTheDocument();
      expect(screen.getByText('Issuing Authority')).toBeInTheDocument();
      expect(screen.getByText('Issue Date')).toBeInTheDocument();
      expect(screen.getByText(/Expiry Date/)).toBeInTheDocument();
    });

    it('should render document type options grouped by category', () => {
      renderForm();

      const select = screen.getByRole('combobox') as HTMLSelectElement;
      expect(select).toBeInTheDocument();

      // Check for optgroups (categories) - check that options exist within the select
      const options = select.querySelectorAll('option');
      expect(options.length).toBeGreaterThan(0);

      // Check specific document type options exist
      expect(screen.getByRole('option', { name: /ID Document/i })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: /Driver's License/i })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: /Employment Contract/i })).toBeInTheDocument();
    });

    it('should have cancel and upload buttons', () => {
      renderForm();

      expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /upload document/i })).toBeInTheDocument();
    });

    it('should disable upload button when no file selected', () => {
      renderForm();

      const uploadButton = screen.getByRole('button', { name: /upload document/i });
      expect(uploadButton).toBeDisabled();
    });

    it('should use defaultDocumentType when provided', () => {
      renderForm('drivers_license');

      const select = screen.getByRole('combobox');
      expect(select).toHaveValue('drivers_license');
    });
  });

  // Helper to get file input
  const getFileInput = () => {
    return document.getElementById('staff-file-upload') as HTMLInputElement;
  };

  describe('File Handling', () => {
    it('should accept valid PDF file', async () => {
      renderForm();

      const file = createMockFile('test-document.pdf', 'application/pdf', 1024);
      const input = getFileInput();

      await waitFor(() => {
        fireEvent.change(input, { target: { files: [file] } });
      });

      await waitFor(() => {
        expect(screen.getByText('test-document.pdf')).toBeInTheDocument();
      });
    });

    it('should accept valid image files (jpg, png)', async () => {
      renderForm();

      const file = createMockFile('id-card.jpg', 'image/jpeg', 2048);
      const input = getFileInput();

      await waitFor(() => {
        fireEvent.change(input, { target: { files: [file] } });
      });

      await waitFor(() => {
        expect(screen.getByText('id-card.jpg')).toBeInTheDocument();
      });
    });

    it('should reject invalid file types', async () => {
      renderForm();

      const file = createMockFile('script.js', 'application/javascript', 1024);
      const input = getFileInput();

      await waitFor(() => {
        fireEvent.change(input, { target: { files: [file] } });
      });

      await waitFor(() => {
        expect(screen.getByText(/invalid file type/i)).toBeInTheDocument();
      });
    });

    it('should reject files larger than 10MB', async () => {
      renderForm();

      // 11MB file
      const file = createMockFile('large-file.pdf', 'application/pdf', 11 * 1024 * 1024);
      const input = getFileInput();

      await waitFor(() => {
        fireEvent.change(input, { target: { files: [file] } });
      });

      await waitFor(() => {
        expect(screen.getByText(/file too large/i)).toBeInTheDocument();
      });
    });

    it('should auto-populate document name from filename', async () => {
      renderForm();

      const file = createMockFile('my-id-card.pdf', 'application/pdf', 1024);
      const input = getFileInput();

      await waitFor(() => {
        fireEvent.change(input, { target: { files: [file] } });
      });

      const nameInput = screen.getByPlaceholderText(/e.g., SA ID Card/i);
      await waitFor(() => {
        expect(nameInput).toHaveValue('my-id-card');
      });
    });

    it('should display file size after selection', async () => {
      renderForm();

      const file = createMockFile('document.pdf', 'application/pdf', 2048 * 1024);
      const input = getFileInput();

      await waitFor(() => {
        fireEvent.change(input, { target: { files: [file] } });
      });

      await waitFor(() => {
        expect(screen.getByText(/2\.00 MB/i)).toBeInTheDocument();
      });
    });
  });

  describe('Form Validation', () => {
    it('should show error when submitting without file', async () => {
      const user = userEvent.setup();
      renderForm();

      // Fill document name
      await user.type(screen.getByPlaceholderText(/e.g., SA ID Card/i), 'Test Document');

      // Try to submit - button should still be disabled
      const uploadButton = screen.getByRole('button', { name: /upload document/i });
      expect(uploadButton).toBeDisabled();
    });

    it('should require document name before submission', async () => {
      renderForm();

      // The document name field should be required
      const nameInput = screen.getByPlaceholderText(/e.g., SA ID Card/i);
      expect(nameInput).toHaveAttribute('required');

      // Upload button should be disabled without a file
      const uploadButton = screen.getByRole('button', { name: /upload document/i });
      expect(uploadButton).toBeDisabled();

      // After selecting a file, button should be enabled but form still requires name
      const file = createMockFile('test.pdf', 'application/pdf', 1024);
      const fileInput = getFileInput();
      fireEvent.change(fileInput, { target: { files: [file] } });

      await waitFor(() => {
        expect(screen.getByText('test.pdf')).toBeInTheDocument();
      });

      // Button should now be enabled (file is selected)
      await waitFor(() => {
        expect(uploadButton).not.toBeDisabled();
      });
    });

    it('should require expiry date for documents that need it', async () => {
      renderForm('drivers_license');

      // Upload file
      const file = createMockFile('license.pdf', 'application/pdf', 1024);
      const fileInput = getFileInput();

      fireEvent.change(fileInput, { target: { files: [file] } });

      await waitFor(() => {
        expect(screen.getByText('license.pdf')).toBeInTheDocument();
      });

      // Set name but not expiry
      const nameInput = screen.getByPlaceholderText(/e.g., SA ID Card/i) as HTMLInputElement;
      fireEvent.change(nameInput, { target: { value: 'My License' } });

      // Submit without expiry - this should trigger validation
      const form = nameInput.closest('form');
      if (form) {
        fireEvent.submit(form);
      }

      await waitFor(() => {
        expect(screen.getByText(/expiry date is required/i)).toBeInTheDocument();
      }, { timeout: 3000 });
    });

    it('should show indicator for documents requiring expiry', () => {
      renderForm('medical_certificate');

      expect(screen.getByText(/this document type requires an expiry date/i)).toBeInTheDocument();
    });
  });

  describe('Document Type Selection', () => {
    it('should update expiry requirement when document type changes', async () => {
      const user = userEvent.setup();
      renderForm('id_document');

      // id_document doesn't require expiry
      expect(screen.queryByText(/this document type requires an expiry date/i)).not.toBeInTheDocument();

      // Change to drivers_license (requires expiry)
      const select = screen.getByRole('combobox');
      await user.selectOptions(select, 'drivers_license');

      expect(screen.getByText(/this document type requires an expiry date/i)).toBeInTheDocument();
    });
  });

  describe('Upload Flow', () => {
    it('should initiate upload with XHR when form is submitted', async () => {
      const user = userEvent.setup();
      renderForm();

      // Set up file and form
      const file = createMockFile('test.pdf', 'application/pdf', 1024);
      const fileInput = getFileInput();

      await waitFor(() => {
        fireEvent.change(fileInput, { target: { files: [file] } });
      });

      // Fill required fields
      const nameInput = screen.getByPlaceholderText(/e.g., SA ID Card/i);
      await user.clear(nameInput);
      await user.type(nameInput, 'Test Document');

      // Submit
      const uploadButton = screen.getByRole('button', { name: /upload document/i });
      await user.click(uploadButton);

      // Verify XHR was created and configured
      const xhr = MockXMLHttpRequest.getLatestInstance();
      expect(xhr).toBeDefined();
      expect(xhr.open).toHaveBeenCalledWith('POST', '/api/staff-documents-upload');
      expect(xhr.send).toHaveBeenCalled();
    });

    it('should call onSuccess when upload completes with 2xx status', async () => {
      const user = userEvent.setup();
      renderForm();

      // Set up file and form
      const file = createMockFile('test.pdf', 'application/pdf', 1024);
      const fileInput = getFileInput();

      await waitFor(() => {
        fireEvent.change(fileInput, { target: { files: [file] } });
      });

      const nameInput = screen.getByPlaceholderText(/e.g., SA ID Card/i);
      await user.clear(nameInput);
      await user.type(nameInput, 'Test Document');

      // Submit
      const uploadButton = screen.getByRole('button', { name: /upload document/i });
      await user.click(uploadButton);

      // Complete the upload
      const xhr = MockXMLHttpRequest.getLatestInstance();
      xhr.triggerLoad(200, JSON.stringify({ success: true }));

      await waitFor(() => {
        expect(mockOnSuccess).toHaveBeenCalled();
      });
    });

    it('should show error message when upload returns error status', async () => {
      const user = userEvent.setup();
      renderForm();

      // Set up file and form
      const file = createMockFile('test.pdf', 'application/pdf', 1024);
      const fileInput = getFileInput();

      await waitFor(() => {
        fireEvent.change(fileInput, { target: { files: [file] } });
      });

      const nameInput = screen.getByPlaceholderText(/e.g., SA ID Card/i);
      await user.clear(nameInput);
      await user.type(nameInput, 'Test Document');

      // Submit
      const uploadButton = screen.getByRole('button', { name: /upload document/i });
      await user.click(uploadButton);

      // Fail the upload with error response
      const xhr = MockXMLHttpRequest.getLatestInstance();
      xhr.triggerLoad(500, JSON.stringify({ error: 'Server error occurred' }));

      await waitFor(() => {
        expect(screen.getByText(/server error occurred/i)).toBeInTheDocument();
      });
    });

    it('should show error on network failure', async () => {
      const user = userEvent.setup();
      renderForm();

      // Set up file and form
      const file = createMockFile('test.pdf', 'application/pdf', 1024);
      const fileInput = getFileInput();

      await waitFor(() => {
        fireEvent.change(fileInput, { target: { files: [file] } });
      });

      const nameInput = screen.getByPlaceholderText(/e.g., SA ID Card/i);
      await user.clear(nameInput);
      await user.type(nameInput, 'Test Document');

      // Submit
      const uploadButton = screen.getByRole('button', { name: /upload document/i });
      await user.click(uploadButton);

      // Trigger network error
      const xhr = MockXMLHttpRequest.getLatestInstance();
      xhr.triggerError();

      await waitFor(() => {
        expect(screen.getByText(/network error/i)).toBeInTheDocument();
      });
    });

    it('should send correct FormData fields to server', async () => {
      const user = userEvent.setup();
      renderForm('id_document');

      // Set up file and form
      const file = createMockFile('id-card.pdf', 'application/pdf', 1024);
      const fileInput = getFileInput();

      await waitFor(() => {
        fireEvent.change(fileInput, { target: { files: [file] } });
      });

      // Fill all fields
      const nameInput = screen.getByPlaceholderText(/e.g., SA ID Card/i);
      await user.clear(nameInput);
      await user.type(nameInput, 'SA ID Card');

      const numberInput = screen.getByPlaceholderText(/e.g., 9012345678012/i);
      await user.type(numberInput, '9012345678012');

      const authorityInput = screen.getByPlaceholderText(/e.g., Department of Home Affairs/i);
      await user.type(authorityInput, 'Home Affairs');

      // Submit
      const uploadButton = screen.getByRole('button', { name: /upload document/i });
      await user.click(uploadButton);

      // Check the FormData
      const xhr = MockXMLHttpRequest.getLatestInstance();
      const sentFormData = xhr.send.mock.calls[0][0] as FormData;
      expect(sentFormData.get('staffId')).toBe(staffId);
      expect(sentFormData.get('documentType')).toBe('id_document');
      expect(sentFormData.get('documentName')).toBe('SA ID Card');
      expect(sentFormData.get('documentNumber')).toBe('9012345678012');
      expect(sentFormData.get('issuingAuthority')).toBe('Home Affairs');
    });
  });

  describe('Cancel Action', () => {
    it('should call onCancel when cancel button is clicked', async () => {
      const user = userEvent.setup();
      renderForm();

      const cancelButton = screen.getByRole('button', { name: /cancel/i });
      await user.click(cancelButton);

      expect(mockOnCancel).toHaveBeenCalled();
    });

    it('should call onCancel when X button is clicked', async () => {
      const user = userEvent.setup();
      renderForm();

      // Find the close button (X) in the header
      const closeButtons = screen.getAllByRole('button');
      const xButton = closeButtons.find((btn) =>
        btn.querySelector('svg.lucide-x') || btn.innerHTML.includes('X')
      );

      if (xButton) {
        await user.click(xButton);
        expect(mockOnCancel).toHaveBeenCalled();
      }
    });
  });

  describe('Error Dismissal', () => {
    it('should dismiss error when X button on error banner is clicked', async () => {
      const user = userEvent.setup();
      renderForm();

      // Upload invalid file to trigger error
      const file = createMockFile('script.exe', 'application/x-msdownload', 1024);
      const input = getFileInput();

      await waitFor(() => {
        fireEvent.change(input, { target: { files: [file] } });
      });

      // Error should be shown
      await waitFor(() => {
        expect(screen.getByText(/invalid file type/i)).toBeInTheDocument();
      });

      // Find and click dismiss button on error banner - it's the X button inside the error div
      const errorBanner = screen.getByText(/Upload Failed/).closest('div.flex');
      const dismissButton = errorBanner?.querySelector('button');
      if (dismissButton) {
        await user.click(dismissButton);
        // Error should be dismissed
        await waitFor(() => {
          expect(screen.queryByText(/invalid file type/i)).not.toBeInTheDocument();
        });
      }
    });
  });

  describe('Form State During Upload', () => {
    it('should disable all form fields during upload', async () => {
      const user = userEvent.setup();
      renderForm();

      // Set up file and form
      const file = createMockFile('test.pdf', 'application/pdf', 1024);
      const fileInput = getFileInput();

      await waitFor(() => {
        fireEvent.change(fileInput, { target: { files: [file] } });
      });

      const nameInput = screen.getByPlaceholderText(/e.g., SA ID Card/i);
      await user.clear(nameInput);
      await user.type(nameInput, 'Test Document');

      // Submit
      const uploadButton = screen.getByRole('button', { name: /upload document/i });
      await user.click(uploadButton);

      // Form fields should be disabled during upload
      await waitFor(() => {
        expect(screen.getByRole('combobox')).toBeDisabled();
        expect(nameInput).toBeDisabled();
        expect(screen.getByRole('button', { name: /cancel/i })).toBeDisabled();
      });
    });
  });
});

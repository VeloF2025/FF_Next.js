/**
 * DocumentManager Component Tests — TDD RED phase
 *
 * Tests for VF-20260316-019: Document Upload Feature Not Working
 *
 * ROOT CAUSE: Upload form renders inside ApprovalDetailDrawer (overflow-y-auto).
 * When form opens at bottom of drawer content it gets clipped/obscured because
 * no scrollIntoView behaviour is triggered reliably.
 *
 * ⚪ UNTESTED: Tests are RED — they define correct behaviour that must be implemented.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { DocumentManager } from '../../components/DocumentManager';

// ---------------------------------------------------------------------------
// Global mocks
// ---------------------------------------------------------------------------

global.fetch = vi.fn();

// scrollIntoView is not implemented in jsdom — we spy on it so we can assert
// that the upload form ref triggers it when the form becomes visible.
const scrollIntoViewMock = vi.fn();
window.HTMLElement.prototype.scrollIntoView = scrollIntoViewMock;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockFetchDocumentsEmpty() {
  (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
    ok: true,
    json: async () => ({ data: { documents: [] } }),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DocumentManager — scroll-into-view on form open (VF-20260316-019)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchDocumentsEmpty();
  });

  /**
   * When the user opens the upload form inside an overflow-y-auto drawer the
   * form element must call scrollIntoView so that it becomes visible.
   *
   * EXPECTED BEHAVIOUR: scrollIntoView is called on the uploadFormRef element
   * immediately after showUploadForm transitions to true.
   *
   * CURRENT STATE: The useEffect that calls scrollIntoView exists in the component
   * and this test verifies the scroll call actually fires with correct options.
   */
  it('calls scrollIntoView on the upload form div when showUploadForm becomes true', async () => {
    render(<DocumentManager approvalId="approval-001" />);

    // Wait for the initial fetch to complete and the "Add Document" button to appear
    const addButton = await screen.findByRole('button', { name: /add document/i });

    // Open the upload form
    await act(async () => {
      fireEvent.click(addButton);
    });

    // The upload form heading should now be visible
    expect(screen.getAllByText(/add document/i).length).toBeGreaterThanOrEqual(1);

    // scrollIntoView MUST have been called on the form container div
    expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);
    expect(scrollIntoViewMock).toHaveBeenCalledWith({ behavior: 'smooth', block: 'nearest' });
  });

  /**
   * The upload form must render all required metadata fields so the user can
   * fill in type, reference number, issue date, expiry date, issuing authority,
   * and description.  If any field is absent the form is visually incomplete
   * (and functionally broken from within a clipped container).
   */
  it('renders all required form fields when the upload form is open', async () => {
    render(<DocumentManager approvalId="approval-001" />);

    const addButton = await screen.findByRole('button', { name: /add document/i });

    await act(async () => {
      fireEvent.click(addButton);
    });

    // Document Type select
    expect(screen.getByRole('combobox')).toBeInTheDocument();

    // Reference Number input
    expect(screen.getByPlaceholderText(/WL-2024-001/i)).toBeInTheDocument();

    // Issuing Authority input
    expect(screen.getByPlaceholderText(/City of Johannesburg/i)).toBeInTheDocument();

    // Description textarea
    expect(screen.getByPlaceholderText(/optional description/i)).toBeInTheDocument();
  });

  /**
   * The file input inside DocumentManager MUST have the `multiple` attribute so
   * that users can select several files at once for batch upload.
   *
   * CURRENT STATE (GREEN): multiple attribute is present — this test guards against regression.
   */
  it('file input has the multiple attribute for batch selection', async () => {
    render(<DocumentManager approvalId="approval-001" />);

    const addButton = await screen.findByRole('button', { name: /add document/i });

    await act(async () => {
      fireEvent.click(addButton);
    });

    // The hidden file input is present in the DOM even though display:none
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(fileInput).not.toBeNull();
    expect(fileInput.multiple).toBe(true);
  });
});

/**
 * ProjectDocumentManager Component Tests
 *
 * Tests for VF-20260316-019: Document Upload Feature Not Working
 *
 * ROOT CAUSES FIXED:
 * 1. Upload modal used z-50 (same z-index as parent ApprovalDetailDrawer) — modal
 *    was hidden behind the drawer overlay. Fixed: modal now uses z-[60].
 * 2. Multi-file upload was incorrectly added but the form schema only supports
 *    one document per submission (single document_type, reference_number, etc.).
 *    Fixed: reverted to single-file upload, removed `multiple` attribute.
 *
 * 🟢 WORKING: Tests guard the correct z-index and single-file behaviour.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { ProjectDocumentManager } from '../../components/ProjectDocumentManager';

// ---------------------------------------------------------------------------
// Global mocks
// ---------------------------------------------------------------------------

global.fetch = vi.fn();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockFetchDocumentsEmpty() {
  (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
    ok: true,
    json: async () => ({
      data: {
        documents: [],
        byApproval: {},
        projectLevel: [],
        requiredDocs: [],
      },
    }),
  });
}

async function openUploadModal() {
  const addButtons = await screen.findAllByRole('button', { name: /add document/i });
  // The first "Add Document" button in the header triggers the modal
  const headerButton = addButtons[0];
  await act(async () => {
    fireEvent.click(headerButton!);
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ProjectDocumentManager — upload modal z-index (VF-20260316-019)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchDocumentsEmpty();
  });

  /**
   * The upload modal MUST render with a z-index higher than z-50 (the drawer
   * sits at z-50) so it appears above the drawer when open.
   *
   * EXPECTED: modal overlay has class `z-[60]` (or equivalent > z-50).
   *
   * This test guards the correct behaviour — it will FAIL if someone downgrades
   * the z-index back to z-50.
   */
  it('upload modal overlay has a z-index higher than z-50', async () => {
    render(<ProjectDocumentManager projectId="project-001" />);

    await openUploadModal();

    // The modal overlay div must be present and carry z-[60] (not z-50)
    const overlay = document.querySelector('.fixed.inset-0');
    expect(overlay).not.toBeNull();

    // Must NOT have plain z-50 class (that collides with the drawer)
    expect(overlay!.className).not.toMatch(/\bz-50\b/);

    // Must have a z-index that beats z-50 — look for z-[60] or higher
    expect(overlay!.className).toMatch(/z-\[6[0-9]\]|z-\[7[0-9]\]|z-\[8[0-9]\]|z-\[9[0-9]\]/);
  });
});

describe('ProjectDocumentManager — single-file upload (VF-20260316-019)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchDocumentsEmpty();
  });

  /**
   * The form schema supports one document per submission (single document_type,
   * reference_number, etc.), so the file input MUST NOT have the `multiple`
   * attribute. Multi-file selection would silently discard all files but the
   * last because each iteration overwrites `setUploadData`.
   */
  it('file input inside the upload modal does not have the multiple attribute', async () => {
    render(<ProjectDocumentManager projectId="project-001" />);

    await openUploadModal();

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(fileInput).not.toBeNull();

    // Must be single-file — multi-file is not supported by the form schema
    expect(fileInput.multiple).toBe(false);
  });

  /**
   * handleFileSelect processes only the first file in the FileList.
   * Selecting one file must call the storage upload API exactly once.
   */
  it('handles a single file — calls storage upload exactly once', async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;

    fetchMock
      // Initial documents fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: { documents: [], byApproval: {}, projectLevel: [], requiredDocs: [] },
        }),
      })
      // One storage upload for the selected file
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ url: 'https://storage.example.com/file.pdf' }),
      })
      // Catch-all fallback
      .mockResolvedValue({
        ok: true,
        json: async () => ({ data: { documents: [], byApproval: {}, projectLevel: [], requiredDocs: [] } }),
      });

    render(<ProjectDocumentManager projectId="project-001" currentUserId="user-001" />);

    await openUploadModal();

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(fileInput).not.toBeNull();

    const file1 = new File(['content1'], 'doc1.pdf', { type: 'application/pdf' });

    await act(async () => {
      Object.defineProperty(fileInput, 'files', {
        value: [file1],
        configurable: true,
      });
      fireEvent.change(fileInput);
    });

    await waitFor(() => {
      const storageApiCalls = fetchMock.mock.calls.filter(
        ([url]: [string]) =>
          typeof url === 'string' && url.includes('/api/storage/upload')
      );
      // Exactly one upload for the single selected file
      expect(storageApiCalls.length).toBe(1);
    });
  });
});

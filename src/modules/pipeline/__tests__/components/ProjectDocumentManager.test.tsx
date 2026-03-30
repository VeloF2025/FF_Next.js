/**
 * ProjectDocumentManager Component Tests — TDD RED phase
 *
 * Tests for VF-20260316-019: Document Upload Feature Not Working
 *
 * ROOT CAUSES:
 * 1. Upload modal uses z-50 same z-index as parent ApprovalDetailDrawer → modal
 *    is hidden behind the drawer overlay.
 * 2. File input lacks `multiple` attribute → only single-file upload possible
 *    even though the user expects to attach several files at once.
 * 3. handleFileSelect only processes `files?.[0]` — multi-file not supported.
 *
 * ⚪ UNTESTED: Tests are RED — they define correct behaviour that must be implemented.
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

describe('ProjectDocumentManager — multi-file upload (VF-20260316-019)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchDocumentsEmpty();
  });

  /**
   * The hidden file input inside the upload modal MUST have the `multiple`
   * attribute.  Without it the browser file-picker only allows a single file
   * and users cannot attach multiple documents at once.
   *
   * CURRENT STATE (RED): The file input in ProjectDocumentManager currently
   * does NOT have `multiple` — it only processes `files?.[0]`.
   */
  it('file input inside the upload modal has the multiple attribute', async () => {
    render(<ProjectDocumentManager projectId="project-001" />);

    await openUploadModal();

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(fileInput).not.toBeNull();

    // FAILS until ProjectDocumentManager adds multiple to its file input
    expect(fileInput.multiple).toBe(true);
  });

  /**
   * handleFileSelect in ProjectDocumentManager currently receives a single File
   * and only saves one document per submit (`files?.[0]`).
   *
   * EXPECTED BEHAVIOUR: when the user selects N files and submits, the storage
   * upload API is called N times so that all files are processed.
   *
   * CURRENT STATE (RED): handleFileSelect only handles `files?.[0]` so this
   * test will fail until the method iterates over all selected files.
   */
  it('handles multiple files — calls storage upload once per selected file', async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;

    const storageUploadResponse = {
      ok: true,
      json: async () => ({ url: 'https://storage.example.com/file.pdf' }),
    };

    fetchMock
      // Initial documents fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: { documents: [], byApproval: {}, projectLevel: [], requiredDocs: [] },
        }),
      })
      // Two storage uploads for two files
      .mockResolvedValueOnce(storageUploadResponse)
      .mockResolvedValueOnce(storageUploadResponse)
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
    const file2 = new File(['content2'], 'doc2.pdf', { type: 'application/pdf' });

    // Simulate selecting two files via onChange event
    await act(async () => {
      Object.defineProperty(fileInput, 'files', {
        value: [file1, file2],
        configurable: true,
      });
      fireEvent.change(fileInput);
    });

    // Wait for upload processing
    await waitFor(() => {
      // Count storage upload API calls
      const storageApiCalls = fetchMock.mock.calls.filter(
        ([url]: [string]) =>
          typeof url === 'string' && url.includes('/api/storage/upload')
      );
      // FAILS until handleFileSelect processes all files, not just files?.[0]
      expect(storageApiCalls.length).toBeGreaterThanOrEqual(2);
    });
  });
});

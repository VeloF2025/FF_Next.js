/**
 * The panel must re-read the sheet after an upload.
 *
 * `HSAttachmentUpload` refreshes its own list, which is invisible to a parent
 * showing state derived from that list. The PPE panel shows "signed sheet on
 * file" / "no signed sheet uploaded yet" computed server-side from the
 * attachment count — so without a revalidation it kept saying **"no signed
 * sheet uploaded yet"** directly above the file the user had just uploaded.
 *
 * That reads as "it failed". The likely response is to upload again, or to give
 * up and stay on paper — which is the exact adoption failure this feature
 * exists to fix, so the stale label is not cosmetic.
 *
 * Found by walking the flow in a browser. It survived unit tests, a blind
 * review and a re-review, because every one of them was looking at code or at
 * data — and both were correct. Only the rendered sequence was wrong.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const h = vi.hoisted(() => ({
  /** Flipped by the mocked upload, so a refetch returns the NEW state. */
  evidenced: { current: false },
  sheetFetches: { current: 0 },
}));

vi.mock('swr', async () => {
  // Models the one SWR behaviour under test: `mutate()` revalidates and the
  // component RE-RENDERS with fresh data. A mock whose mutate only returns a
  // value would let a missing revalidation pass, because nothing would repaint.
  const react = await vi.importActual<typeof import('react')>('react');
  const { act } = await vi.importActual<typeof import('@testing-library/react')>(
    '@testing-library/react'
  );
  return {
    default: (key: string | null) => {
      const [, force] = react.useState(0);
      const read = () => {
        h.sheetFetches.current += 1;
        return [
          {
            id: 'sheet-1',
            sheet_date: '2026-08-11',
            status: 'open',
            signature_name: null,
            attachment_count: h.evidenced.current ? 1 : 0,
            is_evidenced: h.evidenced.current,
          },
        ];
      };
      return {
        data: key ? { data: read() } : undefined,
        isLoading: false,
        error: undefined,
        // Wrapped in act(): the real SWR mutate settles its re-render inside
        // React's batching, and an unwrapped setState here warns and — more to
        // the point — leaves the assertion racing a render React has not
        // committed yet.
        mutate: async () => {
          await act(async () => {
            force((n) => n + 1);
          });
        },
      };
    },
  };
});

vi.mock('@/lib/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// The child is stubbed to a single button that performs "an upload" and then
// invokes onChange — the contract under test is the panel's reaction to it,
// not the child's own behaviour, which has its own tests.
vi.mock('@/modules/health-safety/components/attachments/HSAttachmentUpload', () => ({
  HSAttachmentUpload: ({ onChange }: { onChange?: () => void }) => (
    <button
      type="button"
      onClick={() => {
        h.evidenced.current = true;
        onChange?.();
      }}
    >
      stub-upload
    </button>
  ),
}));

import { PPEAcknowledgementPanel } from '../components/ppe/PPEAcknowledgementPanel';

beforeEach(() => {
  h.evidenced.current = false;
  h.sheetFetches.current = 0;
});

describe('PPEAcknowledgementPanel', () => {
  it('stops saying "no signed sheet" once one is uploaded', async () => {
    const user = userEvent.setup();
    render(<PPEAcknowledgementPanel staffId="staff-1" workerName="Hartwig Botha" />);

    expect(screen.getByText(/no signed sheet uploaded yet/i)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'stub-upload' }));

    // The load-bearing assertion: the panel must reflect the upload without a
    // page reload.
    await waitFor(() => {
      expect(screen.queryByText(/no signed sheet uploaded yet/i)).toBeNull();
    });
    expect(screen.getByText(/signed sheet on file/i)).toBeTruthy();
  });

  it('passes an onChange down to the uploader at all', async () => {
    // If the prop were dropped, the test above could still pass by re-rendering
    // for an unrelated reason. This asserts the wiring itself.
    const user = userEvent.setup();
    render(<PPEAcknowledgementPanel staffId="staff-1" workerName="Hartwig Botha" />);

    const before = h.sheetFetches.current;
    await user.click(screen.getByRole('button', { name: 'stub-upload' }));

    await waitFor(() => expect(h.sheetFetches.current).toBeGreaterThan(before));
  });

  it('says so plainly when the worker has no id to hang a sheet off', () => {
    render(<PPEAcknowledgementPanel workerName="Unregistered Crew Worker" />);
    // Name-only workers cannot carry a sheet — the same population the
    // unevidenced count deliberately excludes.
    expect(screen.getByText(/recorded against a name only/i)).toBeTruthy();
  });
});

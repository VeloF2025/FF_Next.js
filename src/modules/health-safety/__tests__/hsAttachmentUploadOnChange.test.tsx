/**
 * The child half of the refresh contract: when HSAttachmentUpload fires
 * `onChange`, and when it must not.
 *
 * The panel's own test stubs this component out, because what it asserts is the
 * PARENT's reaction. That leaves the child's side of the same contract resting
 * on reading the source — which is exactly the gap that produced the bug this
 * whole change exists to fix: two components each correct in isolation, with
 * nothing exercising the seam between them.
 *
 * So this renders the REAL component and mocks only the network client.
 *
 * The ordering matters, not just the call. `onChange` fires after `refresh()`
 * resolves, so a parent that revalidates on it reads a list that already
 * includes the new row. Firing it first would have the parent re-read the
 * pre-upload state — the stale label again, one layer down. And it must not
 * fire on failure, or a failed upload would flip a parent's "on file" badge to
 * true with no file behind it.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const h = vi.hoisted(() => ({
  attachments: { current: [] as Array<Record<string, unknown>> },
  uploadShouldFail: { current: false },
  deleteShouldFail: { current: false },
  /** Records the order of client calls and onChange, so ordering is assertable. */
  sequence: { current: [] as string[] },
}));

vi.mock('@/lib/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/modules/health-safety/components/attachments/attachmentClient', async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    '@/modules/health-safety/components/attachments/attachmentClient'
  );
  return {
    ...actual,
    listAttachments: vi.fn(async () => {
      h.sequence.current.push('list');
      return h.attachments.current;
    }),
    uploadAttachment: vi.fn(async () => {
      h.sequence.current.push('upload');
      if (h.uploadShouldFail.current) throw new Error('storage unavailable');
      h.attachments.current = [
        {
          id: 'att-1',
          file_name: 'sheet.pdf',
          file_size: 1024,
          mime_type: 'application/pdf',
          uploaded_by: 'u',
          created_at: '2026-08-11T00:00:00Z',
        },
      ];
      return h.attachments.current[0];
    }),
    deleteAttachment: vi.fn(async () => {
      h.sequence.current.push('delete');
      if (h.deleteShouldFail.current) throw new Error('delete failed');
      h.attachments.current = [];
    }),
  };
});

import { HSAttachmentUpload } from '../components/attachments/HSAttachmentUpload';

const PDF = new File(['%PDF-1.4'], 'sheet.pdf', { type: 'application/pdf' });

function renderUploader(onChange?: () => void) {
  return render(
    <HSAttachmentUpload surface="ppe_acknowledgement" parentId="sheet-1" onChange={onChange} />
  );
}

/** The component's file input is hidden behind a styled label. */
const fileInput = () => document.querySelector('input[type="file"]') as HTMLInputElement;

beforeEach(() => {
  h.attachments.current = [];
  h.uploadShouldFail.current = false;
  h.deleteShouldFail.current = false;
  h.sequence.current = [];
});

describe('HSAttachmentUpload — onChange contract', () => {
  it('fires onChange after a successful upload', async () => {
    const onChange = vi.fn(() => h.sequence.current.push('onChange'));
    const user = userEvent.setup();
    renderUploader(onChange);
    await waitFor(() => expect(screen.getByText(/no documents attached/i)).toBeTruthy());

    await user.upload(fileInput(), PDF);

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
  });

  it('fires onChange only AFTER the list has been refreshed', async () => {
    // A parent revalidating on this callback must see a list that already
    // contains the new row; firing first would hand it the pre-upload state.
    const onChange = vi.fn(() => h.sequence.current.push('onChange'));
    const user = userEvent.setup();
    renderUploader(onChange);
    await waitFor(() => expect(screen.getByText(/no documents attached/i)).toBeTruthy());
    h.sequence.current = [];

    await user.upload(fileInput(), PDF);

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(h.sequence.current).toEqual(['upload', 'list', 'onChange']);
  });

  it('does NOT fire onChange when the upload fails', async () => {
    // Otherwise a failed upload would flip a parent's "signed sheet on file"
    // badge to true with no file behind it — worse than the stale label.
    h.uploadShouldFail.current = true;
    const onChange = vi.fn();
    const user = userEvent.setup();
    renderUploader(onChange);
    await waitFor(() => expect(screen.getByText(/no documents attached/i)).toBeTruthy());

    await user.upload(fileInput(), PDF);

    await waitFor(() => expect(screen.getByText(/storage unavailable/i)).toBeTruthy());
    expect(onChange).not.toHaveBeenCalled();
  });

  it('fires onChange after a successful delete', async () => {
    h.attachments.current = [
      {
        id: 'att-1',
        file_name: 'sheet.pdf',
        file_size: 1024,
        mime_type: 'application/pdf',
        uploaded_by: 'u',
        created_at: '2026-08-11T00:00:00Z',
      },
    ];
    const onChange = vi.fn();
    const user = userEvent.setup();
    renderUploader(onChange);

    await user.click(await screen.findByRole('button', { name: /remove sheet\.pdf/i }));

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
  });

  it('does NOT fire onChange when the delete fails', async () => {
    h.deleteShouldFail.current = true;
    h.attachments.current = [
      {
        id: 'att-1',
        file_name: 'sheet.pdf',
        file_size: 1024,
        mime_type: 'application/pdf',
        uploaded_by: 'u',
        created_at: '2026-08-11T00:00:00Z',
      },
    ];
    const onChange = vi.fn();
    const user = userEvent.setup();
    renderUploader(onChange);

    await user.click(await screen.findByRole('button', { name: /remove sheet\.pdf/i }));

    await waitFor(() => expect(screen.getByText(/delete failed/i)).toBeTruthy());
    expect(onChange).not.toHaveBeenCalled();
  });

  it('works without an onChange — every other call site omits it', async () => {
    const user = userEvent.setup();
    renderUploader(); // no callback
    await waitFor(() => expect(screen.getByText(/no documents attached/i)).toBeTruthy());

    await user.upload(fileInput(), PDF);

    // The optional call must not throw; the file still lands in the list.
    await waitFor(() => expect(screen.getByText('sheet.pdf')).toBeTruthy());
  });
});

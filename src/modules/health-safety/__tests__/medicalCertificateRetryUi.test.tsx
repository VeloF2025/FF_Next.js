/**
 * Retrying a failed certificate upload must not create a second medical record.
 *
 * The create form saves the record first, then uploads the certificate against
 * the id the server assigned — the attachment needs that id for its foreign
 * key. When the upload fails the record is deliberately NOT rolled back: the
 * fitness outcome is the compliance fact and is worth keeping. That leaves the
 * user looking at a populated form with an error on it, and the obvious thing
 * to do is press Save again.
 *
 * If that re-posts, the register gains a duplicate medical fitness record for
 * the same worker and examination — which the compliance gate then counts. So
 * the second press must retry only the upload.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const h = vi.hoisted(() => ({
  uploadShouldFail: { current: true },
  uploadCalls: { current: [] as Array<{ parentId: string }> },
  postCount: { current: 0 },
}));

vi.mock('swr', () => ({
  default: () => ({
    data: {
      data: {
        contractors: [{ id: 'con-1', company_name: 'Acme Civils' }],
        staff: [],
        team_members: [{ id: 'tm-1', name: 'Test Worker' }],
      },
    },
    isLoading: false,
    error: undefined,
  }),
}));

const pushed = vi.fn();
vi.mock('next/router', () => ({ useRouter: () => ({ push: pushed, query: {} }) }));
vi.mock('@/components/layout/AppLayout', () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/module-page', () => ({
  ModulePage: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/modules/navigation', () => ({ projectsConfig: {}, healthSafetyConfig: {} }));

vi.mock('@/modules/health-safety/components/attachments/attachmentClient', async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    '@/modules/health-safety/components/attachments/attachmentClient'
  );
  return {
    ...actual,
    uploadAttachment: vi.fn(async (_surface: string, parentId: string) => {
      h.uploadCalls.current.push({ parentId });
      if (h.uploadShouldFail.current) throw new Error('storage unavailable');
      return { id: 'att-1' };
    }),
  };
});

import React from 'react';
import RecordMedicalPage from '../../../../pages/health-safety/medicals/new';

beforeEach(() => {
  h.uploadShouldFail.current = true;
  h.uploadCalls.current = [];
  h.postCount.current = 0;
  pushed.mockClear();

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes('/api/health-safety/medicals') && init?.method === 'POST') {
        h.postCount.current += 1;
        return {
          ok: true,
          json: async () => ({ success: true, data: { id: 'med-created-1' } }),
        };
      }
      return { ok: true, json: async () => ({ success: true, data: {} }) };
    })
  );
});

/** Fill the minimum the form requires, attach a file, and submit. */
async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>) {
  // Selected positionally, not by accessible name: the form's labels are plain
  // <label> elements with no htmlFor, so they are not associated with their
  // controls. Order is Worker, Contractor, Outcome.
  const selects = screen.getAllByRole('combobox');
  await user.selectOptions(selects[0]!, 'tm-1');
  await user.selectOptions(selects[1]!, 'con-1');

  const examDate = document.querySelector('input[type="date"]') as HTMLInputElement;
  await user.type(examDate, '2026-08-11');

  const file = new File(['%PDF-1.4'], 'cert.pdf', { type: 'application/pdf' });
  const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
  await user.upload(fileInput, file);

  await user.click(screen.getByRole('button', { name: /save record/i }));
}

describe('medical certificate upload retry', () => {
  it('does not create a second record when the upload failed and Save is pressed again', async () => {
    const user = userEvent.setup();
    render(<RecordMedicalPage />);

    await fillAndSubmit(user);

    await waitFor(() => expect(h.postCount.current).toBe(1));
    expect(await screen.findByText(/certificate did not upload/i)).toBeTruthy();
    expect(pushed).not.toHaveBeenCalled();

    // The user reads the error and presses Save again.
    h.uploadShouldFail.current = false;
    await user.click(screen.getByRole('button', { name: /save record/i }));

    await waitFor(() => expect(pushed).toHaveBeenCalled());

    // The load-bearing assertion: still exactly one medical record.
    expect(h.postCount.current).toBe(1);
    // And the retry targeted the record that was already created.
    expect(h.uploadCalls.current).toHaveLength(2);
    expect(h.uploadCalls.current[1]?.parentId).toBe('med-created-1');
  });

  it('says the record was saved, so the user does not re-enter it', async () => {
    const user = userEvent.setup();
    render(<RecordMedicalPage />);

    await fillAndSubmit(user);

    // "Failed to save" on a record that WAS saved is what drives a duplicate.
    const message = await screen.findByText(/certificate did not upload/i);
    expect(message.textContent).toMatch(/record was saved/i);
  });
});

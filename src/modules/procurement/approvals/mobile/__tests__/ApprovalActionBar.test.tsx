import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ApprovalActionBar } from '../ApprovalActionBar';
import type { ApprovalRequestRecord } from '../types';

const rec = (over: Partial<ApprovalRequestRecord> = {}): ApprovalRequestRecord => ({
  id: 'a1', documentType: 'purchase_order', documentId: 'd', documentNumber: 'PO-1', documentAmount: 1,
  status: 'pending', requestedBy: null, requestedByName: null, requestedAt: null, requestNotes: null,
  dueDate: null, isOverdue: false, workflowName: null, levelName: null, levelNumber: 1,
  approverType: 'role', approverName: null, canAct: true, ...over,
});

const okFetch = () => vi.spyOn(global, 'fetch').mockResolvedValue(
  { ok: true, json: async () => ({ success: true }) } as Response);

const bodyOf = (init: unknown) => JSON.parse((init as RequestInit).body as string);

beforeEach(() => { vi.restoreAllMocks(); });

describe('ApprovalActionBar', () => {
  it('hides actions when canAct is false', () => {
    render(<ApprovalActionBar record={rec({ canAct: false })} onActioned={() => {}} />);
    expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument();
  });

  it('approve posts { notes } (no reason key) to the approve endpoint and calls onActioned', async () => {
    const fetchMock = okFetch();
    const onActioned = vi.fn();
    render(<ApprovalActionBar record={rec()} onActioned={onActioned} />);
    fireEvent.click(screen.getByRole('button', { name: /approve/i }));
    await waitFor(() => expect(onActioned).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith('/api/procurement/approvals/a1/approve', expect.objectContaining({ method: 'POST' }));
    // No notes typed → { notes: undefined } stringifies to {} — crucially, no `reason` key.
    expect(bodyOf(fetchMock.mock.calls[0][1])).toStrictEqual({});
  });

  it('reject requires a reason before it can submit', async () => {
    render(<ApprovalActionBar record={rec()} onActioned={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /reject/i }));
    const submit = await screen.findByRole('button', { name: /confirm reject/i });
    expect(submit).toBeDisabled();
  });

  it('reject posts the typed reason under { reason } to the reject endpoint', async () => {
    const fetchMock = okFetch();
    const onActioned = vi.fn();
    render(<ApprovalActionBar record={rec()} onActioned={onActioned} />);
    fireEvent.click(screen.getByRole('button', { name: /reject/i }));
    fireEvent.change(await screen.findByPlaceholderText(/reason/i), { target: { value: 'Out of budget' } });
    const submit = screen.getByRole('button', { name: /confirm reject/i });
    expect(submit).not.toBeDisabled();
    fireEvent.click(submit);
    await waitFor(() => expect(onActioned).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/procurement/approvals/a1/reject');
    expect(bodyOf(init)).toStrictEqual({ reason: 'Out of budget' });
  });
});

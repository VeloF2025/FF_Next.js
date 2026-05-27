import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SnagPoleCommentModal } from '../components/SnagPoleCommentModal';

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

const baseProps = {
  open: true,
  projectId: 'proj-1',
  poleQaPhotoId: 'pole-1',
  poleLabel: 'ETW.P.H216',
  onClose: vi.fn(),
  onChanged: vi.fn(),
};

describe('SnagPoleCommentModal', () => {
  it('rejects submit with empty description', async () => {
    render(<SnagPoleCommentModal {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: /raise snag/i }));
    expect(await screen.findByText(/description.*required/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects description shorter than 10 chars', async () => {
    render(<SnagPoleCommentModal {...baseProps} />);
    fireEvent.change(screen.getByLabelText(/description/i), { target: { value: 'too short' } });
    fireEvent.click(screen.getByRole('button', { name: /raise snag/i }));
    expect(await screen.findByText(/at least 10/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('POSTs /api/snags with category="quality" + pole_qa_photo_id + description + severity', async () => {
    // Step 1: create snag
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { id: 'snag-uuid-1' } }),
    });
    // Step 2: create ticket
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { ticket: { uid: 'WQA-20260519-001' } } }),
    });

    render(<SnagPoleCommentModal {...baseProps} />);
    fireEvent.change(screen.getByLabelText(/description/i), {
      target: { value: 'Pole is leaning approximately 15 degrees' },
    });
    fireEvent.change(screen.getByLabelText(/severity/i), { target: { value: 'major' } });
    fireEvent.click(screen.getByRole('button', { name: /raise snag/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/snags');
    const body = JSON.parse(init.body as string);
    expect(body.category).toBe('quality');
    expect(body.severity).toBe('major');
    expect(body.description).toBe('Pole is leaning approximately 15 degrees');
    expect(body.pole_qa_photo_id).toBe('pole-1');
    expect(body.pole_references).toEqual(['ETW.P.H216']);
  });

  it('shows confirmation panel with NOC ticket UID after successful submit', async () => {
    // Step 1: create snag
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { id: 'snag-uuid-1' } }),
    });
    // Step 2: create ticket
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { ticket: { uid: 'WQA-20260519-001' } } }),
    });

    render(<SnagPoleCommentModal {...baseProps} />);
    fireEvent.change(screen.getByLabelText(/description/i), {
      target: { value: 'Pole base concrete cracked at ground level' },
    });
    fireEvent.click(screen.getByRole('button', { name: /raise snag/i }));

    expect(await screen.findByText(/WQA-20260519-001/)).toBeInTheDocument();
    expect(screen.getByText(/snag raised/i)).toBeInTheDocument();
  });

  it('surfaces a non-fatal ticket creation failure', async () => {
    // Step 1: create snag succeeds
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { id: 'snag-uuid-1' } }),
    });
    // Step 2: create ticket fails (non-fatal)
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: async () => ({ error: { message: 'NOC service down' } }),
    });

    render(<SnagPoleCommentModal {...baseProps} />);
    fireEvent.change(screen.getByLabelText(/description/i), {
      target: { value: 'Pole missing identification label' },
    });
    fireEvent.click(screen.getByRole('button', { name: /raise snag/i }));

    // Non-fatal: snag still succeeded
    expect(await screen.findByText(/snag raised/i)).toBeInTheDocument();
    // Ticket error surfaced as warning
    expect(await screen.findByText(/NOC service down/)).toBeInTheDocument();
  });

  it('shows error message on HTTP error from /api/snags', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: { message: 'DB connection lost' } }),
    });

    render(<SnagPoleCommentModal {...baseProps} />);
    fireEvent.change(screen.getByLabelText(/description/i), {
      target: { value: 'Pole has visible cracks at base' },
    });
    fireEvent.click(screen.getByRole('button', { name: /raise snag/i }));

    expect(await screen.findByText(/DB connection lost/)).toBeInTheDocument();
    // No confirmation panel
    expect(screen.queryByText(/snag raised/i)).not.toBeInTheDocument();
  });
});

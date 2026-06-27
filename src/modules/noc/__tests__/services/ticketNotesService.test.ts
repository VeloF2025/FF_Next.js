import { describe, it, expect, vi, beforeEach } from 'vitest';

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));
const { pushNoteMock } = vi.hoisted(() => ({ pushNoteMock: vi.fn() }));
vi.mock('@/lib/db', () => ({ default: { query: queryMock } }));
vi.mock('@/modules/noc/services/qcontactSyncOutbound', () => ({ pushNote: pushNoteMock }));

import { createTicketNote } from '@/modules/noc/services/ticketNotesService';

describe('createTicketNote', () => {
  beforeEach(() => {
    queryMock.mockReset();
    pushNoteMock.mockReset().mockResolvedValue({ success: true });
  });

  it('rejects empty content with 400 and never touches the DB', async () => {
    const res = await createTicketNote({ ticketId: 't1', content: '   ', visibility: 'private' });
    expect(res).toEqual({ ok: false, status: 400, message: 'Note content is required' });
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('returns 404 when the ticket does not exist', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] }); // ticket lookup
    const res = await createTicketNote({ ticketId: 't1', content: 'hi', visibility: 'private' });
    expect(res).toEqual({ ok: false, status: 404, message: 'Ticket not found' });
  });

  it('writes attachments as a text[] array (not a JSON string) and skips QContact for private notes', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ id: 't1' }] })  // ticket exists
      .mockResolvedValueOnce({ rows: [] })               // insert
      .mockResolvedValueOnce({ rows: [{ id: 'n1', attachments: ['/storage/a.jpg'] }] }); // fetch
    const res = await createTicketNote({
      ticketId: 't1', content: 'note', visibility: 'private',
      noteType: 'system', attachments: ['/storage/a.jpg', '/storage/b.jpg'],
    });
    expect(res.ok).toBe(true);
    const insertParams = queryMock.mock.calls[1]![1] as unknown[];
    expect(insertParams).toContainEqual(['/storage/a.jpg', '/storage/b.jpg']); // array passed through
    expect(insertParams).not.toContain(JSON.stringify(['/storage/a.jpg', '/storage/b.jpg']));
    expect(pushNoteMock).not.toHaveBeenCalled();
  });

  it('pushes public notes to QContact with the trimmed content', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ id: 't1' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'n1' }] });
    await createTicketNote({ ticketId: 't1', content: '  public note  ', visibility: 'public' });
    expect(pushNoteMock).toHaveBeenCalledWith('t1', 'public note', false);
  });
});

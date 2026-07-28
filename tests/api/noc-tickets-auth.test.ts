/**
 * Regression guard: the NOC ticket App Router routes were an unauthenticated CRUD surface.
 *
 * `middleware.ts` does not enforce session auth (it carries a "TODO: Re-enable when
 * adding Clerk auth back"), so App Router routes are only as protected as their own
 * handler code. These four had none: GET list, GET detail, PUT and DELETE never
 * rejected anyone. The `verifyToken` calls that existed read the cookie purely to label
 * the activity log — "best-effort attribution", with no rejection path — so an anonymous
 * caller could list every ticket, harvest ids, then read, edit or delete any of them.
 *
 * The assertions that matter are negative: an unauthenticated request must not reach the
 * service layer at all.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requireAuth, listTickets, getTicketById, updateTicket, deleteTicket, logTicketActivity } = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  listTickets: vi.fn(),
  getTicketById: vi.fn(),
  updateTicket: vi.fn(),
  deleteTicket: vi.fn(),
  logTicketActivity: vi.fn(),
}));

vi.mock('@/lib/auth/app-router', () => ({ requireAuth }));
vi.mock('@/modules/noc/services/ticketService', () => ({
  listTickets,
  getTicketById,
  updateTicket,
  deleteTicket,
  logTicketActivity,
  createTicket: vi.fn(),
}));
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

const DENIED = { status: 401 } as never;
const TICKET_ID = '11111111-2222-4333-8444-555555555555';

function req(url = `http://localhost/api/noc/tickets/${TICKET_ID}`) {
  return { url, json: async () => ({ status: 'resolved' }) } as never;
}

describe('NOC ticket routes reject unauthenticated callers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuth.mockResolvedValue([null, DENIED]);
  });

  it('GET /api/noc/tickets does not list tickets', async () => {
    const { GET } = await import('@/app/api/noc/tickets/route');
    const res = await GET(req('http://localhost/api/noc/tickets'));
    expect(res.status).toBe(401);
    expect(listTickets).not.toHaveBeenCalled();
  });

  it('GET /api/noc/tickets/[id] does not read the ticket', async () => {
    const { GET } = await import('@/app/api/noc/tickets/[id]/route');
    const res = await GET(req(), { params: { id: TICKET_ID } } as never);
    expect(res.status).toBe(401);
    expect(getTicketById).not.toHaveBeenCalled();
  });

  it('PUT /api/noc/tickets/[id] does not update the ticket', async () => {
    const { PUT } = await import('@/app/api/noc/tickets/[id]/route');
    const res = await PUT(req(), { params: { id: TICKET_ID } } as never);
    expect(res.status).toBe(401);
    expect(updateTicket).not.toHaveBeenCalled();
    expect(logTicketActivity).not.toHaveBeenCalled();
  });

  it('DELETE /api/noc/tickets/[id] does not delete the ticket', async () => {
    const { DELETE } = await import('@/app/api/noc/tickets/[id]/route');
    const res = await DELETE(req(), { params: { id: TICKET_ID } } as never);
    expect(res.status).toBe(401);
    expect(deleteTicket).not.toHaveBeenCalled();
  });
});

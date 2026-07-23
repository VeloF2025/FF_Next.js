/**
 * H&S Incidents API tests — created_by threading + orphan prevention
 *
 * Live maintenance_tickets.created_by is NOT NULL; the route must thread the
 * authenticated user's id into createTicket. If the hs_ticket_details insert
 * fails after the ticket is created (no transactions through the Neon shim),
 * the route must delete the just-created ticket so no detail-less ticket
 * (reverse orphan) is left behind.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMocks } from 'node-mocks-http';
import type { NextApiRequest, NextApiResponse } from 'next';

const { sqlMock, createTicketMock, logHsActivityMock, TEST_USER } = vi.hoisted(() => ({
  sqlMock: vi.fn(),
  createTicketMock: vi.fn(),
  logHsActivityMock: vi.fn(async () => {}),
  TEST_USER: { id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', email: 'reporter@velocityfibre.co.za' },
}));

vi.mock('@neondatabase/serverless', () => ({
  neon: vi.fn(() => sqlMock),
  neonConfig: { fetchConnectionCache: false },
}));

vi.mock('@/lib/auth', () => ({
  withAuth: (handler: (req: NextApiRequest, res: NextApiResponse) => unknown) => handler,
  getAuthUser: vi.fn(() => TEST_USER),
}));

vi.mock('@/modules/noc/services/ticketService', () => ({
  createTicket: (payload: unknown) => createTicketMock(payload),
}));

vi.mock('@/modules/health-safety/services/activityLog', () => ({
  logHsActivity: (entry: unknown) => logHsActivityMock(entry),
}));

import handler from '../../../../pages/api/health-safety/incidents/index';

const TICKET = { id: '123e4567-e89b-12d3-a456-426614174000', ticket_uid: 'HS-20260723-001' };

function postIncident(body: Record<string, unknown> = {}) {
  const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
    method: 'POST',
    body: {
      incident_type: 'near_miss',
      severity: 'minor',
      location: 'Test site',
      description: 'Test incident',
      ...body,
    },
  });
  return { req, res };
}

describe('POST /api/health-safety/incidents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sqlMock.mockResolvedValue([]);
    createTicketMock.mockResolvedValue(TICKET);
  });

  it('threads the authenticated user into createTicket as created_by', async () => {
    const { req, res } = postIncident();
    await handler(req, res);

    expect(res._getStatusCode()).toBe(201);
    expect(createTicketMock).toHaveBeenCalledTimes(1);
    const payload = createTicketMock.mock.calls[0]![0] as { created_by?: string };
    expect(payload.created_by).toBe(TEST_USER.id);
  });

  it('logs activity through the shim-safe helper with the user attached', async () => {
    const { req, res } = postIncident();
    await handler(req, res);

    expect(res._getStatusCode()).toBe(201);
    expect(logHsActivityMock).toHaveBeenCalledTimes(1);
    const entry = logHsActivityMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(entry.activityType).toBe('incident_reported');
    expect(entry.entityId).toBe(TICKET.id);
    expect((entry.user as { id: string }).id).toBe(TEST_USER.id);
  });

  it('deletes the created ticket when the details insert fails (no reverse orphan)', async () => {
    sqlMock.mockImplementation((strings: string[]) => {
      const text = strings.join('?');
      if (text.includes('INSERT INTO hs_ticket_details')) {
        return Promise.reject(new Error('boom'));
      }
      return Promise.resolve([]);
    });

    const { req, res } = postIncident();
    await handler(req, res);

    expect(res._getStatusCode()).toBe(500);
    const deleteCall = sqlMock.mock.calls.find((c) =>
      (c[0] as string[]).join('?').includes('DELETE FROM maintenance_tickets')
    );
    expect(deleteCall).toBeDefined();
    expect(deleteCall!.slice(1)).toContain(TICKET.id);
  });
});

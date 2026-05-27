/**
 * Ticket Summary API — query parameter parsing tests
 *
 * Focus: assigned_team_id must support multiple values so the summary counts
 * stay symmetric with the ticket list endpoint (app/api/noc/tickets/route.ts),
 * which already reads it via getAll().
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GET } from '@/app/api/noc/tickets/summary/route';
import { NextRequest } from 'next/server';

// Mock the db utility used by the route
vi.mock('@/modules/noc/utils/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
}));

// Mock the logger
vi.mock('@/lib/logger', () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), getLogs: vi.fn(() => []), clearLogs: vi.fn() },
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  })),
}));

import { query } from '@/modules/noc/utils/db';

const SUMMARY_URL = 'http://localhost:3000/api/noc/tickets/summary';

function teamFilterCall() {
  // Both the status and type count queries share the same SQL/values; either works.
  return vi.mocked(query).mock.calls.find(
    (c) => typeof c[0] === 'string' && (c[0] as string).includes('assigned_team_id')
  );
}

describe('GET /api/noc/tickets/summary — assigned_team_id filter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(query).mockResolvedValue([]);
  });

  it('builds an equality clause for a single team id', async () => {
    const req = new NextRequest(`${SUMMARY_URL}?assigned_team_id=team-a`);

    const response = await GET(req);

    expect(response.status).toBe(200);
    const call = teamFilterCall();
    expect(call).toBeDefined();
    expect(call?.[0]).toContain('assigned_team_id = $1');
    expect(call?.[1]).toEqual(['team-a']);
  });

  it('builds an IN clause for multiple team ids (multi-team filter)', async () => {
    const req = new NextRequest(`${SUMMARY_URL}?assigned_team_id=team-a&assigned_team_id=team-b`);

    const response = await GET(req);

    expect(response.status).toBe(200);
    const call = teamFilterCall();
    expect(call).toBeDefined();
    expect(call?.[0]).toContain('assigned_team_id IN ($1, $2)');
    expect(call?.[1]).toEqual(['team-a', 'team-b']);
  });

  it('omits the team clause entirely when no team id is provided', async () => {
    const req = new NextRequest(SUMMARY_URL);

    const response = await GET(req);

    expect(response.status).toBe(200);
    expect(teamFilterCall()).toBeUndefined();
  });
});

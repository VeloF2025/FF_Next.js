/**
 * Regression guard for an auth bypass that shipped to production.
 *
 * `POST /api/noc/tickets/[id]/analyze-screenshot` read the auth cookie inside a try
 * block and, when the token was missing or invalid, swallowed the failure, set
 * `createdBy = null` and CARRIED ON — uploading the caller's images to VF Storage,
 * spending GPU time on the VLM, and inserting a note on the ticket. No credential
 * required beyond knowing a ticket id.
 *
 * The assertions that matter are the negative ones: an unauthenticated request must
 * reach neither storage, nor the VLM, nor the note writer.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requireAuth, uploadFile, analyzeInstallScreenshots, createTicketNote, poolQuery } = vi.hoisted(
  () => ({
    requireAuth: vi.fn(),
    uploadFile: vi.fn(),
    analyzeInstallScreenshots: vi.fn(),
    createTicketNote: vi.fn(),
    poolQuery: vi.fn(),
  }),
);

vi.mock('@/lib/auth/app-router', () => ({ requireAuth }));
vi.mock('@/lib/db', () => ({ default: { query: poolQuery } }));
vi.mock('@/services/vfStorageAdapter', () => ({ vfStorage: { uploadFile } }));
vi.mock('@/modules/noc/services/screenshotNoteVlmClient', () => ({ analyzeInstallScreenshots }));
vi.mock('@/modules/noc/services/screenshotNoteAnalysis', () => ({ composeNoteBody: () => 'body' }));
vi.mock('@/modules/noc/services/ticketNotesService', () => ({ createTicketNote }));
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import { POST } from '@/app/api/noc/tickets/[id]/analyze-screenshot/route';

const ONE_PIXEL = 'data:image/png;base64,iVBORw0KGgo=';

function makeRequest() {
  return { json: async () => ({ images: [ONE_PIXEL], visibility: 'private' }) } as never;
}

const params = Promise.resolve({ id: 'ticket-1' });

function unauthorizedResponse(status: number) {
  return { status } as never;
}

describe('POST /api/noc/tickets/[id]/analyze-screenshot — authentication', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    poolQuery.mockResolvedValue({ rows: [{}] });
    uploadFile.mockResolvedValue({ url: 'https://storage/x.png' });
    analyzeInstallScreenshots.mockResolvedValue({ summary: 's' });
    createTicketNote.mockResolvedValue({ ok: true, note: { id: 'n1' } });
  });

  it('401s when unauthenticated, doing no work at all', async () => {
    requireAuth.mockResolvedValue([null, unauthorizedResponse(401)]);

    const res = await POST(makeRequest(), { params });

    expect(res.status).toBe(401);
    expect(uploadFile).not.toHaveBeenCalled();
    expect(analyzeInstallScreenshots).not.toHaveBeenCalled();
    expect(createTicketNote).not.toHaveBeenCalled();
  });

  it('relays any requireAuth denial verbatim, doing no work at all', async () => {
    // Uses 403 as the stand-in denial. requireAuth only returns 401 today; the 403 case
    // becomes real when the read-only MCP gate lands in it (PR #2249). What this pins is
    // that the route returns whatever requireAuth denies with, and does no work first.
    requireAuth.mockResolvedValue([null, unauthorizedResponse(403)]);

    const res = await POST(makeRequest(), { params });

    expect(res.status).toBe(403);
    expect(uploadFile).not.toHaveBeenCalled();
    expect(analyzeInstallScreenshots).not.toHaveBeenCalled();
    expect(createTicketNote).not.toHaveBeenCalled();
  });

  it('proceeds for a valid session and attributes the note to the verified subject', async () => {
    requireAuth.mockResolvedValue([{ id: 'user-42' }, null]);

    const res = await POST(makeRequest(), { params });

    expect(res.status).toBe(200);
    expect(createTicketNote).toHaveBeenCalledTimes(1);
    // createdBy must be the verified subject, never null and never client-supplied.
    expect(createTicketNote.mock.calls[0]![0]).toMatchObject({ createdBy: 'user-42' });
  });
});

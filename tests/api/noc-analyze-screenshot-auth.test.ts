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

const { cookieGet, verifyToken, uploadFile, analyzeInstallScreenshots, createTicketNote, poolQuery } = vi.hoisted(
  () => ({
    cookieGet: vi.fn(),
    verifyToken: vi.fn(),
    uploadFile: vi.fn(),
    analyzeInstallScreenshots: vi.fn(),
    createTicketNote: vi.fn(),
    poolQuery: vi.fn(),
  }),
);

vi.mock('next/headers', () => ({ cookies: async () => ({ get: cookieGet }) }));
vi.mock('@/lib/auth/jwt', () => ({ verifyToken }));
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

describe('POST /api/noc/tickets/[id]/analyze-screenshot — authentication', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    poolQuery.mockResolvedValue({ rows: [{}] });
    uploadFile.mockResolvedValue({ url: 'https://storage/x.png' });
    analyzeInstallScreenshots.mockResolvedValue({ summary: 's' });
    createTicketNote.mockResolvedValue({ ok: true, note: { id: 'n1' } });
  });

  it('401s when no auth cookie is present, doing no work at all', async () => {
    cookieGet.mockReturnValue(undefined);

    const res = await POST(makeRequest(), { params });

    expect(res.status).toBe(401);
    expect(verifyToken).not.toHaveBeenCalled();
    expect(uploadFile).not.toHaveBeenCalled();
    expect(analyzeInstallScreenshots).not.toHaveBeenCalled();
    expect(createTicketNote).not.toHaveBeenCalled();
  });

  it('401s when the token is present but invalid, doing no work at all', async () => {
    cookieGet.mockReturnValue({ value: 'forged.jwt.value' });
    verifyToken.mockResolvedValue(null);

    const res = await POST(makeRequest(), { params });

    expect(res.status).toBe(401);
    expect(uploadFile).not.toHaveBeenCalled();
    expect(analyzeInstallScreenshots).not.toHaveBeenCalled();
    expect(createTicketNote).not.toHaveBeenCalled();
  });

  it('proceeds for a valid token and attributes the note to the verified subject', async () => {
    cookieGet.mockReturnValue({ value: 'good.jwt.value' });
    verifyToken.mockResolvedValue({ sub: 'user-42' });

    const res = await POST(makeRequest(), { params });

    expect(res.status).toBe(200);
    expect(createTicketNote).toHaveBeenCalledTimes(1);
    // createdBy must be the verified subject, never null and never client-supplied.
    expect(createTicketNote.mock.calls[0]![0]).toMatchObject({ createdBy: 'user-42' });
  });
});

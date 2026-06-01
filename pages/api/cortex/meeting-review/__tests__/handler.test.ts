/**
 * Route-handler tests for /api/cortex/meeting-review/:meetingId.
 *
 * These drive the real exported handler through node-mocks-http with the auth +
 * DB + fetch seams mocked, to prove the security-critical behaviour:
 *
 *   (a) IDOR is closed — a POST carrying a foreign cortexMeetingId in the body
 *       acts ONLY on the Cortex meeting the :meetingId path param resolves to.
 *   (b) op→action tiering — unpublish→delete, approve/reject/edit/publish→edit,
 *       GET→view; a principal lacking the tier is refused (403).
 *   (c) null/empty/non-object POST body → 400 (not 500).
 *
 * The auth mock reproduces the production cascade faithfully: withPermission(perm,
 * action) refuses (403) unless the test principal was granted that exact action —
 * so a tiering regression (e.g. demoting unpublish to :edit) makes a test fail.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMocks } from 'node-mocks-http';
import type { NextApiRequest, NextApiResponse } from 'next';

// ── Controllable auth principal (per-test) ─────────────────────────────────────
// grantedActions is the set of cortex.review actions this principal holds.
const principal = {
  email: 'reviewer@test.com',
  grantedActions: new Set<string>(),
};

vi.mock('@/lib/auth', () => ({
  // withAuth injects the test user, mirroring the real middleware contract.
  withAuth: (handler: (req: NextApiRequest, res: NextApiResponse) => unknown) =>
    (req: NextApiRequest, res: NextApiResponse) => {
      (req as unknown as { user: { email: string } }).user = { email: principal.email };
      return handler(req, res);
    },
  // withPermission(perm, action) refuses with 403 unless the principal holds `action`.
  withPermission: (_perm: string, action: 'view' | 'create' | 'edit' | 'delete' = 'view') =>
    (handler: (req: NextApiRequest, res: NextApiResponse) => unknown) =>
      (req: NextApiRequest, res: NextApiResponse) => {
        if (!principal.grantedActions.has(action)) {
          return res.status(403).json({
            success: false,
            error: { code: 'FORBIDDEN', message: `Missing required permission: cortex.review` },
          });
        }
        return handler(req, res);
      },
}));

// ── DB seam: control sealed-row + call-record resolution ────────────────────────
const dbState = {
  sealedRow: null as Record<string, unknown> | null,
  callRecord: null as string | null,
  queueMeetingId: null as string | null,
  deleted: false,
};

vi.mock('@/lib/db-neon', () => ({
  neon: () =>
    ((strings: TemplateStringsArray) => {
      const q = (strings as unknown as string[]).join(' ? ').toLowerCase();
      if (q.includes('cortex_meeting_actions') && q.includes('select')) {
        return Promise.resolve(dbState.sealedRow ? [dbState.sealedRow] : []);
      }
      if (q.includes('teams_call_record_id')) {
        return Promise.resolve([{ teams_call_record_id: dbState.callRecord }]);
      }
      if (q.includes('delete from cortex_meeting_actions')) {
        dbState.deleted = true;
        return Promise.resolve([]);
      }
      return Promise.resolve([]);
    }),
}));

vi.mock('@/lib/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Captured fetch calls (url + parsed body), so we can assert the upstream target.
const fetchCalls: { url: string; body: unknown }[] = [];
function installFetch(reviewQueueMeetingId: string | null) {
  fetchCalls.length = 0;
  global.fetch = (async (url: string, init?: RequestInit) => {
    fetchCalls.push({ url, body: init?.body ? JSON.parse(init.body as string) : undefined });
    if (url.includes('/review-queue')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          meetings: reviewQueueMeetingId
            ? [{ meeting_id: reviewQueueMeetingId, source_id: dbState.callRecord, title: '', action_count: 0, processing_status: 'completed', updated_at: '' }]
            : [],
        }),
      } as Response;
    }
    // live-state / approve / publish / unpublish all return ok
    return { ok: true, status: 200, json: async () => ({ ok: true }) } as Response;
  }) as unknown as typeof fetch;
}

// Import AFTER mocks are registered.
import handler from '../[meetingId]';

function reset() {
  principal.grantedActions = new Set<string>();
  dbState.sealedRow = null;
  dbState.callRecord = null;
  dbState.queueMeetingId = null;
  dbState.deleted = false;
  installFetch(null);
}

describe('cortex/meeting-review route handler — RBAC tiering', () => {
  beforeEach(reset);

  it('GET requires cortex.review:view — refused (403) without it', async () => {
    const { req, res } = createMocks({ method: 'GET', query: { meetingId: '92488' } });
    await handler(req as unknown as NextApiRequest, res as unknown as NextApiResponse);
    expect(res._getStatusCode()).toBe(403);
  });

  it('GET allowed with :view returns a panel state', async () => {
    principal.grantedActions = new Set(['view']);
    dbState.callRecord = null; // no call record → none
    const { req, res } = createMocks({ method: 'GET', query: { meetingId: '92488' } });
    await handler(req as unknown as NextApiRequest, res as unknown as NextApiResponse);
    expect(res._getStatusCode()).toBe(200);
    expect(JSON.parse(res._getData()).data.panelState).toBe('none');
  });

  it('approve/publish (POST) require :edit — a :view-only principal is refused (403)', async () => {
    principal.grantedActions = new Set(['view']); // NOT edit
    const { req, res } = createMocks({ method: 'POST', query: { meetingId: '92488' }, body: { op: 'approve', actionId: 'a1' } });
    await handler(req as unknown as NextApiRequest, res as unknown as NextApiResponse);
    expect(res._getStatusCode()).toBe(403);
  });

  it('unpublish (POST) requires :delete — an :edit principal is refused (403)', async () => {
    principal.grantedActions = new Set(['view', 'edit']); // NOT delete
    dbState.sealedRow = { cortex_meeting_id: 'mtg_real', seal_source: 'human', human_reviewed: true, sealed_at: null, summary: null, items: [] };
    const { req, res } = createMocks({ method: 'POST', query: { meetingId: '92488' }, body: { op: 'unpublish' } });
    await handler(req as unknown as NextApiRequest, res as unknown as NextApiResponse);
    expect(res._getStatusCode()).toBe(403);
  });

  it('unpublish (POST) allowed for a :delete principal', async () => {
    principal.grantedActions = new Set(['view', 'edit', 'delete']);
    dbState.sealedRow = { cortex_meeting_id: 'mtg_real', seal_source: 'human', human_reviewed: true, sealed_at: null, summary: null, items: [] };
    const { req, res } = createMocks({ method: 'POST', query: { meetingId: '92488' }, body: { op: 'unpublish' } });
    await handler(req as unknown as NextApiRequest, res as unknown as NextApiResponse);
    expect(res._getStatusCode()).toBe(200);
    expect(dbState.deleted).toBe(true); // §4.4 reconciliation
  });
});

describe('cortex/meeting-review route handler — IDOR closure', () => {
  beforeEach(reset);

  it('approve acts ONLY on the path-resolved Cortex meeting, IGNORING a foreign cortexMeetingId in the body', async () => {
    principal.grantedActions = new Set(['view', 'edit']);
    // Path :meetingId 92488 resolves to mtg_real (sealed local row).
    dbState.sealedRow = { cortex_meeting_id: 'mtg_real', seal_source: 'human', human_reviewed: true, sealed_at: null, summary: null, items: [] };
    installFetch(null);

    const { req, res } = createMocks({
      method: 'POST',
      query: { meetingId: '92488' },
      // Attacker tries to redirect the mutation at someone else's meeting:
      body: { op: 'approve', actionId: 'a1', cortexMeetingId: 'mtg_VICTIM' },
    });
    await handler(req as unknown as NextApiRequest, res as unknown as NextApiResponse);

    expect(res._getStatusCode()).toBe(200);
    const approveCall = fetchCalls.find(c => c.url.includes('/proposed-actions/'));
    expect(approveCall).toBeDefined();
    // The upstream URL must target mtg_real (path-resolved), NEVER mtg_VICTIM (body).
    expect(approveCall!.url).toContain('/meetings/mtg_real/');
    expect(approveCall!.url).not.toContain('mtg_VICTIM');
  });

  it('publish targets the path-resolved meeting (unsealed → review-queue resolution), ignoring body id', async () => {
    principal.grantedActions = new Set(['view', 'edit']);
    dbState.sealedRow = null;                 // not sealed
    dbState.callRecord = 'cr-92488';          // path → call record
    installFetch('mtg_from_queue');           // review-queue maps cr-92488 → mtg_from_queue

    const { req, res } = createMocks({
      method: 'POST',
      query: { meetingId: '92488' },
      body: { op: 'publish', cortexMeetingId: 'mtg_VICTIM' },
    });
    await handler(req as unknown as NextApiRequest, res as unknown as NextApiResponse);

    expect(res._getStatusCode()).toBe(200);
    const publishCall = fetchCalls.find(c => c.url.includes('/publish'));
    expect(publishCall).toBeDefined();
    expect(publishCall!.url).toContain('/meetings/mtg_from_queue/publish');
    expect(publishCall!.url).not.toContain('mtg_VICTIM');
  });

  it('returns 404 (not a mutation) when the path meeting maps to no Cortex meeting', async () => {
    principal.grantedActions = new Set(['view', 'edit']);
    dbState.sealedRow = null;
    dbState.callRecord = null; // no mapping at all
    installFetch(null);

    const { req, res } = createMocks({
      method: 'POST',
      query: { meetingId: '92488' },
      body: { op: 'approve', actionId: 'a1', cortexMeetingId: 'mtg_VICTIM' },
    });
    await handler(req as unknown as NextApiRequest, res as unknown as NextApiResponse);

    expect(res._getStatusCode()).toBe(404);
    // No proposed-actions call should have been made.
    expect(fetchCalls.find(c => c.url.includes('/proposed-actions/'))).toBeUndefined();
  });
});

describe('cortex/meeting-review route handler — editSummary (Goal 3b)', () => {
  beforeEach(reset);

  it('editSummary requires :edit — a :view-only principal is refused (403)', async () => {
    principal.grantedActions = new Set(['view']); // NOT edit
    const { req, res } = createMocks({ method: 'POST', query: { meetingId: '92488' }, body: { op: 'editSummary', text: 'x' } });
    await handler(req as unknown as NextApiRequest, res as unknown as NextApiResponse);
    expect(res._getStatusCode()).toBe(403);
  });

  it('editSummary posts to the path-resolved meeting /summary, ignoring a foreign body id (IDOR-safe)', async () => {
    principal.grantedActions = new Set(['view', 'edit']);
    dbState.sealedRow = { cortex_meeting_id: 'mtg_real', seal_source: 'human', human_reviewed: true, sealed_at: null, summary: null, items: [] };
    installFetch(null);

    const { req, res } = createMocks({
      method: 'POST',
      query: { meetingId: '92488' },
      body: { op: 'editSummary', text: 'Human exec summary', cortexMeetingId: 'mtg_VICTIM' },
    });
    await handler(req as unknown as NextApiRequest, res as unknown as NextApiResponse);

    expect(res._getStatusCode()).toBe(200);
    const summaryCall = fetchCalls.find(c => c.url.endsWith('/summary'));
    expect(summaryCall).toBeDefined();
    expect(summaryCall!.url).toContain('/meetings/mtg_real/summary');
    expect(summaryCall!.url).not.toContain('mtg_VICTIM');
    expect(summaryCall!.body).toEqual({ summary: 'Human exec summary' });
  });

  it('editSummary with no text clears the override (summary:null)', async () => {
    principal.grantedActions = new Set(['view', 'edit']);
    dbState.sealedRow = { cortex_meeting_id: 'mtg_real', seal_source: 'human', human_reviewed: true, sealed_at: null, summary: null, items: [] };
    installFetch(null);

    const { req, res } = createMocks({ method: 'POST', query: { meetingId: '92488' }, body: { op: 'editSummary' } });
    await handler(req as unknown as NextApiRequest, res as unknown as NextApiResponse);

    expect(res._getStatusCode()).toBe(200);
    const summaryCall = fetchCalls.find(c => c.url.endsWith('/summary'));
    expect(summaryCall!.body).toEqual({ summary: null });
  });
});

describe('cortex/meeting-review route handler — body validation', () => {
  beforeEach(reset);

  it('null POST body → 400, not 500', async () => {
    principal.grantedActions = new Set(['view', 'edit', 'delete']);
    const { req, res } = createMocks({ method: 'POST', query: { meetingId: '92488' }, body: null });
    await handler(req as unknown as NextApiRequest, res as unknown as NextApiResponse);
    expect(res._getStatusCode()).toBe(400);
  });

  it('empty-object POST body (no op) → 400', async () => {
    principal.grantedActions = new Set(['view', 'edit', 'delete']);
    const { req, res } = createMocks({ method: 'POST', query: { meetingId: '92488' }, body: {} });
    await handler(req as unknown as NextApiRequest, res as unknown as NextApiResponse);
    expect(res._getStatusCode()).toBe(400);
  });

  it('unknown op → 400', async () => {
    principal.grantedActions = new Set(['view', 'edit', 'delete']);
    const { req, res } = createMocks({ method: 'POST', query: { meetingId: '92488' }, body: { op: 'destroy' } });
    await handler(req as unknown as NextApiRequest, res as unknown as NextApiResponse);
    expect(res._getStatusCode()).toBe(400);
  });

  it('approve with no actionId → 400', async () => {
    principal.grantedActions = new Set(['view', 'edit']);
    dbState.sealedRow = { cortex_meeting_id: 'mtg_real', seal_source: 'human', human_reviewed: true, sealed_at: null, summary: null, items: [] };
    const { req, res } = createMocks({ method: 'POST', query: { meetingId: '92488' }, body: { op: 'approve' } });
    await handler(req as unknown as NextApiRequest, res as unknown as NextApiResponse);
    expect(res._getStatusCode()).toBe(400);
  });

  it('unsupported method → 405', async () => {
    principal.grantedActions = new Set(['view', 'edit', 'delete']);
    const { req, res } = createMocks({ method: 'DELETE', query: { meetingId: '92488' } });
    await handler(req as unknown as NextApiRequest, res as unknown as NextApiResponse);
    expect(res._getStatusCode()).toBe(405);
  });
});

describe('cortex/meeting-review route handler — upstream error propagation', () => {
  beforeEach(reset);

  // Make the edit/proposed-actions upstream call return a chosen non-OK status+body.
  function installUpstream(status: number, body: unknown) {
    global.fetch = (async (url: string) => {
      if (url.includes('/proposed-actions/')) {
        return { ok: false, status, text: async () => JSON.stringify(body), json: async () => body } as unknown as Response;
      }
      return { ok: true, status: 200, json: async () => ({ ok: true }) } as unknown as Response;
    }) as unknown as typeof fetch;
  }

  it('Cortex 422 (no field changes) → 400 with the real message, NOT a masked 500', async () => {
    principal.grantedActions = new Set(['view', 'edit']);
    dbState.sealedRow = { cortex_meeting_id: 'mtg_real', seal_source: 'human', human_reviewed: true, sealed_at: null, summary: null, items: [] };
    installUpstream(422, { detail: 'no field changes in edit' });
    const { req, res } = createMocks({ method: 'POST', query: { meetingId: '92488' }, body: { op: 'edit', actionId: 'a1', text: 'x' } });
    await handler(req as unknown as NextApiRequest, res as unknown as NextApiResponse);
    expect(res._getStatusCode()).toBe(400); // not 500
    expect(JSON.parse(res._getData()).error.message).toContain('no field changes');
  });

  it('Cortex 409 (write conflict) → 409 conflict, not 500', async () => {
    principal.grantedActions = new Set(['view', 'edit']);
    dbState.sealedRow = { cortex_meeting_id: 'mtg_real', seal_source: 'human', human_reviewed: true, sealed_at: null, summary: null, items: [] };
    installUpstream(409, { detail: 'live-state write conflict, retry' });
    const { req, res } = createMocks({ method: 'POST', query: { meetingId: '92488' }, body: { op: 'approve', actionId: 'a1' } });
    await handler(req as unknown as NextApiRequest, res as unknown as NextApiResponse);
    expect(res._getStatusCode()).toBe(409);
  });

  it('Cortex 500 stays a 500 (genuine upstream failure)', async () => {
    principal.grantedActions = new Set(['view', 'edit']);
    dbState.sealedRow = { cortex_meeting_id: 'mtg_real', seal_source: 'human', human_reviewed: true, sealed_at: null, summary: null, items: [] };
    installUpstream(500, { detail: 'boom' });
    const { req, res } = createMocks({ method: 'POST', query: { meetingId: '92488' }, body: { op: 'approve', actionId: 'a1' } });
    await handler(req as unknown as NextApiRequest, res as unknown as NextApiResponse);
    expect(res._getStatusCode()).toBe(500);
  });
});

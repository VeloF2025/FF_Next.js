/**
 * Cortex Meeting Reviewer Proxy
 *
 * Handles all reviewer interactions for a single FibreFlow meeting:
 *   GET  /api/cortex/meeting-review/:meetingId   — panel state (sealed/unsealed/none)
 *   POST /api/cortex/meeting-review/:meetingId   — action mutations + publish/unpublish
 *
 * Server-side mapping (spec §4.2):
 *   1. Resolve teams_call_record_id from meetings WHERE id = :meetingId
 *   2. Sealed view  → read cortex_meeting_actions WHERE ff_meeting_id = :meetingId
 *   3. Unsealed     → GET /review-queue, find row whose source_id === teams_call_record_id
 *                     → resolve cortex_meeting_id → GET /live-state
 *   4. Mutations    → proxy through with the SERVER-RESOLVED cortex_meeting_id
 *
 * SECURITY: the Cortex meeting id a mutation acts on is ALWAYS resolved server-side
 * from the :meetingId path param. A client-supplied cortexMeetingId is never trusted —
 * this closes the IDOR where a cortex.review:edit principal could mutate an arbitrary
 * Cortex meeting by sending a foreign id in the body.
 *
 * RBAC (spec §4.3):
 *   GET    — cortex.review:view  (all reviewers)
 *   POST   — cortex.review:edit  (approve/reject/edit/publish) or :delete (unpublish)
 *
 * Pure mapping logic is in src/lib/cortex/meetingReviewLogic.ts (unit-testable).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@/lib/db-neon';
import { withAuth, withPermission } from '@/lib/auth';
import type { AuthenticatedNextApiRequest } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import {
  resolveCallRecordId,
  readSealedRow,
  resolveUnsealedMeetingId,
  fetchLiveState,
  deleteLocalSealedRow,
  fetchWithTimeout,
  type NoPanelResponse,
  type UnsealedMeetingPanel,
  type Sql,
} from '@/lib/cortex/meetingReviewLogic';

// ── env ────────────────────────────────────────────────────────────────────────
const BRIDGE_URL = process.env.CORTEX_BRIDGE_URL ?? 'http://localhost:7403';
const API_KEY = process.env.CORTEX_API_KEY ?? '';

function cortexHeaders(reviewerEmail: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}),
    'X-Cortex-Reviewer': reviewerEmail,
  };
}

/**
 * Relay a non-OK upstream Cortex response to the client with a MEANINGFUL status +
 * message. Without this, a Cortex 4xx (e.g. 422 "no field changes in edit", 409
 * write-conflict) was masked as an opaque 500 "An internal error occurred". Only
 * genuine upstream 5xx / unknown statuses become a 500.
 */
async function relayUpstreamError(
  res: NextApiResponse,
  op: string,
  cortexMeetingId: string,
  upstream: Response,
): Promise<void> {
  const raw = await upstream.text().catch(() => '');
  let msg = `Cortex ${op} failed (${upstream.status})`;
  try {
    const j = JSON.parse(raw) as { detail?: unknown; message?: unknown };
    if (typeof j.detail === 'string') msg = j.detail;
    else if (Array.isArray(j.detail) && typeof (j.detail[0] as { msg?: string })?.msg === 'string') {
      msg = (j.detail[0] as { msg: string }).msg;
    } else if (typeof j.message === 'string') msg = j.message;
  } catch { /* non-JSON upstream body — keep the default msg */ }
  log.warn(`Cortex ${op} returned ${upstream.status}`, { cortexMeetingId, status: upstream.status, detail: raw.slice(0, 300) }, 'cortex-meeting-review');
  if (upstream.status === 409) return apiResponse.conflict(res, msg);
  if (upstream.status === 403) return apiResponse.forbidden(res, msg);
  if (upstream.status >= 400 && upstream.status < 500) return apiResponse.badRequest(res, msg);
  return apiResponse.internalError(res, new Error(`Cortex ${op} returned ${upstream.status}: ${msg}`));
}

// ── mutation body types ────────────────────────────────────────────────────────
// NOTE: cortexMeetingId is intentionally NOT part of any op — the server resolves it
// from the path param. Any client-supplied cortexMeetingId is ignored.

type MutationOp =
  | { op: 'approve' | 'reject'; actionId: string }
  | { op: 'edit'; actionId: string; text?: string; owner?: string; due?: string }
  | { op: 'publish' }
  | { op: 'unpublish' };

/** Allowed op → action-tier mapping (single source of truth, also used by dispatch) */
export function opToAction(op: unknown): 'edit' | 'delete' | null {
  if (op === 'unpublish') return 'delete';
  if (op === 'approve' || op === 'reject' || op === 'edit' || op === 'publish') return 'edit';
  return null;
}

/**
 * Resolve the Cortex meeting_id for a FibreFlow meeting id, server-side only.
 * Tries the sealed local row first, then the live review-queue → live-state path.
 * Returns null when the meeting maps to no Cortex meeting (or is not a Teams meeting).
 */
async function resolveCortexMeetingId(
  sql: Sql,
  ffMeetingId: string,
  reviewerEmail: string,
): Promise<string | null> {
  const sealed = await readSealedRow(sql, ffMeetingId);
  if (sealed) return sealed.cortexMeetingId;

  const callRecordId = await resolveCallRecordId(sql, ffMeetingId);
  if (!callRecordId) return null;

  return resolveUnsealedMeetingId(callRecordId, reviewerEmail, BRIDGE_URL, API_KEY);
}

// ── GET handler ────────────────────────────────────────────────────────────────

async function getHandler(
  req: AuthenticatedNextApiRequest,
  res: NextApiResponse,
): Promise<void> {
  const { meetingId } = req.query as { meetingId: string };
  const reviewerEmail = req.user.email;
  const sql: Sql = neon(process.env.DATABASE_URL!);

  // 1. Sealed? — check local table first (cheap DB query, no Cortex call)
  const sealed = await readSealedRow(sql, meetingId);
  if (sealed) {
    return apiResponse.success(res, sealed);
  }

  // 2. Not sealed — need teams_call_record_id to match against review-queue
  const callRecordId = await resolveCallRecordId(sql, meetingId);
  if (!callRecordId) {
    return apiResponse.success(res, { panelState: 'none' } satisfies NoPanelResponse);
  }

  const cortexMeetingId = await resolveUnsealedMeetingId(callRecordId, reviewerEmail, BRIDGE_URL, API_KEY);
  if (!cortexMeetingId) {
    return apiResponse.success(res, { panelState: 'none' } satisfies NoPanelResponse);
  }

  const liveState = await fetchLiveState(cortexMeetingId, reviewerEmail, BRIDGE_URL, API_KEY);
  if (!liveState) {
    return apiResponse.success(res, { panelState: 'none' } satisfies NoPanelResponse);
  }

  const panel: UnsealedMeetingPanel = {
    panelState: 'unsealed',
    cortexMeetingId,
    proposedActions: liveState.proposed_actions ?? [],
    minutes: liveState.minutes ?? null,
  };
  return apiResponse.success(res, panel);
}

// ── POST handler ───────────────────────────────────────────────────────────────

async function postHandler(
  req: AuthenticatedNextApiRequest,
  res: NextApiResponse,
): Promise<void> {
  const { meetingId } = req.query as { meetingId: string };
  const reviewerEmail = req.user.email;

  // Guard null / non-object body (e.g. empty POST, non-JSON) → 400, not 500.
  const body = req.body;
  if (body === null || body === undefined || typeof body !== 'object' || Array.isArray(body)) {
    return apiResponse.badRequest(res, 'A JSON object body is required');
  }
  const { op } = body as Partial<MutationOp>;

  if (!op) {
    return apiResponse.badRequest(res, 'op is required');
  }
  if (opToAction(op) === null) {
    return apiResponse.badRequest(res, `Unknown op: ${String(op)}`);
  }

  const sql: Sql = neon(process.env.DATABASE_URL!);

  // ── unpublish (re-open) — cortex.review:delete enforced by wrapper ─────────
  if (op === 'unpublish') {
    const sealed = await readSealedRow(sql, meetingId);
    if (!sealed) {
      return apiResponse.notFound(res, 'Sealed meeting', meetingId);
    }

    const url = `${BRIDGE_URL}/api/meetings/${encodeURIComponent(sealed.cortexMeetingId)}/unpublish`;
    const upstream = await fetchWithTimeout(fetch, url, {
      method: 'POST',
      headers: cortexHeaders(reviewerEmail),
      body: JSON.stringify({}),
    });

    if (!upstream.ok) {
      return relayUpstreamError(res, 'unpublish', sealed.cortexMeetingId, upstream);
    }

    // §4.4: Delete local row so the panel does not show a stale "sealed" view.
    await deleteLocalSealedRow(sql, meetingId);
    log.info('Cortex meeting re-opened, local row removed', { meetingId, cortexMeetingId: sealed.cortexMeetingId }, 'cortex-meeting-review');
    return apiResponse.success(res, { ok: true, cortexMeetingId: sealed.cortexMeetingId });
  }

  // ── approve / reject / edit / publish — cortex.review:edit enforced ────────
  // SECURITY: resolve the Cortex meeting id from the path param, NEVER the body.
  const cortexMeetingId = await resolveCortexMeetingId(sql, meetingId, reviewerEmail);
  if (!cortexMeetingId) {
    return apiResponse.notFound(res, 'Cortex meeting', meetingId);
  }

  let upstreamUrl: string;
  let upstreamBody: Record<string, unknown>;

  if (op === 'publish') {
    upstreamUrl = `${BRIDGE_URL}/api/meetings/${encodeURIComponent(cortexMeetingId)}/publish`;
    upstreamBody = {};
  } else if (op === 'approve' || op === 'reject') {
    const { actionId } = body as { op: 'approve' | 'reject'; actionId: string };
    if (!actionId) return apiResponse.badRequest(res, 'actionId is required');
    upstreamUrl = `${BRIDGE_URL}/api/meetings/${encodeURIComponent(cortexMeetingId)}/proposed-actions/${encodeURIComponent(actionId)}/${op}`;
    upstreamBody = {};
  } else {
    // op === 'edit'
    const { actionId, text, owner, due } = body as { op: 'edit'; actionId: string; text?: string; owner?: string; due?: string };
    if (!actionId) return apiResponse.badRequest(res, 'actionId is required');
    upstreamUrl = `${BRIDGE_URL}/api/meetings/${encodeURIComponent(cortexMeetingId)}/proposed-actions/${encodeURIComponent(actionId)}/edit`;
    upstreamBody = { text, owner, due };
  }

  const upstream = await fetchWithTimeout(fetch, upstreamUrl, {
    method: 'POST',
    headers: cortexHeaders(reviewerEmail),
    body: JSON.stringify(upstreamBody),
  });

  if (!upstream.ok) {
    return relayUpstreamError(res, op, cortexMeetingId, upstream);
  }

  const upstreamData = (await upstream.json()) as unknown;
  return apiResponse.success(res, upstreamData ?? { ok: true });
}

// ── route dispatch ─────────────────────────────────────────────────────────────

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const authReq = req as AuthenticatedNextApiRequest;

  if (req.method === 'GET') {
    return withPermission('cortex.review', 'view')(
      async (r, s) => {
        try {
          await getHandler(r as AuthenticatedNextApiRequest, s);
        } catch (err) {
          log.error('cortex-meeting-review GET error', { error: err }, 'cortex-meeting-review');
          apiResponse.internalError(s, err instanceof Error ? err : new Error(String(err)));
        }
      },
    )(authReq, res);
  }

  if (req.method === 'POST') {
    const body = (req.body ?? {}) as Partial<MutationOp>;
    // op→action tier: unpublish needs :delete; approve/reject/edit/publish need :edit.
    // An unknown/missing op falls back to the strictest tier (delete) so that the
    // permission wrapper, not the handler, refuses an under-privileged caller first;
    // the handler then 400s on the bad op for an authorized caller.
    const action = opToAction(body.op) ?? 'delete';

    return withPermission('cortex.review', action)(
      async (r, s) => {
        try {
          await postHandler(r as AuthenticatedNextApiRequest, s);
        } catch (err) {
          log.error('cortex-meeting-review POST error', { error: err }, 'cortex-meeting-review');
          apiResponse.internalError(s, err instanceof Error ? err : new Error(String(err)));
        }
      },
    )(authReq, res);
  }

  return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET', 'POST']);
}

export default withAuth(handler);

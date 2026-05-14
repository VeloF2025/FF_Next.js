import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { withAuth, withPermission, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { log } from '@/lib/logger';
import { resolvePhotoSnag } from '@/modules/works-qa/services/photoSnagService';

interface Body {
  snag_id?: string;
  resolution_note?: string;
  /** Default true — Hein chose auto-resolve linked NOC ticket on snag verify. */
  close_ticket?: boolean;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return apiResponse.methodNotAllowed(res, req.method!, ['POST']);
  const { snag_id, resolution_note, close_ticket } = (req.body ?? {}) as Body;
  if (!snag_id) return apiResponse.error(res, ErrorCode.VALIDATION_ERROR, 'snag_id is required');
  if (resolution_note && resolution_note.length > 2000) {
    return apiResponse.error(res, ErrorCode.VALIDATION_ERROR, 'resolution_note too long (max 2000 chars)');
  }
  const userId = (req as AuthenticatedNextApiRequest).user.id;
  try {
    const result = await resolvePhotoSnag({
      snagId: snag_id,
      resolvedBy: userId,
      resolutionNote: resolution_note?.trim(),
      closeTicket: close_ticket ?? true,
    });
    return apiResponse.success(res, { snag: result.snag, ticket_resolved: result.ticketResolved });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error('works-qa/photo-snag-resolve', { error: msg, snag_id });
    if (msg.includes('snag not found')) return apiResponse.notFound(res, 'Snag', snag_id);
    return apiResponse.internalError(res, err);
  }
}

export default withAuth(withPermission('construction-qa.works-qa.approve', 'edit')(handler));

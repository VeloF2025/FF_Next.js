import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { withAuth, withPermission, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { log } from '@/lib/logger';
import { approvePhoto } from '@/modules/works-qa/services/photoSnagService';

interface Body {
  pole_qa_photo_id?: string;
  slot_key?: string;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return apiResponse.methodNotAllowed(res, req.method!, ['POST']);
  const { pole_qa_photo_id, slot_key } = (req.body ?? {}) as Body;
  if (!pole_qa_photo_id || !slot_key) {
    return apiResponse.error(res, ErrorCode.VALIDATION_ERROR, 'pole_qa_photo_id and slot_key are required');
  }
  const userId = (req as AuthenticatedNextApiRequest).user.id;
  try {
    const slotApprovals = await approvePhoto({
      poleQaPhotoId: pole_qa_photo_id,
      slotKey: slot_key,
      approvedBy: userId,
    });
    return apiResponse.success(res, { slot_approvals: slotApprovals });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error('works-qa/photo-approve', { error: msg, pole_qa_photo_id, slot_key });
    if (msg.includes('Unknown slot key')) {
      return apiResponse.error(res, ErrorCode.VALIDATION_ERROR, msg);
    }
    if (msg.includes('not found')) return apiResponse.notFound(res, 'Pole', pole_qa_photo_id);
    return apiResponse.internalError(res, err);
  }
}

export default withAuth(withPermission('construction-qa.works-qa.approve', 'edit')(handler));

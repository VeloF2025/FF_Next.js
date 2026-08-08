import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withPermission, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { createZoneDeliveryService } from '@/modules/construction-qa/zone-delivery/services/zoneDeliveryService';
import {
  COMMAND_PERMISSIONS,
  parseMilestoneBody,
  zoneDeliveryErrorBoundary,
  zoneDeliveryResponse,
} from '@/modules/construction-qa/zone-delivery/services/zoneDeliveryHttp';

const service = createZoneDeliveryService(pool);
type MilestonePermission =
  | typeof COMMAND_PERMISSIONS.construction
  | typeof COMMAND_PERMISSIONS.testing
  | typeof COMMAND_PERMISSIONS.operations;

const permissionFor = (body: ReturnType<typeof parseMilestoneBody>): MilestonePermission => {
  if (body.action === 'link_maintenance') return COMMAND_PERMISSIONS.operations;
  if (body.milestone === 'civil_complete' || body.milestone === 'optical_complete') {
    return COMMAND_PERMISSIONS.construction;
  }
  return body.milestone === 'testing_passed'
    ? COMMAND_PERMISSIONS.testing
    : COMMAND_PERMISSIONS.operations;
};

function permittedHandler(permission: MilestonePermission) {
  return withPermission(permission, 'edit')(async (req: NextApiRequest, res: NextApiResponse) => {
    return zoneDeliveryResponse(res, async () => {
      const input = parseMilestoneBody(req.body);
      const user = (req as AuthenticatedNextApiRequest).user;
      return service.confirmPonMilestone(input, {
        userId: user.id,
        email: user.email,
        permission,
      });
    });
  });
}

const construction = permittedHandler(COMMAND_PERMISSIONS.construction);
const testing = permittedHandler(COMMAND_PERMISSIONS.testing);
const operations = permittedHandler(COMMAND_PERMISSIONS.operations);
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['POST']);
  return zoneDeliveryErrorBoundary(res, async () => {
    const permission = permissionFor(parseMilestoneBody(req.body));
    const selected = permission === COMMAND_PERMISSIONS.construction
      ? construction
      : permission === COMMAND_PERMISSIONS.testing ? testing : operations;
    await selected(req, res);
  });
}
export default withAuth(handler);

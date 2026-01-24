/**
 * Service Registry API
 *
 * GET    /api/system/services - List all services
 * POST   /api/system/services - Create service
 * PUT    /api/system/services - Update service
 * DELETE /api/system/services - Delete service
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, withRole } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';
import { withErrorHandler } from '@/lib/apiErrorHandler';
import { serviceRegistry } from '@/modules/system/services/serviceRegistry';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  switch (req.method) {
    case 'GET':
      return getServices(req, res);
    case 'POST':
      return createService(req, res);
    case 'PUT':
      return updateService(req, res);
    case 'DELETE':
      return deleteService(req, res);
    default:
      res.setHeader('Allow', ['GET', 'POST', 'PUT', 'DELETE']);
      return apiResponse.error(res, 'Method not allowed', 405);
  }
}

async function getServices(req: NextApiRequest, res: NextApiResponse) {
  const { category, critical, enabled } = req.query;

  let services;

  if (category) {
    services = await serviceRegistry.getServicesByCategory(category as string);
  } else if (critical === 'true') {
    services = await serviceRegistry.getCriticalServices();
  } else if (enabled === 'true') {
    services = await serviceRegistry.getEnabledServices();
  } else {
    services = await serviceRegistry.getAllServices();
  }

  // Get recovery actions for each service
  const servicesWithActions = await Promise.all(
    services.map(async (service) => ({
      ...service,
      recoveryActions: await serviceRegistry.getRecoveryActions(service.id),
    }))
  );

  return apiResponse.success(res, {
    services: servicesWithActions,
    count: services.length,
    byCategory: await serviceRegistry.getServiceCountByCategory(),
  });
}

async function createService(req: NextApiRequest, res: NextApiResponse) {
  const {
    name,
    category,
    description,
    healthEndpoint,
    healthCheckType,
    isCritical,
    isEnabled,
    timeoutMs,
    recoveryEnabled,
    maxRecoveryAttempts,
    cooldownMinutes,
  } = req.body;

  if (!name || !category) {
    return apiResponse.error(res, 'Name and category are required', 400);
  }

  const service = await serviceRegistry.createService({
    name,
    category,
    description,
    healthEndpoint,
    healthCheckType: healthCheckType || 'http',
    isCritical: isCritical || false,
    isEnabled: isEnabled !== false,
    timeoutMs: timeoutMs || 5000,
    recoveryEnabled: recoveryEnabled || false,
    maxRecoveryAttempts: maxRecoveryAttempts || 3,
    cooldownMinutes: cooldownMinutes || 5,
  });

  return apiResponse.success(res, service, 201);
}

async function updateService(req: NextApiRequest, res: NextApiResponse) {
  const { id, ...updates } = req.body;

  if (!id) {
    return apiResponse.error(res, 'Service ID is required', 400);
  }

  const service = await serviceRegistry.updateService(id, updates);

  if (!service) {
    return apiResponse.notFound(res, 'Service', id);
  }

  return apiResponse.success(res, service);
}

async function deleteService(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query;

  if (!id || typeof id !== 'string') {
    return apiResponse.error(res, 'Service ID is required', 400);
  }

  const deleted = await serviceRegistry.deleteService(id);

  if (!deleted) {
    return apiResponse.notFound(res, 'Service', id);
  }

  return apiResponse.success(res, { deleted: true });
}

export default withAuth(withRole('super_admin')(withErrorHandler(handler)));

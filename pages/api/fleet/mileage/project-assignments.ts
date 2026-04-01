/**
 * Fleet Vehicle Project Assignments API
 * GET    /api/fleet/mileage/project-assignments?vehicleId=xxx — list assignments for a vehicle
 * GET    /api/fleet/mileage/project-assignments?projectId=xxx — list assignments for a project
 * POST   /api/fleet/mileage/project-assignments — assign vehicle to project
 * DELETE /api/fleet/mileage/project-assignments?id=xxx — deactivate assignment
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@/lib/db-neon';
import { withErrorHandler } from '@/lib/api-error-handler';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';
import type { VehicleProjectAssignmentRow } from '@/modules/fleet/types';
import { isValidUUID } from '@/modules/fleet/services/mileageUtils';

const sql = neon(process.env.DATABASE_URL!);

function mapRow(row: VehicleProjectAssignmentRow) {
  return {
    id: row.id,
    vehicleId: row.vehicle_id,
    registration: row.registration,
    projectId: row.project_id,
    projectCode: row.project_code,
    projectName: row.project_name,
    assignedDate: row.assigned_date,
    returnedDate: row.returned_date,
    isActive: row.is_active,
    notes: row.notes,
  };
}

export default withAuth(withErrorHandler(async (req: NextApiRequest, res: NextApiResponse) => {
  // GET: list assignments
  if (req.method === 'GET') {
    const { vehicleId, projectId } = req.query;

    const rows = vehicleId
      ? await sql`
          SELECT fvpa.id, fvpa.vehicle_id, fv.registration,
                 fvpa.project_id, p.project_code, p.project_name,
                 fvpa.assigned_date, fvpa.returned_date, fvpa.is_active, fvpa.notes
          FROM fleet_vehicle_project_assignments fvpa
          JOIN fleet_vehicles fv ON fv.id = fvpa.vehicle_id
          JOIN projects p ON p.id = fvpa.project_id
          WHERE fvpa.vehicle_id = ${vehicleId}
          ORDER BY fvpa.is_active DESC, fvpa.assigned_date DESC
        ` as VehicleProjectAssignmentRow[]
      : projectId
      ? await sql`
          SELECT fvpa.id, fvpa.vehicle_id, fv.registration,
                 fvpa.project_id, p.project_code, p.project_name,
                 fvpa.assigned_date, fvpa.returned_date, fvpa.is_active, fvpa.notes
          FROM fleet_vehicle_project_assignments fvpa
          JOIN fleet_vehicles fv ON fv.id = fvpa.vehicle_id
          JOIN projects p ON p.id = fvpa.project_id
          WHERE fvpa.project_id = ${projectId}
          ORDER BY fvpa.is_active DESC, fvpa.assigned_date DESC
        ` as VehicleProjectAssignmentRow[]
      : await sql`
          SELECT fvpa.id, fvpa.vehicle_id, fv.registration,
                 fvpa.project_id, p.project_code, p.project_name,
                 fvpa.assigned_date, fvpa.returned_date, fvpa.is_active, fvpa.notes
          FROM fleet_vehicle_project_assignments fvpa
          JOIN fleet_vehicles fv ON fv.id = fvpa.vehicle_id
          JOIN projects p ON p.id = fvpa.project_id
          WHERE fvpa.is_active = true
          ORDER BY fvpa.assigned_date DESC
        ` as VehicleProjectAssignmentRow[];

    return apiResponse.success(res, rows.map(mapRow));
  }

  // POST: assign vehicle to project
  if (req.method === 'POST') {
    const { vehicleId, projectId, assignedDate, notes } = req.body;

    if (!vehicleId || !projectId) {
      return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'vehicleId and projectId are required');
    }

    if (!isValidUUID(vehicleId) || !isValidUUID(projectId)) {
      return apiResponse.validationError(res, { ids: 'vehicleId and projectId must be valid UUIDs' });
    }

    // Check for existing active assignment for same vehicle-project pair
    const existing = await sql`
      SELECT id FROM fleet_vehicle_project_assignments
      WHERE vehicle_id = ${vehicleId} AND project_id = ${projectId} AND is_active = true
    `;

    if (existing.length > 0) {
      return apiResponse.error(res, ErrorCode.CONFLICT, 'Vehicle is already assigned to this project');
    }

    const result = await sql`
      INSERT INTO fleet_vehicle_project_assignments (vehicle_id, project_id, assigned_date, notes)
      VALUES (${vehicleId}, ${projectId}, ${assignedDate || new Date().toISOString().split('T')[0]}, ${notes || null})
      RETURNING id
    `;

    log.info('Vehicle assigned to project', { vehicleId, projectId });
    return apiResponse.created(res, { id: result[0]?.id });
  }

  // DELETE: deactivate assignment
  if (req.method === 'DELETE') {
    const { id } = req.query;

    if (!id || typeof id !== 'string') {
      return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Assignment ID is required');
    }

    if (!isValidUUID(id)) {
      return apiResponse.validationError(res, { id: 'Invalid assignment ID format' });
    }

    const result = await sql`
      UPDATE fleet_vehicle_project_assignments
      SET is_active = false, returned_date = CURRENT_DATE, updated_at = NOW()
      WHERE id = ${id} AND is_active = true
      RETURNING id
    `;

    if (result.length === 0) {
      return apiResponse.notFound(res, 'Assignment', id);
    }

    log.info('Vehicle project assignment deactivated', { assignmentId: id });
    return apiResponse.success(res, { message: 'Assignment deactivated' });
  }

  return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'POST', 'DELETE']);
}));
